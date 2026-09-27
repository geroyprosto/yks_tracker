import { authClient } from '@/lib/server/auth';
import { ApiError, errorResponse, json, readJson, sameOrigin } from '@/lib/server/http';
import { authOrigin, createRecoveryLimiter, recoveryEmailSchema, recoveryNotice, requestPasswordRecovery } from '@/lib/server/password-recovery';

const allowRecovery = createRecoveryLimiter();

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const input = recoveryEmailSchema.safeParse(await readJson(request, 4096));
    if (!input.success) throw new ApiError(400, 'INVALID_INPUT', 'Geçerli bir e-posta adresi gir.');
    const origin = authOrigin();
    if (!allowRecovery(input.data.email)) return json({ ok: true, message: recoveryNotice });
    const client = await authClient();
    return json(await requestPasswordRecovery(client, input.data.email, origin));
  } catch (error) { return errorResponse(error); }
}
