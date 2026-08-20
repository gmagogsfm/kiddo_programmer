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

test("setup owns coding-agent selection and authentication", async () => {
  const installer = await readFile(path.join(root, "install.sh"), "utf8");
  assert.match(installer, /Choose the coding agent/);
  assert.match(installer, /codex login --device-auth/);
  assert.match(installer, /claude auth login/);
  assert.match(installer, /agy models/);
  assert.match(installer, /ensure_agent_ready/);
  assert.match(installer, /confirm_provider_data_use/);
  assert.match(installer, /KIDDO_AGENT/);
  assert.match(installer, /update_selected_agent_in_config/);
  assert.match(installer, /BUILD_TIMEOUT_MS=300000/);
  assert.match(installer, /MAX_SUPERVISOR_ROUNDS=3/);
  assert.match(installer, /MAX_CONCURRENT_AGENTS=2/);
});

test("the service template contains no machine-specific home path", async () => {
  const template = await readFile(path.join(root, "packaging/kiddo-programmer.service.template"), "utf8");
  assert.doesNotMatch(template, /\/home\/gmagogsfm/);
  assert.match(template, /User=@KIDDO_USER@/);
  assert.match(template, /Environment=KIDDO_AGENT=@KIDDO_AGENT@/);
  assert.match(template, /Environment=KIDDO_AGENT_BIN=@KIDDO_AGENT_BIN@/);
  assert.match(template, /ReadWritePaths=@KIDDO_PROJECTS_DIR@ @KIDDO_AGENT_STATE_DIR@/);
  assert.match(template, /NoNewPrivileges=true/);
  assert.match(template, /CapabilityBoundingSet=/);
  assert.match(template, /RestrictAddressFamilies=.*AF_NETLINK/);
});

test("the npm package includes the runtime and installer", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.bin["kiddo-programmer"], "bin/kiddo-programmer.mjs");
  assert.equal(pkg.license, "Apache-2.0");
  assert.equal(pkg.dependencies["@openai/codex"], "0.146.0");
  for (const required of ["bin/", "assets/", "packaging/", "public/", "scripts/", "server.mjs", "install.sh", "LICENSE", "NOTICE", "SECURITY.md"]) {
    assert.ok(pkg.files.includes(required), `${required} should be included in npm packages`);
  }
});

test("the README contains the complete setup and troubleshooting guide", async () => {
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  assert.match(readme, /## Raspberry Pi setup/);
  assert.match(readme, /### 1\. Install the basic tools/);
  assert.match(readme, /## Administration/);
  assert.match(readme, /## Troubleshooting/);
  assert.match(readme, /assets\/pong-ui\.png/);
  assert.match(readme, /assets\/architecture\.svg/);
});
