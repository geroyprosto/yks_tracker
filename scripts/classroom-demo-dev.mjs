import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const port=process.env.CLASSROOM_DEMO_PORT??'3300';
const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',port],{
  stdio:'inherit',
  env:{...process.env,CLASSROOM_DEMO_ENABLED:'true',CLASSROOM_DEV:'1',
    APP_ORIGIN:`http://127.0.0.1:${port}`,NEXT_PUBLIC_SUPABASE_URL:'',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'',ALLOWED_USER_EMAIL:'',
    SUPABASE_SECRET_KEY:'',OPENAI_API_KEY:'',RESEND_API_KEY:'',MCP_ENABLED:'false',AI_SCHEDULER_ENABLED:'false'},
});
child.on('exit',code=>process.exit(code??0));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
