import vm from "node:vm";

export function validateHtml(html) {
  const errors = [];
  const warnings = [];
  if (typeof html !== "string" || html.trim().length < 120) errors.push("app.html is missing or too small.");
  if (Buffer.byteLength(html || "") > 2_000_000) errors.push("app.html is larger than 2 MB.");
  if (!/^\s*<!doctype html>/i.test(html || "")) errors.push("Add <!doctype html> at the top.");
  if (!/<html[\s>]/i.test(html || "") || !/<\/html\s*>/i.test(html || "")) errors.push("The html element is incomplete.");
  if (!/<body[\s>]/i.test(html || "") || !/<\/body\s*>/i.test(html || "")) errors.push("The body element is incomplete.");
  if (!/<meta[^>]+name=["']viewport["']/i.test(html || "")) warnings.push("Add a viewport tag for better iPad sizing.");
  if (/<script[^>]+src\s*=|<link[^>]+href\s*=|(?:src|href|action)\s*=\s*["']\s*(?:https?:|\/\/)|url\s*\(\s*["']?\s*(?:https?:|\/\/)|@import|\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(|EventSource\s*\(|WebTransport\s*\(|sendBeacon\s*\(/i.test(html || "")) errors.push("The app must not load things from the internet.");
  if (/<iframe\b|<base\b|<meta[^>]+http-equiv\s*=\s*["']?refresh|window\.open\s*\(|location(?:\.href)?\s*=|document\.cookie|\b(?:localStorage|sessionStorage)\b|window\.(?:parent|top)|\bparent\.(?:document|location)|\btop\.(?:document|location)/i.test(html || "")) errors.push("The app contains a navigation or privacy feature that is not allowed.");

  const scripts = [...String(html || "").matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi)];
  for (const [, source] of scripts) {
    try { new vm.Script(source); }
    catch (error) { errors.push(`JavaScript error: ${error.message.split("\n")[0]}`); }
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function validateLogoSvg(svg) {
  const errors = [];
  const value = String(svg || "");
  if (value.trim().length < 80) errors.push("logo.svg is missing or too small.");
  if (Buffer.byteLength(value) > 250_000) errors.push("logo.svg is larger than 250 KB.");
  if (!/^\s*<svg[\s>]/i.test(value) || !/<\/svg\s*>\s*$/i.test(value)) errors.push("logo.svg must contain one complete SVG image.");
  if (!/<svg[^>]+viewBox\s*=\s*["'][^"']+["']/i.test(value)) errors.push("logo.svg needs a viewBox so it scales cleanly.");
  if (/<(?:script|foreignObject|iframe|image|use|audio|video|a)\b|\bon[a-z]+\s*=|\b(?:href|src)\s*=|\burl\s*\(|@import|<!DOCTYPE|<\?xml-stylesheet/i.test(value)) {
    errors.push("logo.svg contains an unsafe or external feature.");
  }
  return { ok: errors.length === 0, errors, warnings: [] };
}
