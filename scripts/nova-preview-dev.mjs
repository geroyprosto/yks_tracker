import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const port = process.env.NOVA_PREVIEW_PORT ?? '3410';
if (!/^\d{4,5}$/.test(port)) throw new Error('INVALID_PREVIEW_PORT');
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', port], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'development', NOVA_PREVIEW: '1', CLASSROOM_DEMO_ENABLED: 'true', NOVA_ENABLED: 'true', NOVA_DEMO_ENABLED: 'true',
    YKSIM_E2E: '1', CLASSROOM_DEMO_TEST_RUN: randomUUID(), APP_ORIGIN: `http://127.0.0.1:${port}`,
    NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
    SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', ALLOWED_USER_EMAIL: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '',
    GOOGLE_TOKEN_ENCRYPTION_KEY: '', OPENAI_API_KEY: '', RESEND_API_KEY: '', CLASSROOM_EMAIL_FROM: '', MCP_ENABLED: 'false', AI_SCHEDULER_ENABLED: 'false' },
});
child.on('exit', code => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
