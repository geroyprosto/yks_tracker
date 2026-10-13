import { novaChatState } from '@/lib/server/nova';
import { errorResponse, json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

/** Bounded, authenticated reads while a response is pending; no engine writes. */
export async function GET() {
  try { return json(await novaChatState()); }
  catch (error) { return errorResponse(error); }
}
