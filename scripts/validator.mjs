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
  if (/<script[^>]+src\s*=|<link[^>]+href\s*=|(?:src|href|action)\s*=\s*["']\s*https?:|url\s*\(\s*["']?\s*https?:|@import|\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(/i.test(html || "")) errors.push("The app must not load things from the internet.");
  if (/<iframe\b|window\.open\s*\(|location(?:\.href)?\s*=|document\.cookie|\b(?:localStorage|sessionStorage)\b|window\.(?:parent|top)|\bparent\.(?:document|location)|\btop\.(?:document|location)/i.test(html || "")) errors.push("The app contains a navigation or privacy feature that is not allowed.");

  const scripts = [...String(html || "").matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi)];
  for (const [, source] of scripts) {
    try { new vm.Script(source); }
    catch (error) { errors.push(`JavaScript error: ${error.message.split("\n")[0]}`); }
  }
  return { ok: errors.length === 0, errors, warnings };
}
