import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the packaged CLI exposes setup and check commands", async () => {
  const cli = await readFile(path.join(root, "bin/kiddo-programmer.mjs"), "utf8");
  assert.match(cli, /case "setup"/);
  assert.match(cli, /case "check"/);
  assert.match(cli, /kiddo-programmer setup/);
});

test("the service template contains no machine-specific home path", async () => {
  const template = await readFile(path.join(root, "packaging/kiddo-programmer.service.template"), "utf8");
  assert.doesNotMatch(template, /\/home\/gmagogsfm/);
  assert.match(template, /User=@KIDDO_USER@/);
  assert.match(template, /ReadWritePaths=@KIDDO_PROJECTS_DIR@ @KIDDO_CODEX_HOME@/);
});

test("the npm package includes the runtime and installer", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.bin["kiddo-programmer"], "bin/kiddo-programmer.mjs");
  for (const required of ["bin/", "packaging/", "public/", "scripts/", "server.mjs", "install.sh"]) {
    assert.ok(pkg.files.includes(required), `${required} should be included in npm packages`);
  }
});
