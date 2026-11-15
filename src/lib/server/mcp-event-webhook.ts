import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';

export function callbackUrl(raw: string): URL {
  const url = new URL(raw);
  // This connector delivers only to ChatGPT, never arbitrary user-supplied hosts.
  const allowed = ['chatgpt.com', 'openai.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host));
  if (!allowed || url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) {
    throw new Error('invalid_callback');
  }
  return url;
}

export function publicIPv4(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 ||
      (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

export function signingKey(secret: string): Buffer {
  if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)) throw new Error('invalid_secret');
  const key = Buffer.from(secret.slice(6), 'base64');
  if (key.length < 24 || key.length > 64 || key.toString('base64').replace(/=+$/, '') !== secret.slice(6).replace(/=+$/, '')) {
    throw new Error('invalid_secret');
  }
  return key;
}

export function webhookSignature(secret: string, id: string, timestamp: number, body: string): string {
  return 'v1,' + createHmac('sha256', signingKey(secret)).update(`${id}.${timestamp}.${body}`).digest('base64');
}

export type Subscription = { id: string; callback_url: string; secret: string; previous_secret?: string | null };
export type WebhookResult = { status: number; body: string };
export type WebhookSender = (subscription: Subscription, id: string, payload: object) => Promise<WebhookResult>;

/** Resolve for every connection, pin the address, retain hostname/TLS, and never redirect. */
export const sendWebhook: WebhookSender = async (subscription, id, payload) => {
  const url = callbackUrl(subscription.callback_url);
  const addresses = await lookup(url.hostname, { family: 4, all: true });
  if (!addresses.length || addresses.some(entry => !publicIPv4(entry.address))) throw new Error('invalid_address');
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > 262144) throw new Error('payload_too_large');
  const timestamp = Math.floor(Date.now() / 1000);
  const signatures = [subscription.secret, subscription.previous_secret].filter((secret): secret is string => Boolean(secret))
    .map(secret => webhookSignature(secret, id, timestamp, body)).join(' ');
  return new Promise((resolve, reject) => {
    const outgoing = request(url, {
      method: 'POST', agent: false, signal: AbortSignal.timeout(8000),
      lookup: (_hostname, options, callback) => {
        if (typeof options === 'object' && options.all) callback(null, [addresses[0]]);
        else callback(null, addresses[0].address, 4);
      },
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': signatures,
        'X-MCP-Subscription-Id': subscription.id },
    }, incoming => {
      const chunks: Buffer[] = []; let bytes = 0;
      incoming.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 8192) incoming.destroy(new Error('response_too_large'));
        else chunks.push(chunk);
      });
      incoming.on('error', reject);
      incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
};

export async function verifyCallback(subscription: Subscription, send: WebhookSender = sendWebhook): Promise<void> {
  const challenge = randomUUID();
  const response = await send(subscription, 'verification_' + randomUUID(), { type: 'verification', challenge });
  if (response.status < 200 || response.status >= 300) throw new Error('challenge_failed');
  let returned: unknown;
  try { returned = JSON.parse(response.body).challenge; } catch { throw new Error('challenge_failed'); }
  if (typeof returned !== 'string' || Buffer.byteLength(returned) !== Buffer.byteLength(challenge) ||
    !timingSafeEqual(Buffer.from(returned), Buffer.from(challenge))) throw new Error('challenge_failed');
}
