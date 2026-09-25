import assert from "node:assert/strict";
import { test } from "node:test";
import { CONSENT_TTL_SECONDS, issueConsentState, safeOAuthRedirect, validAuthorizationId, verifyConsentState } from "../src/lib/server/oauth-consent";

test("consent decision requires the same authorization, owner and fresh CSRF token", () => {
  const state = issueConsentState("8fa7e10a-119f-43d2-9fb4-5c39db831203", "owner-1");
  assert.equal(verifyConsentState(state.cookie, "8fa7e10a-119f-43d2-9fb4-5c39db831203", "owner-1", state.nonce), true);
  assert.equal(verifyConsentState(state.cookie, "different-request", "owner-1", state.nonce), false);
  assert.equal(verifyConsentState(state.cookie, "8fa7e10a-119f-43d2-9fb4-5c39db831203", "owner-2", state.nonce), false);
  assert.equal(verifyConsentState(state.cookie, "8fa7e10a-119f-43d2-9fb4-5c39db831203", "owner-1", "A".repeat(43)), false);
  const old = JSON.parse(Buffer.from(state.cookie, "base64url").toString("utf8"));
  old.issuedAt -= (CONSENT_TTL_SECONDS + 1) * 1000;
  assert.equal(verifyConsentState(Buffer.from(JSON.stringify(old)).toString("base64url"), old.authorizationId, old.userId, old.nonce), false);
});

test("OAuth callbacks must use a safe URL at the registered destination", () => {
  const registered = "https://client.example/callback";
  assert.equal(safeOAuthRedirect("https://client.example/callback?code=123&state=abc", registered), "https://client.example/callback?code=123&state=abc");
  assert.equal(safeOAuthRedirect("https://other.example/callback?code=123", registered), null);
  assert.equal(safeOAuthRedirect("https://client.example/other?code=123", registered), null);
  assert.equal(safeOAuthRedirect("javascript:alert(1)"), null);
  assert.equal(safeOAuthRedirect("http://client.example/callback", registered), null);
  assert.equal(safeOAuthRedirect("http://127.0.0.1:9147/callback?code=123", "http://127.0.0.1:9147/callback"), "http://127.0.0.1:9147/callback?code=123");
});

test("malformed authorization IDs are rejected before contacting Supabase", () => {
  assert.equal(validAuthorizationId("8fa7e10a-119f-43d2-9fb4-5c39db831203"), true);
  assert.equal(validAuthorizationId("/../callback"), false);
  assert.equal(validAuthorizationId(""), false);
});