import { classroomContext } from '@/lib/server/classroom';
import { demoRuntime } from '@/lib/server/classroom-demo';
import { errorResponse, privateHeaders } from '@/lib/server/http';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=60;

/** Database-scoped invalidations; no student's records travel over an unscoped stream. */
export async function GET(request:Request){try{
  const {client,user,account,demo}=await classroomContext();
  const encoder=new TextEncoder();let cleanup=()=>{};
  const stream=new ReadableStream({
    async start(controller){
      let closed=false;const emit=()=>{if(!closed)controller.enqueue(encoder.encode('event: dirty\ndata: {}\n\n'));};
      const timer=setInterval(()=>{if(!closed)controller.enqueue(encoder.encode(': heartbeat\n\n'));},20000);
      const stop=setTimeout(()=>cleanup(),55000);
      let unsubscribe=()=>{};
      cleanup=()=>{if(closed)return;closed=true;clearInterval(timer);clearTimeout(stop);unsubscribe();request.signal.removeEventListener('abort',cleanup);controller.close();};
      request.signal.addEventListener('abort',cleanup,{once:true});
      controller.enqueue(encoder.encode('retry: 3000\n\n'));
      if(demo){const events=demoRuntime().events;events.on('change',emit);unsubscribe=()=>events.off('change',emit);}
      else if(account){
        const {data}=await client.auth.getSession();
        if(data.session)await client.realtime.setAuth(data.session.access_token);
        const channel=client.channel(`classroom-${user.id}-${crypto.randomUUID()}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'classroom_events',filter:`user_id=eq.${user.id}`},emit).subscribe(status=>{if(status==='SUBSCRIBED')emit();});
        unsubscribe=()=>{void client.removeChannel(channel);};
        if(closed)unsubscribe();
      }
      emit();
    },
    cancel(){cleanup();}
  });
  return new Response(stream,{headers:{...privateHeaders,'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no'}});
}catch(error){return errorResponse(error);}}
