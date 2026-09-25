import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/server/auth";
import { ApiError, errorResponse, sameOrigin } from "@/lib/server/http";
import { CONSENT_COOKIE, consentConfigured, safeOAuthRedirect, validAuthorizationId, verifyConsentState } from "@/lib/server/oauth-consent";

async function smallForm(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded"))
    throw new ApiError(415, "FORM_REQUIRED", "Geçerli onay formu gerekli.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "INVALID_REQUEST", "Onay kararı eksik.");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 4096) { await reader.cancel(); throw new ApiError(413, "BODY_TOO_LARGE", "Onay formu çok büyük."); }
    chunks.push(value);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

export async function POST(request: NextRequest) {
  try {
    if (!consentConfigured()) throw new ApiError(503, "MCP_DISABLED", "ChatGPT bağlantısı henüz kurulmadı.");
    sameOrigin(request);
    const form = await smallForm(request);
    const authorizationId = form.get("authorization_id");
    const decision = form.get("decision");
    const csrf = form.get("csrf") ?? "";
    if (!validAuthorizationId(authorizationId) || (decision !== "approve" && decision !== "deny"))
      throw new ApiError(400, "INVALID_REQUEST", "Onay kararı geçersiz.");
    const client = await requireOwner();
    const { data: owner, error: ownerError } = await client.auth.getUser();
    if (ownerError || !owner.user) throw new ApiError(401, "SIGN_IN_REQUIRED", "Devam etmek için giriş yapın.");
    if (!verifyConsentState(request.cookies.get(CONSENT_COOKIE)?.value, authorizationId, owner.user.id, csrf))
      throw new ApiError(403, "CONSENT_EXPIRED", "Onay ekranının süresi doldu. Bağlantıyı yeniden başlatın.");
    const details = await client.auth.oauth.getAuthorizationDetails(authorizationId);
    if (details.error || !details.data || !("authorization_id" in details.data) ||
        details.data.authorization_id !== authorizationId || details.data.user.id !== owner.user.id ||
        details.data.user.email.toLowerCase() !== owner.user.email?.toLowerCase())
      throw new ApiError(400, "INVALID_REQUEST", "Bağlantı isteği geçersiz veya süresi dolmuş.");

    const result = decision === "approve"
      ? await client.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await client.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (result.error || !result.data) throw new ApiError(400, "CONSENT_FAILED", "Bağlantı kararı tamamlanamadı.");
    const redirectUrl = safeOAuthRedirect(result.data.redirect_url, details.data.redirect_uri);
    if (!redirectUrl) throw new ApiError(400, "INVALID_REDIRECT", "Bağlantının dönüş adresi güvenli değil.");
    const response = NextResponse.redirect(redirectUrl, { status: 303, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    response.cookies.set(CONSENT_COOKIE, "", { maxAge: 0, path: "/api/oauth/decision" });
    return response;
  } catch (error) { return errorResponse(error); }
}
