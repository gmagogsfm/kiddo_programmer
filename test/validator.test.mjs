import test from "node:test";
import assert from "node:assert/strict";
import { validateHtml, validateLogoSvg } from "../scripts/validator.mjs";

const good = `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><button id="go">Go</button><script>document.querySelector('#go').onclick = () => alert('Hi');</script></body></html>`;

test("accepts a self-contained working page", () => assert.equal(validateHtml(good).ok, true));
test("rejects JavaScript syntax errors", () => assert.equal(validateHtml(good.replace("alert('Hi')", "alert(" )).ok, false));
test("rejects external scripts", () => assert.equal(validateHtml(good.replace("<script>", '<script src="https://example.com/x.js">')).ok, false));
test("rejects network calls", () => assert.equal(validateHtml(good.replace("alert('Hi')", "fetch('/secret')")).ok, false));
test("rejects external images", () => assert.equal(validateHtml(good.replace("<body>", '<body><img src="https://example.com/me.png">')).ok, false));
test("rejects protocol-relative images", () => assert.equal(validateHtml(good.replace("<body>", '<body><img src="//example.com/me.png">')).ok, false));
test("rejects beacon calls", () => assert.equal(validateHtml(good.replace("alert('Hi')", 'navigator.sendBeacon("//example.com", "data")')).ok, false));
test("rejects external form actions", () => assert.equal(validateHtml(good.replace("<body>", '<body><form action="//example.com/collect"><input></form>')).ok, false));
test("rejects browser storage", () => assert.equal(validateHtml(good.replace("alert('Hi')", "localStorage.setItem('score', 1)")).ok, false));

const goodLogo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#6757e8"/><circle cx="64" cy="64" r="30" fill="#ffd85c"/></svg>`;
test("accepts a small self-contained SVG logo", () => assert.equal(validateLogoSvg(goodLogo).ok, true));
test("rejects SVG scripts", () => assert.equal(validateLogoSvg(goodLogo.replace("</svg>", "<script>alert(1)</script></svg>")).ok, false));
test("rejects SVG external images", () => assert.equal(validateLogoSvg(goodLogo.replace("</svg>", '<image href="https://example.com/a.png"/></svg>')).ok, false));
