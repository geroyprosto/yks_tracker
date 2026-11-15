import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deliverLeaderNoteEvents } from './mcp-events';

export function scheduleLeaderNoteDelivery(client: SupabaseClient, userId: string, appUrl: string): void {
  after(async () => {
    try {
      // Bound each invocation. The durable queue also resumes when the room next reads.
      for (const delay of [0, 5500, 10500]) {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        if (!await deliverLeaderNoteEvents(client, userId, appUrl)) break;
      }
    } catch { console.warn('LEADER_EVENT_DELIVERY_DEFERRED'); }
  });
}
