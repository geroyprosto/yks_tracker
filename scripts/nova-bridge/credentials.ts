import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const credentialsSchema = z.object({ appUrl: z.string().url(), deviceId: z.string().uuid(), token: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
export type Credentials = z.infer<typeof credentialsSchema>;
export interface SecretProtector { protect(value: Buffer): Promise<Buffer>; unprotect(value: Buffer): Promise<Buffer> }

/** Secrets travel in anonymous pipes only; no secret argv/env/plaintext files. */
export function windowsDpapi(platform: string = process.platform): SecretProtector {
  const transform = (mode: 'Protect' | 'Unprotect', value: Buffer): Promise<Buffer> => {
    if (platform !== 'win32') return Promise.reject(new Error('WINDOWS_DPAPI_REQUIRED'));
    const script = [
      '$ErrorActionPreference="Stop"',
      'Add-Type -AssemblyName System.Security',
      '$novaInput=[Convert]::FromBase64String([Console]::In.ReadToEnd())',
      `$novaOutput=[System.Security.Cryptography.ProtectedData]::${mode}($novaInput,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)`,
      '[Console]::Out.Write([Convert]::ToBase64String($novaOutput))',
    ].join(';');
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = ''; let failed = false;
      const timer = setTimeout(() => { failed = true; child.kill(); reject(new Error('DPAPI_TIMEOUT')); }, 10000);
      child.stdout.setEncoding('utf8'); child.stdout.on('data', (chunk: string) => { output += chunk; if (output.length > 32000) { failed = true; child.kill(); } });
      child.stderr.resume();
      child.once('error', () => { clearTimeout(timer); reject(new Error('DPAPI_UNAVAILABLE')); });
      child.once('close', code => {
        clearTimeout(timer);
        if (failed || code !== 0 || !/^[A-Za-z0-9+/=]+\s*$/u.test(output)) reject(new Error('DPAPI_FAILED'));
        else resolve(Buffer.from(output.trim(), 'base64'));
      });
      child.stdin.on('error', () => undefined); child.stdin.end(value.toString('base64'));
    });
  };
  return { protect: value => transform('Protect', value), unprotect: value => transform('Unprotect', value) };
}
export function defaultCredentialPath(): string {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) throw new Error('WINDOWS_DPAPI_REQUIRED');
  return join(process.env.LOCALAPPDATA, 'YKSim', 'NovaBridge', 'device.dpapi');
}
export class CredentialStore {
  constructor(private readonly path: string, private readonly protector: SecretProtector) {}
  async save(raw: Credentials) {
    const credentials = credentialsSchema.parse(raw);
    const plaintext = Buffer.from(JSON.stringify(credentials));
    let encrypted: Buffer;
    try { encrypted = await this.protector.protect(plaintext); } finally { plaintext.fill(0); }
    if (!encrypted.length) throw new Error('DPAPI_FAILED');
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' });
    await rename(temporary, this.path);
  }
  async load(): Promise<Credentials> {
    const encrypted = await readFile(this.path);
    if (encrypted.length > 24000) throw new Error('CREDENTIAL_INVALID');
    const plaintext = await this.protector.unprotect(encrypted);
    try { return credentialsSchema.parse(JSON.parse(plaintext.toString('utf8'))); } finally { plaintext.fill(0); }
  }
}
