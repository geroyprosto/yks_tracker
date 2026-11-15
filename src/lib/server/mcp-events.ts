import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { callbackUrl, signingKey, verifyCallback, sendWebhook, type WebhookSender, type Subscription } from './mcp-event-webhook';

export const leaderNoteEvent = {
  name: 'leader.note.created',
  description: 'Kullanıcı YKSİM Ajan Evi liderine yeni bir not bıraktığında oluşur. Yalnız bağlantılı hesabın notları; lider bu notu mevcut kendi gelen kutusundan okuyup yanıtlar.',
  delivery: ['webhook'],
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  payloadSchema: { type: 'object', properties: { message_id: { type: 'string', format: 'uuid' }, url: { type: 'string', format: 'uri' } },
    required: ['message_id', 'url'], additionalProperties: false },
};
const lifetime = 7 * 24 * 60 * 60 * 1000;
const subscriptionParams = z.object({
  name: z.literal('leader.note.created'), arguments: z.strictObject({}).default({}),
  delivery: z.object({ mode: z.literal('webhook'), url: z.string().max(2048), secret: z.string().max(100).optional() }),
  cursor: z.null().optional(), ttlMs: z.number().int().positive().nullable().optional(),
});
const rpcEnvelope = z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number()]), method: z.string(), params: z.unknown().optional() });

export function subscriptionId(userId: string, clientId: string, url: string): string {
  return 'sub_' + createHash('sha256').update(JSON.stringify([userId, clientId, url, leaderNoteEvent.name, {}])).digest('hex');
}
function rpcResponse(id: string | number | null, result: unknown, error = false): Response {
  return Response.json({ jsonrpc: '2.0', id, [error ? 'error' : 'result']: result }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function handleMcpEventRequest(body: unknown, client: SupabaseClient, userId: string, clientId: string,
  send: WebhookSender = sendWebhook): Promise<Response | null> {
  if (!body || typeof body !== 'object' || !('method' in body) || typeof body.method !== 'string' || !body.method.startsWith('events/')) return null;
  const envelope = rpcEnvelope.safeParse(body);
  if (!envelope.success) return rpcResponse(null, { code: -32600, message: 'Invalid event request' }, true);
  const { id, method, params } = envelope.data;
  if (method === 'events/list') return rpcResponse(id, { events: [leaderNoteEvent] });
  if (!['events/subscribe', 'events/unsubscribe'].includes(method)) return rpcResponse(id, { code: -32601, message: 'Method not found' }, true);
  const parsed = subscriptionParams.safeParse(params);
  if (!parsed.success) return rpcResponse(id, { code: -32602, message: 'Invalid event parameters' }, true);
  const input = parsed.data;
  let url: string;
  try { url = callbackUrl(input.delivery.url).href; } catch { return rpcResponse(id, { code: -32602, message: 'Invalid callback URL' }, true); }
  const subId = subscriptionId(userId, clientId, url);
  try {
    if (method === 'events/unsubscribe') {
      const { error } = await client.rpc('mcp_agent_event_unsubscribe', { p_user_id: userId, p_id: subId, p_client_id: clientId });
      if (error) throw new Error('storage_unavailable');
      return rpcResponse(id, {});
    }
    const secret = input.delivery.secret;
    try { if (!secret) throw new Error(); signingKey(secret); } catch { return rpcResponse(id, { code: -32602, message: 'Invalid signing secret' }, true); }
    // The cached record is owner/client/URL/secret scoped, and expires after ten minutes.
    const cached = await client.rpc('mcp_agent_event_verified', { p_user_id: userId, p_id: subId, p_client_id: clientId, p_secret: secret });
    if (cached.error) throw new Error('storage_unavailable');
    if (cached.data !== true) {
      try { await verifyCallback({ id: subId, callback_url: url, secret }, send); }
      catch { return rpcResponse(id, { code: -32015, message: 'Callback verification failed', data: { reason: 'challenge_failed' } }, true); }
    }
    const expiresAt = new Date(Date.now() + Math.max(60000, Math.min(input.ttlMs ?? lifetime, lifetime))).toISOString();
    const { error } = await client.rpc('mcp_agent_event_subscribe', {
      p_user_id: userId, p_id: subId, p_client_id: clientId, p_url: url, p_secret: secret, p_expires_at: expiresAt,
    });
    if (error) throw new Error('storage_unavailable');
    return rpcResponse(id, { id: subId, refreshBefore: expiresAt, cursor: null, truncated: false });
  } catch { return rpcResponse(id, { code: -32603, message: 'Event subscription storage unavailable' }, true); }
}

export async function addEventCapability(response: Response): Promise<Response> {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return response;
  const body = await response.json();
  if (body.result?.capabilities) body.result.capabilities.events = {};
  const headers = new Headers(response.headers); headers.delete('content-length');
  return Response.json(body, { status: response.status, headers });
}

const deliverySchema = z.object({ id: z.string(), callback_url: z.string(), secret: z.string(), previous_secret: z.string().nullable(),
  message_id: z.uuid(), created_at: z.string(), attempt: z.number().int() });

/** Leases and receipts are durable; overlapping requests cannot claim the same attempt. */
export async function deliverLeaderNoteEvents(client: SupabaseClient, userId: string, appUrl: string,
  send: WebhookSender = sendWebhook): Promise<boolean> {
  const claimed = await client.rpc('mcp_agent_event_claim', { p_user_id: userId });
  if (claimed.error) throw new Error('event_claim_failed');
  const rows = z.array(deliverySchema).parse(claimed.data);
  let retry = false;
  await Promise.all(rows.map(async row => {
    const eventId = 'leader-note_' + row.message_id;
    const event = { eventId, name: leaderNoteEvent.name, timestamp: row.created_at,
      data: { message_id: row.message_id, url: new URL('/', appUrl).href }, cursor: null };
    let status = 0;
    try { status = (await send(row as Subscription, eventId, event)).status; } catch { /* No secret or note text in logs. */ }
    const accepted = status >= 200 && status < 300;
    const permanent = status === 410 || status === 413 || (status >= 300 && status < 400) ||
      (status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status));
    const outcome = accepted ? 'delivered' : permanent ? 'failed' : 'retry';
    const receipt = await client.rpc('mcp_agent_event_finish', { p_user_id: userId, p_id: row.id,
      p_message_id: row.message_id, p_attempt: row.attempt, p_outcome: outcome, p_http_status: status });
    if (receipt.error) throw new Error('event_receipt_failed');
    if (!accepted && !permanent && row.attempt < 5) retry = true;
  }));
  return retry;
}
