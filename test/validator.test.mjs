import test from "node:test";
import assert from "node:assert/strict";
import { validateHtml } from "../scripts/validator.mjs";

const good = `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><button id="go">Go</button><script>document.querySelector('#go').onclick = () => alert('Hi');</script></body></html>`;

test("accepts a self-contained working page", () => assert.equal(validateHtml(good).ok, true));
test("rejects JavaScript syntax errors", () => assert.equal(validateHtml(good.replace("alert('Hi')", "alert(" )).ok, false));
test("rejects external scripts", () => assert.equal(validateHtml(good.replace("<script>", '<script src="https://example.com/x.js">')).ok, false));
test("rejects network calls", () => assert.equal(validateHtml(good.replace("alert('Hi')", "fetch('/secret')")).ok, false));
test("rejects external images", () => assert.equal(validateHtml(good.replace("<body>", '<body><img src="https://example.com/me.png">')).ok, false));
test("rejects browser storage", () => assert.equal(validateHtml(good.replace("alert('Hi')", "localStorage.setItem('score', 1)")).ok, false));
