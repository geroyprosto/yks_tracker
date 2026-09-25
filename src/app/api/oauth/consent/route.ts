import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/server/auth";
import { ApiError, errorResponse, privateHeaders } from "@/lib/server/http";
import { CONSENT_COOKIE, CONSENT_TTL_SECONDS, consentConfigured, issueConsentState, safeOAuthRedirect, validAuthorizationId } from "@/lib/server/oauth-consent";

export async function GET(request: NextRequest) {
  try {
    if (!consentConfigured()) throw new ApiError(503, "MCP_DISABLED", "ChatGPT bağlantısı henüz kurulmadı.");
    const authorizationId = request.nextUrl.searchParams.get("authorization_id");
    if (!validAuthorizationId(authorizationId)) throw new ApiError(400, "INVALID_REQUEST", "Geçerli bağlantı isteği bulunamadı.");
    const client = await requireOwner();
    const { data: owner, error: ownerError } = await client.auth.getUser();
    if (ownerError || !owner.user) throw new ApiError(401, "SIGN_IN_REQUIRED", "Devam etmek için giriş yapın.");
    const { data, error } = await client.auth.oauth.getAuthorizationDetails(authorizationId);
    if (error || !data) throw new ApiError(400, "INVALID_REQUEST", "Bağlantı isteği geçersiz veya süresi dolmuş.");
    if (!("authorization_id" in data)) {
      const redirectUrl = safeOAuthRedirect(data.redirect_url);
      if (!redirectUrl) throw new ApiError(400, "INVALID_REDIRECT", "Bağlantının dönüş adresi güvenli değil.");
      return NextResponse.json({ ok: true, redirectUrl }, { headers: { ...privateHeaders, "Referrer-Policy": "no-referrer" } });
    }
    if (data.authorization_id !== authorizationId || data.user.id !== owner.user.id ||
        data.user.email.toLowerCase() !== owner.user.email?.toLowerCase() ||
        !safeOAuthRedirect(data.redirect_uri)) {
      throw new ApiError(403, "INVALID_REQUEST", "Bağlantı isteği bu hesaba ait değil.");
    }
    const state = issueConsentState(authorizationId, owner.user.id);
    const response = NextResponse.json({
      ok: true,
      authorizationId,
      csrf: state.nonce,
      ownerEmail: owner.user.email,
      client: { name: data.client.name, uri: data.client.uri },
      redirectUri: data.redirect_uri,
      scopes: data.scope.split(/\s+/).filter(Boolean),
    }, { headers: { ...privateHeaders, "Referrer-Policy": "no-referrer" } });
    response.cookies.set(CONSENT_COOKIE, state.cookie, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict",
      path: "/api/oauth/decision", maxAge: CONSENT_TTL_SECONDS,
    });
    return response;
  } catch (error) { return errorResponse(error); }
}
