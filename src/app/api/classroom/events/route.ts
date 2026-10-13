import { privateHeaders } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

/** HTTP 204 tells older EventSource clients to stop reconnecting permanently. */
export function GET() {
  return new Response(null, { status: 204, headers: privateHeaders });
}
