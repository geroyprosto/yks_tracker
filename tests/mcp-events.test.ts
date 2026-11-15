import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addEventCapability, deliverLeaderNoteEvents, handleMcpEventRequest, subscriptionId } from '../src/lib/server/mcp-events';
import { callbackUrl, publicIPv4, signingKey, verifyCallback, type WebhookSender } from '../src/lib/server/mcp-event-webhook';

const secret = 'whsec_' + Buffer.alloc(32, 42).toString('base64');
const url = 'https://chatgpt.com/mcp-events/test-callback';
const note = '11111111-1111-4111-8111-111111111111';
const subscribe = { jsonrpc: '2.0', id: 1, method: 'events/subscribe', params: {
  name: 'leader.note.created', arguments: {}, delivery: { mode: 'webhook', url, secret },
} };
function database() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args }); return { data: name.endsWith('_verified') ? false : null, error: null };
  } } as unknown as SupabaseClient;
  return { client, calls };
}
const echo: WebhookSender = async (_subscription, _id, payload) => ({ status: 200, body: JSON.stringify(payload) });

test('callback requests only reach public ChatGPT HTTPS destinations', () => {
  assert.equal(callbackUrl(url).hostname, 'chatgpt.com');
  for (const bad of ['http://chatgpt.com/x', 'https://chatgpt.com.attacker.example/x', 'https://127.0.0.1/x',
    'https://user:password@chatgpt.com/x', 'https://chatgpt.com:8080/x', 'https://chatgpt.com/x#fragment']) {
    assert.throws(() => callbackUrl(bad));
  }
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.1.2', '192.168.0.1', '100.64.0.1',
    '198.19.0.1', '203.0.113.3', '0.0.0.0', '224.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(publicIPv4(ip), false, ip);
  assert.equal(publicIPv4('8.8.8.8'), true);
  assert.equal(signingKey(secret).length, 32);
  for (const bad of ['no-prefix', 'whsec_YQ==', secret + 'junk']) assert.throws(() => signingKey(bad));
});

test('verification must echo the fresh challenge before any subscription is saved', async () => {
  const { client, calls } = database();
  const response = await handleMcpEventRequest(subscribe, client, 'owner', 'oauth-client', echo);
  const body = await response!.json();
  assert.equal(body.result.id, subscriptionId('owner', 'oauth-client', url));
  assert.equal(calls.at(-1)?.name, 'mcp_agent_event_subscribe');
  assert.equal(calls.at(-1)?.args.p_user_id, 'owner');
  const refused = database();
  const failed = await handleMcpEventRequest(subscribe, refused.client, 'owner', 'oauth-client', async () => ({ status: 200, body: '{"challenge":"old"}' }));
  assert.equal((await failed!.json()).error.code, -32015);
  assert.equal(refused.calls.some(call => call.name.endsWith('_subscribe')), false);
  await assert.rejects(() => verifyCallback({ id: 'test', callback_url: url, secret }, async () => ({ status: 302, body: '{}' })));
  assert.notEqual(subscriptionId('owner', 'one', url), subscriptionId('owner', 'two', url));
  assert.notEqual(subscriptionId('owner', 'one', url), subscriptionId('other', 'one', url));
});

test('event methods preserve protocol shape, reject filters, and unsubscribe without a secret', async () => {
  const { client, calls } = database();
  const listed = await handleMcpEventRequest({ jsonrpc: '2.0', id: 4, method: 'events/list' }, client, 'owner', 'one');
  assert.equal((await listed!.json()).result.events[0].name, 'leader.note.created');
  const invalid = await handleMcpEventRequest({ ...subscribe, params: { ...subscribe.params, arguments: { user_id: 'other' } } }, client, 'owner', 'one', echo);
  assert.equal((await invalid!.json()).error.code, -32602);
  const removed = await handleMcpEventRequest({ ...subscribe, method: 'events/unsubscribe', params: {
    name: 'leader.note.created', arguments: {}, delivery: { mode: 'webhook', url },
  } }, client, 'owner', 'one');
  assert.deepEqual((await removed!.json()).result, {});
  assert.equal(calls.at(-1)?.name, 'mcp_agent_event_unsubscribe');
  assert.equal(await handleMcpEventRequest({ method: 'tools/list' }, client, 'owner', 'one'), null);
  const advertised = await addEventCapability(Response.json({ jsonrpc: '2.0', id: 1, result: { capabilities: { tools: {} } } }));
  assert.deepEqual((await advertised.json()).result.capabilities, { tools: {}, events: {} });
});

test('delivery preserves event identity, excludes private text, and stops permanent failures', async () => {
  for (const [status, expected, retry] of [[202, 'delivered', false], [503, 'retry', true], [429, 'retry', true],
    [410, 'failed', false], [413, 'failed', false], [302, 'failed', false]] as const) {
    const receipts: Record<string, unknown>[] = [];
    const client = { rpc: async (name: string, args: Record<string, unknown>) => {
      if (name.endsWith('_claim')) return { data: [{ id: 'sub_test', callback_url: url, secret, previous_secret: null,
        message_id: note, created_at: '2026-11-15T10:00:00Z', attempt: 1 }], error: null };
      receipts.push(args); return { data: null, error: null };
    } } as unknown as SupabaseClient;
    const result = await deliverLeaderNoteEvents(client, 'owner', 'https://study.example.com/', async (_subscription, id, event) => {
      assert.equal(id, 'leader-note_' + note);
      assert.deepEqual(event, { eventId: id, name: 'leader.note.created', timestamp: '2026-11-15T10:00:00Z',
        data: { message_id: note, url: 'https://study.example.com/' }, cursor: null });
      return { status, body: '' };
    });
    assert.equal(result, retry);
    assert.equal(receipts[0].p_outcome, expected);
  }
});
