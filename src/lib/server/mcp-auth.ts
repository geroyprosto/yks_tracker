import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getConfiguration } from "./auth";

type McpConfiguration = {
  resource: string;
  appUrl: string;
  supabaseUrl: string;
  publishableKey: string;
  secretKey: string;
  ownerEmail: string;
};

/** Explicit opt-in keeps the private connector offline until OAuth is configured. */
export function getMcpConfiguration(): McpConfiguration | null {
  if (process.env.MCP_ENABLED !== "true") return null;
  const app = getConfiguration();
  const rawResource = process.env.MCP_PUBLIC_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!app || !rawResource || !secretKey || /REPLACE|YOUR_/i.test(secretKey)) return null;
  try {
    const url = new URL(rawResource);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
        url.pathname !== "/api/mcp" || url.search || url.hash || url.username || url.password) return null;
    return {
      resource: url.href,
      appUrl: url.origin + "/",
      supabaseUrl: app.url.replace(/\/$/, ""),
      publishableKey: app.key,
      secretKey,
      ownerEmail: app.email,
    };
  } catch { return null; }
}

function authError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

const bearerPattern = /^Bearer\s+([^\s]+)$/i;

/** Only verified Supabase OAuth tokens belonging to the allowlisted owner pass. */
export async function authenticateMcpRequest(
  request: Request, config: McpConfiguration,
): Promise<{ client: SupabaseClient; userId: string; clientId: string } | Response> {
  const matched = bearerPattern.exec(request.headers.get("authorization") ?? "");
  if (!matched) return authError(401, "SIGN_IN_REQUIRED", "OAuth erişim anahtarı gerekli.");
  const token = matched[1];
  const verifier = createClient(config.supabaseUrl, config.publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  try {
    // getClaims verifies the signature and expiry against Supabase's JWKS.
    const { data, error } = await verifier.auth.getClaims(token);
    if (error || !data?.claims) return authError(401, "INVALID_TOKEN", "OAuth erişim anahtarı geçersiz.");
    const claims = data.claims;
    const expectedIssuer = config.supabaseUrl + "/auth/v1";
    const audience = claims.aud;
    const resourceAudience = audience === config.resource || (Array.isArray(audience) && audience.includes(config.resource));
    const clientId = claims.client_id;
    if (claims.iss !== expectedIssuer || !resourceAudience || claims.role !== "authenticated" ||
        typeof clientId !== "string" || !clientId || !z.uuid().safeParse(claims.sub).success ||
        typeof claims.email !== "string" || claims.email.toLowerCase() !== config.ownerEmail) {
      return authError(401, "INVALID_TOKEN", "Bu bağlantı için yetkili OAuth erişim anahtarı gerekli.");
    }

    // Contact Auth as well so deleted or revoked users are not accepted solely from a cached JWT.
    const { data: userData, error: userError } = await verifier.auth.getUser(token);
    if (userError || !userData.user || userData.user.id !== claims.sub ||
        userData.user.email?.toLowerCase() !== config.ownerEmail) {
      return authError(401, "INVALID_TOKEN", "Kullanıcı oturumu doğrulanamadı.");
    }

    // The OAuth bearer never reaches PostgREST. The server-held key invokes a
    // narrow allowlist RPC, then is passed only to the scoped MCP tool handlers.
    const client = createClient(config.supabaseUrl, config.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const allowed = await client.rpc("mcp_owner_allowed", { p_user_id: claims.sub });
    if (allowed.error) return authError(503, "DATABASE_UNAVAILABLE", "Sahip yetkisi doğrulanamadı.");
    if (allowed.data !== true) return authError(403, "OWNER_REQUIRED", "Bu hesap için erişim tanımlı değil.");
    return { client, userId: claims.sub, clientId };
  } catch {
    return authError(401, "INVALID_TOKEN", "OAuth erişim anahtarı doğrulanamadı.");
  }
}
