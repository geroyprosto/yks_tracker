import { authClient } from '@/lib/server/auth';
import { ApiError, errorResponse, json, readJson, sameOrigin } from '@/lib/server/http';
import { recoveryPasswordSchema, recoveryUser, updateRecoveredPassword } from '@/lib/server/password-recovery';

export async function GET() {
  try {
    await recoveryUser(await authClient());
    return json({ ok: true });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const input = recoveryPasswordSchema.safeParse(await readJson(request, 4096));
    if (!input.success) throw new ApiError(400, 'INVALID_INPUT', '10–128 karakter uzunluğunda bir şifre gir.');
    return json(await updateRecoveredPassword(await authClient(), input.data.password));
  } catch (error) { return errorResponse(error); }
}
