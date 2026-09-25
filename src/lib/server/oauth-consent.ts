import { getConfiguration } from "./auth";
import { getMcpConfiguration } from "./mcp-auth";
import { randomBytes, timingSafeEqual } from "node:crypto";

export const CONSENT_COOKIE = "yks-oauth-consent";
export const CONSENT_TTL_SECONDS = 10 * 60;

// Authorization IDs are opaque to us; validate their shape before passing them to Auth.
export function validAuthorizationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{12,160}$/.test(value);
}

export function issueConsentState(authorizationId: string, userId: string) {
  const nonce = randomBytes(32).toString("base64url");
  const cookie = Buffer.from(JSON.stringify({ authorizationId, userId, nonce, issuedAt: Date.now() })).toString("base64url");
  return { nonce, cookie };
}

export function verifyConsentState(cookie: string | undefined, authorizationId: string, userId: string, nonce: string): boolean {
  if (!cookie || !/^[A-Za-z0-9_-]{1,1024}$/.test(cookie) || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) return false;
  try {
    const stored = JSON.parse(Buffer.from(cookie, "base64url").toString("utf8")) as Record<string, unknown>;
    if (stored.authorizationId !== authorizationId || stored.userId !== userId || typeof stored.nonce !== "string" ||
        typeof stored.issuedAt !== "number" || stored.issuedAt > Date.now() + 30_000 ||
        Date.now() - stored.issuedAt > CONSENT_TTL_SECONDS * 1000) return false;
    const a = Buffer.from(stored.nonce);
    const b = Buffer.from(nonce);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}

/** The destination always comes from Supabase Auth, never a submitted URL. */
export function safeOAuthRedirect(destination: string, registeredBase?: string): string | null {
  try {
    const url = new URL(destination);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.hash) return null;
    if (registeredBase) {
      const base = new URL(registeredBase);
      if (base.protocol !== url.protocol || base.host !== url.host || base.pathname !== url.pathname ||
          base.username || base.password || base.hash || base.search) return null;
    }
    return url.href;
  } catch { return null; }
}

export function consentConfigured(): boolean {
  const mcp = getMcpConfiguration();
  const app = getConfiguration();
  try {
    return Boolean(mcp && app && process.env.APP_ORIGIN &&
      new URL(process.env.APP_ORIGIN).origin === new URL(mcp.appUrl).origin);
  } catch { return false; }
}