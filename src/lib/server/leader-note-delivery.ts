import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deliverLeaderNoteEvents } from './mcp-events';

type DeliveryOptions = {
  defer?: (job: () => Promise<void>) => void;
  deliver?: typeof deliverLeaderNoteEvents;
  wait?: (ms: number) => Promise<void>;
};

export function scheduleLeaderNoteDelivery(client: SupabaseClient, userId: string, options: DeliveryOptions = {}): void {
  // An alternate app host can send notes even when it does not expose the MCP endpoint.
  const appUrl = process.env.APP_ORIGIN;
  if (!appUrl) return;
  const deliver = options.deliver ?? deliverLeaderNoteEvents;
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  (options.defer ?? after)(async () => {
    try {
      // Bound each invocation. The durable queue also resumes when the room next reads.
      for (const delay of [0, 5500, 10500]) {
        if (delay) await wait(delay);
        if (!await deliver(client, userId, appUrl)) break;
      }
    } catch { console.warn('LEADER_EVENT_DELIVERY_DEFERRED'); }
  });
}
