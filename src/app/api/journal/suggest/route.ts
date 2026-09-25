import {z} from 'zod';
import {requireOwner} from '@/lib/server/auth';
import {ApiError, errorResponse, json, readJson, sameOrigin} from '@/lib/server/http';
import {suggestJournalFields} from '@/lib/server/journal-ai';
import {JOURNAL_AI_TEXT_LIMIT} from '@/lib/server/journal-ai-provider';
import {localDate} from '@/lib/ui';

export const dynamic = 'force-dynamic';
const input = z.object({
  request_id: z.uuid(), journal_date: z.iso.date(),
  original_text: z.string().trim().min(3).max(JOURNAL_AI_TEXT_LIMIT),
}).strict();

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const client = await requireOwner();
    const parsed = input.safeParse(await readJson(request, 16000));
    if (!parsed.success || parsed.data.journal_date > localDate())
      throw new ApiError(400, 'INVALID_INPUT', 'Geçerli gün ve en fazla 4.000 karakter günlük metni gerekli.');
    const result = await suggestJournalFields(client, parsed.data.journal_date,
      parsed.data.original_text, parsed.data.request_id);
    return json({ok: true, ...result});
  } catch (error) { return errorResponse(error); }
}
