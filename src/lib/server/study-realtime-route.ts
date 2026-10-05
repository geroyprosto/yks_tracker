import {isRealtimeCursor,json as eventBytes} from '@upstash/realtime';
import type {Redis} from '@upstash/redis';
import {z} from 'zod';
import {ApiError,errorResponse,json,privateHeaders} from './http';
import {studyRealtimeChannel} from './study-realtime';
import {studyRealtimeSchema} from '../realtime-schema';

const dirtyMessage=z.object({event:z.literal('study.dirty'),channel:z.string(),
  id:z.string().regex(/^\d+-\d+$/),data:studyRealtimeSchema.study.dirty});
type Subscription=ReturnType<Redis['subscribe']>;
export type StudyRealtimeRouteDependencies={
  authorize:()=>Promise<{userId:string}>;
  redis:()=>Pick<Redis,'subscribe'>|null;
};

/** Own the PubSub handle immediately, including while its connection is pending. */
export function studyRealtimeStream(request:Request,redis:Pick<Redis,'subscribe'>,channel:string,
  durations={lifetime:55000,handshake:3000,heartbeat:20000}):Response{
  let cleanup=()=>{};
  const stream=new ReadableStream<Uint8Array>({
    start(controller){
      let closed=false;
      let subscriber:Subscription|undefined;
      let lifetime:ReturnType<typeof setTimeout>|undefined;
      let handshake:ReturnType<typeof setTimeout>|undefined;
      let heartbeat:ReturnType<typeof setInterval>|undefined;
      const send=(data:Parameters<typeof eventBytes>[0])=>{
        if(closed)return;
        try{controller.enqueue(eventBytes(data));}catch{cleanup();}
      };
      cleanup=()=>{
        if(closed)return;
        closed=true;clearTimeout(lifetime);clearTimeout(handshake);clearInterval(heartbeat);
        request.signal.removeEventListener('abort',cleanup);
        void subscriber?.unsubscribe().catch(()=>{});
        try{controller.close();}catch{}
      };
      if(request.signal.aborted){cleanup();return;}
      request.signal.addEventListener('abort',cleanup,{once:true});
      const unavailable=()=>{send({type:'error',error:'Realtime temporarily unavailable'});cleanup();};
      try{
        subscriber=redis.subscribe(channel);
        subscriber.on('subscribe',()=>{
          clearTimeout(handshake);send({type:'connected',channel});
        });
        subscriber.on('error',unavailable);
        subscriber.on('unsubscribe',cleanup);
        subscriber.on('message',({message})=>{
          let value:unknown=message;
          if(typeof value==='string'){try{value=JSON.parse(value);}catch{return;}}
          const parsed=dirtyMessage.safeParse(value);
          if(!parsed.success||parsed.data.channel!==channel||!isRealtimeCursor(parsed.data.id))return;
          // Rebuild a minimal envelope instead of forwarding upstream properties.
          send({event:'study.dirty',channel,data:{},id:parsed.data.id});
        });
        handshake=setTimeout(unavailable,durations.handshake);
        heartbeat=setInterval(()=>send({type:'ping',timestamp:Date.now()}),durations.heartbeat);
        lifetime=setTimeout(()=>{send({type:'reconnect',timestamp:Date.now()});cleanup();},durations.lifetime);
      }catch{unavailable();}
    },
    cancel(){cleanup();}
  });
  return new Response(stream,{headers:{...privateHeaders,'Content-Type':'text/event-stream',
    'Connection':'keep-alive','X-Accel-Buffering':'no'}});
}

export function createStudyRealtimeGet(dependencies:StudyRealtimeRouteDependencies){
  return async(request:Request):Promise<Response>=>{
    try{
      const url=new URL(request.url);
      const origin=request.headers.get('origin');
      const host=request.headers.get('host')??url.host;
      const expected=process.env.APP_ORIGIN?new URL(process.env.APP_ORIGIN).origin:new URL(`${url.protocol}//${host}`).origin;
      const site=request.headers.get('sec-fetch-site');
      if((origin&&origin!==expected)||(site&&site!=='same-origin'&&site!=='none'))
        throw new ApiError(403,'ORIGIN_REJECTED','Bu bağlantıyı aynı uygulamadan açın.');
      const {userId}=await dependencies.authorize();
      const channel=studyRealtimeChannel(userId);
      const requested=url.searchParams.getAll('channel');
      if(url.searchParams.get('session')==='1'){
        if(requested.length)throw new ApiError(403,'CHANNEL_REJECTED','Bu kanala erişiminiz yok.');
        return json(dependencies.redis()?{enabled:true,channel}:{enabled:false});
      }
      if(requested.length!==1||requested[0]!==channel)
        throw new ApiError(403,'CHANNEL_REJECTED','Bu kanala erişiminiz yok.');
      const redis=dependencies.redis();
      if(!redis)throw new ApiError(503,'REALTIME_UNAVAILABLE','Canlı bağlantı geçici olarak kullanılamıyor.');
      return studyRealtimeStream(request,redis,channel);
    }catch(error){return errorResponse(error);}
  };
}
