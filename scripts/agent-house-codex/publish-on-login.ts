import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { publishPreparedReport } from './startup-core';

const repo = resolve(import.meta.dirname, '../..');
const logDir = join(process.env.LOCALAPPDATA ?? join(repo, '.next'), 'YKSim', 'agent-house');
mkdirSync(logDir, { recursive: true });
function record(event: object) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...event });
  appendFileSync(join(logDir, 'startup.jsonl'), line + '\n');
  console.log(line);
}
async function main() {
  // Server credentials remain on this computer and are never passed to a model.
  const env = parseEnv(readFileSync(join(repo, '.env.local'), 'utf8'));
  const email = env.ALLOWED_USER_EMAIL?.trim().toLowerCase();
  if (!email || !env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error('SETUP_MISSING');
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000) }) },
  });
  const attempts = process.argv.includes('--once') ? 1 : 5;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      let owner: string | undefined;
      for (let page = 1; page <= 100; page++) {
        const users = await client.auth.admin.listUsers({ page, perPage: 100 });
        if (users.error) throw new Error('OWNER_LOOKUP_FAILED');
        owner = users.data.users.find(user => user.email?.toLowerCase() === email)?.id;
        if (owner || users.data.users.length < 100) break;
      }
      if (!owner) throw new Error('OWNER_NOT_FOUND');
      record({ event: 'startup_delivery', ...await publishPreparedReport(client, owner) });
      return;
    } catch (error) {
      // Never log database payloads, access tokens, journal text or raw exceptions.
      const known = ['DRAFT_CHANGED','DRAFT_READ_FAILED','PUBLISH_FAILED','RECEIPT_INVALID','OWNER_LOOKUP_FAILED','OWNER_NOT_FOUND'];
      const code = error instanceof Error && known.includes(error.message) ? error.message : 'INVALID_DRAFT_OR_CONNECTION';
      record({ event: 'startup_retry', attempt, code });
      if (attempt === attempts) throw new Error(code);
      await new Promise(done => setTimeout(done, 30_000));
    }
  }
}
main().catch(() => { record({ event: 'startup_delivery_failed' }); process.exitCode = 1; });
