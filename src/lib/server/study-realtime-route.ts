import type {Redis} from '@upstash/redis';
import {ApiError,errorResponse,json,privateHeaders} from './http';
import {studyRealtimeChannel,studyRealtimeVersionKey} from './study-realtime';

const versionToken=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type StudyRealtimeRouteDependencies={
  authorize:()=>Promise<{userId:string}>;
  redis:()=>Pick<Redis,'get'>|null;
};

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
      const requested=url.searchParams.getAll('channel');
      if(url.searchParams.get('session')!=='1'){
        if(requested.length!==1||requested[0]!==studyRealtimeChannel(userId))
          throw new ApiError(403,'CHANNEL_REJECTED','Bu kanala erişiminiz yok.');
        // HTTP 204 tells old EventSource clients to stop reconnecting.
        return new Response(null,{status:204,headers:privateHeaders});
      }
      if(requested.length)throw new ApiError(403,'CHANNEL_REJECTED','Bu kanala erişiminiz yok.');
      const key=studyRealtimeVersionKey(userId);
      try{
        const redis=dependencies.redis();
        if(!redis)return json({enabled:false});
        const version=await redis.get<unknown>(key);
        // Never return an unexpected Redis value or upstream diagnostic to clients.
        if(version!==null&&(typeof version!=='string'||!versionToken.test(version)))
          throw new Error('Invalid study version');
        return json({enabled:true,version});
      }catch{
        throw new ApiError(503,'REALTIME_UNAVAILABLE','Güncelleme kontrolü geçici olarak kullanılamıyor.');
      }
    }catch(error){return errorResponse(error);}
  };
}
