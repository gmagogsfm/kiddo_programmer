import { createHash, timingSafeEqual } from "node:crypto";

export const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "media-src data: blob:",
  "connect-src 'none'",
  "font-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join("; ");

export const MAIN_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'"
].join("; ");

export function securePreviewHtml(html) {
  const policy = PREVIEW_CSP.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${meta}`);
  return html.replace(/<!doctype html>/i, (doctype) => `${doctype}${meta}`);
}

function digest(value) {
  return createHash("sha256").update(value).digest();
}

export function sessionValue(pairingToken) {
  return digest(`kiddo-programmer-session:${pairingToken}`).toString("base64url");
}

export function safeEqual(left, right) {
  const a = digest(String(left));
  const b = digest(String(right));
  return timingSafeEqual(a, b);
}

export function cookieValue(cookieHeader, name) {
  for (const item of String(cookieHeader || "").split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export function isAuthorized(cookieHeader, pairingToken) {
  return safeEqual(cookieValue(cookieHeader, "kiddo_session"), sessionValue(pairingToken));
}

export function isSameOriginMutation(req) {
  if (!new Set(["POST", "PUT", "PATCH", "DELETE"]).has(req.method || "")) return true;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; }
  catch { return false; }
}

export function browserSecurityHeaders(extra = {}) {
  return {
    "content-security-policy": MAIN_CSP,
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    ...extra
  };
}
