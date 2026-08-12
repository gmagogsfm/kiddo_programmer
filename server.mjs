import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTaskPool, reviewRejectionLog, timeoutWithinDeadline } from "./scripts/build-control.mjs";
import { buildAgentInvocation, defaultModel, extractAgentReply, normalizeAgent } from "./scripts/coding-agents.mjs";
import { buildRevisionPrompt, buildSupervisorPrompt, parseSupervisorResponse, repeatUntilApproved } from "./scripts/supervision.mjs";
import { browserSecurityHeaders, isSameOriginMutation, securePreviewHtml } from "./scripts/security.mjs";
import { validateHtml, validateLogoSvg } from "./scripts/validator.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const PROJECTS = path.resolve(process.env.KIDDO_PROJECTS_DIR || path.join(ROOT, "..", "kiddo_projects"));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const AGENT = normalizeAgent(process.env.KIDDO_AGENT || "codex");
const AGENT_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS || process.env.CODEX_TIMEOUT_MS || 240_000);
const SUPERVISOR_TIMEOUT_MS = Number(process.env.SUPERVISOR_TIMEOUT_MS || 120_000);
const BUILD_TIMEOUT_MS = Math.max(60_000, Math.min(1_800_000, Number(process.env.BUILD_TIMEOUT_MS || 300_000)));
const MAX_SUPERVISOR_ROUNDS = Math.max(2, Math.min(6, Number(process.env.MAX_SUPERVISOR_ROUNDS || 3)));
const MAX_CONCURRENT_AGENTS = Math.max(1, Math.min(4, Number(process.env.MAX_CONCURRENT_AGENTS || 2)));
const AGENT_PREFIX = AGENT === "antigravity" ? "ANTIGRAVITY" : AGENT.toUpperCase();
const WORKER_MODEL = process.env.KIDDO_WORKER_MODEL || process.env[`${AGENT_PREFIX}_WORKER_MODEL`] || defaultModel(AGENT);
const SUPERVISOR_MODEL = process.env.KIDDO_SUPERVISOR_MODEL || process.env[`${AGENT_PREFIX}_SUPERVISOR_MODEL`] || defaultModel(AGENT);
const MAX_PROJECTS = Math.max(1, Math.min(500, Number(process.env.KIDDO_MAX_PROJECTS || 100)));
const MAX_PENDING_BUILDS = Math.max(1, Math.min(50, Number(process.env.KIDDO_MAX_PENDING_BUILDS || 8)));
const CHAT_HISTORY_LIMIT = Math.max(20, Math.min(1000, Number(process.env.KIDDO_CHAT_HISTORY_LIMIT || 200)));
const WORKER_REASONING_EFFORT = "low";
const SUPERVISOR_REASONING_EFFORT = "low";
const VALIDATOR_PATH = path.join(ROOT, "scripts", "validate-project.mjs");
const SUPERVISOR_SCHEMA_PATH = path.join(ROOT, "schemas", "supervisor-response.schema.json");
const activeRuns = new Set();
const rateBuckets = new Map();
let pendingBuilds = 0;
const agentPool = createTaskPool(MAX_CONCURRENT_AGENTS);
let projectGitQueue = Promise.resolve();

async function runCommand(command, args, cwd, extraEnv = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `${command} exited with code ${code}`)));
  });
}

async function writeIfMissing(file, contents) {
  try { await writeFile(file, contents, { flag: "wx" }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
}

async function prepareProjectStore() {
  await mkdir(PROJECTS, { recursive: true });
  try { await stat(path.join(PROJECTS, ".git")); }
  catch { await runCommand("git", ["-c", "core.hooksPath=/dev/null", "init", "-b", "main"], PROJECTS); }
  await writeIfMissing(path.join(PROJECTS, ".gitignore"), "*/chat.json\n*.tmp\n");
  await writeIfMissing(path.join(PROJECTS, "README.md"), "# Kiddo Projects\n\nGenerated projects live here, separately from the Kiddo Programmer framework.\nEach project keeps its complete app in `app.html`. Conversation files are kept local and ignored by Git.\n");
}

await prepareProjectStore();

function queueProjectGit(task) {
  const run = projectGitQueue.then(task, task);
  projectGitQueue = run.catch(() => {});
  return run;
}

function safeCommitName(name) {
  return String(name).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Untitled project";
}

function recordProjectVersion(meta, action, supervisorReview = null) {
  return queueProjectGit(async () => {
    const files = [`${meta.id}/app.html`, `${meta.id}/project.json`];
    try {
      await stat(path.join(PROJECTS, meta.id, "logo.svg"));
      files.push(`${meta.id}/logo.svg`);
    } catch { /* The first request has not created a logo yet. */ }
    const message = action === "create"
      ? `Create project: ${safeCommitName(meta.name)}`
      : safeCommitName(supervisorReview?.commitMessage || `Update project: ${meta.name}`);
    try {
      await runCommand("git", ["-c", "core.hooksPath=/dev/null", "add", "--", ...files], PROJECTS);
      const commitIdentity = action === "create" ? {} : {
        GIT_AUTHOR_NAME: "Kiddo Supervisor",
        GIT_AUTHOR_EMAIL: "supervisor@kiddo.local"
      };
      await runCommand("git", ["-c", "core.hooksPath=/dev/null", "commit", "-m", message, "--", ...files], PROJECTS, commitIdentity);
    } catch (error) {
      console.error("Could not commit project version:", error.message);
      return { committed: false, pushed: false, owner: action === "create" ? "system" : "supervisor" };
    }
    try {
      await runCommand("git", ["-c", "core.hooksPath=/dev/null", "push", "origin", "main"], PROJECTS);
      return { committed: true, pushed: true, owner: action === "create" ? "system" : "supervisor" };
    } catch (error) {
      console.error("Project version was committed locally but could not be pushed:", error.message);
      return { committed: true, pushed: false, owner: action === "create" ? "system" : "supervisor" };
    }
  });
}

function recordProjectManagement(meta, action) {
  return queueProjectGit(async () => {
    const projectPath = `${meta.id}/`;
    const message = action === "delete"
      ? `Delete project: ${safeCommitName(meta.name)}`
      : `Rename project: ${safeCommitName(meta.name)}`;
    try {
      const addArgs = action === "delete"
        ? ["-c", "core.hooksPath=/dev/null", "add", "-A", "--", projectPath]
        : ["-c", "core.hooksPath=/dev/null", "add", "--", `${meta.id}/project.json`];
      await runCommand("git", addArgs, PROJECTS);
      await runCommand("git", ["-c", "core.hooksPath=/dev/null", "commit", "-m", message, "--", projectPath], PROJECTS, {
        GIT_AUTHOR_NAME: "Kiddo Project Manager",
        GIT_AUTHOR_EMAIL: "projects@kiddo.local"
      });
    } catch (error) {
      console.error(`Could not commit project ${action}:`, error.message);
      return { committed: false, pushed: false, owner: "system" };
    }
    try {
      await runCommand("git", ["-c", "core.hooksPath=/dev/null", "push", "origin", "main"], PROJECTS);
      return { committed: true, pushed: true, owner: "system" };
    } catch (error) {
      console.error(`Project ${action} was committed locally but could not be pushed:`, error.message);
      return { committed: true, pushed: false, owner: "system" };
    }
  });
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, browserSecurityHeaders({
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  }));
  res.end(body);
}

function publicProject(project) {
  return { ...project, html: securePreviewHtml(project.html) };
}

function clientAddress(req) {
  return req.socket.remoteAddress || "unknown";
}

function takeRateLimit(req, bucket, limit, windowMs) {
  const key = `${bucket}:${clientAddress(req)}`;
  const now = Date.now();
  if (rateBuckets.size > 1000) {
    for (const [storedKey, times] of rateBuckets) {
      if (!times.some((at) => now - at < 3_600_000)) rateBuckets.delete(storedKey);
    }
  }
  const recent = (rateBuckets.get(key) || []).filter((at) => now - at < windowMs);
  if (recent.length >= limit) return false;
  recent.push(now);
  rateBuckets.set(key, recent);
  return true;
}

function requireApiSafety(req, res) {
  if (!isSameOriginMutation(req)) {
    json(res, 403, { error: "That request did not come from Kiddo Programmer." });
    return false;
  }
  if (!takeRateLimit(req, "api", 180, 60_000)) {
    json(res, 429, { error: "That was very fast! Wait a moment, then try again." });
    return false;
  }
  return true;
}

function startEventStream(res) {
  res.writeHead(200, browserSecurityHeaders({
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    "x-accel-buffering": "no"
  }));
}

function streamEvent(res, value) {
  if (!res.writableEnded) res.write(`${JSON.stringify(value)}\n`);
}

async function bodyJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("That message is too large.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new Error("I couldn't understand that request."); }
}

function slugify(name) {
  const slug = String(name || "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return slug || "my-project";
}

function projectDir(id) {
  if (!/^[a-z0-9-]{1,80}$/.test(id)) throw new Error("Unknown project.");
  return path.join(PROJECTS, id);
}

async function existingProjectDir(id) {
  const dir = await realpath(projectDir(id));
  const root = await realpath(PROJECTS);
  if (path.dirname(dir) !== root) throw new Error("Unknown project.");
  return dir;
}

async function readProject(id) {
  const dir = await existingProjectDir(id);
  const [metaRaw, html, chatRaw, hasLogo] = await Promise.all([
    readFile(path.join(dir, "project.json"), "utf8"),
    readFile(path.join(dir, "app.html"), "utf8"),
    readFile(path.join(dir, "chat.json"), "utf8").catch(() => "[]"),
    stat(path.join(dir, "logo.svg")).then(() => true).catch(() => false)
  ]);
  return { meta: JSON.parse(metaRaw), hasLogo, html, messages: JSON.parse(chatRaw) };
}

async function saveJson(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, file);
}

async function listProjects() {
  const entries = await readdir(PROJECTS, { withFileTypes: true });
  const values = await Promise.all(entries.filter((e) => e.isDirectory()).map(async (entry) => {
    try {
      const meta = JSON.parse(await readFile(path.join(PROJECTS, entry.name, "project.json"), "utf8"));
      const hasLogo = await stat(path.join(PROJECTS, entry.name, "logo.svg")).then(() => true).catch(() => false);
      return { ...meta, hasLogo };
    }
    catch { return null; }
  }));
  return values.filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function starterPage(name) {
  const safeName = name.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeName}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; color: #23324a; background: linear-gradient(135deg, #fff6d8, #dff7ff); }
    main { width: min(90%, 620px); padding: 3rem; text-align: center; background: rgba(255,255,255,.86); border-radius: 28px; box-shadow: 0 18px 50px rgba(40,70,100,.15); }
    h1 { color: #6c4cff; font-size: clamp(2rem, 7vw, 4rem); margin: 0 0 1rem; }
    p { font-size: 1.2rem; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>${safeName}</h1>
    <p>Create anything you can imagine! Tell your coding buddy what you want to make.</p>
  </main>
</body>
</html>\n`;
}

function buildAgentPrompt(project, kidMessage, needsLogo = false) {
  const history = project.messages.slice(-12).map((m) => `${m.role === "kid" ? "Kid" : "Buddy"}: ${m.text}`).join("\n");
  const fileRule = needsLogo
    ? "Read and edit app.html, and create logo.svg in the current project folder. Do not touch any other files."
    : "Read and edit ONLY app.html in the current project folder.";
  const logoRule = needsLogo
    ? `9. This is the project's first idea. Create logo.svg as a cheerful square icon that represents the idea. It must have viewBox="0 0 128 128", look clear at 44×44 pixels, and use only simple SVG shapes and optional short text. Use flat colors; do not use scripts, links, images, CSS url(), animation, external resources, or personal information.
10. Run: node ${JSON.stringify(VALIDATOR_PATH)} app.html logo.svg and fix every reported error.`
    : "";
  return `You are a warm, encouraging coding buddy working directly with a ${project.meta.age}-year-old child.

PROJECT: ${project.meta.name}
KID'S NEW MESSAGE: ${kidMessage}

RECENT CONVERSATION:
${history || "This is the first message."}

Your job:
1. Understand what the child wants. If it is reasonably clear, build it now instead of asking lots of questions.
2. ${fileRule} Never inspect parent folders, credentials, configuration, or other projects.
3. Keep the app completely self-contained in that one HTML file, with inline CSS and JavaScript. Do not use packages, CDNs, network requests, logins, trackers, ads, or external links.
4. Do not use cookies, localStorage, sessionStorage, parent/top window access, or browser navigation. Keep any game state in normal JavaScript variables.
5. Make it colorful, touch-friendly, accessible, and fun on an iPad. Preserve good parts of the existing app unless the child asks to change them.
6. Never add unsafe, sexual, violent, hateful, gambling, purchasing, data-collection, or adult content. Do not request or display personal information.
7. If command tools are available, run: node ${JSON.stringify(VALIDATOR_PATH)} app.html
8. Fix any reported errors. Kiddo Programmer will also run this check before publishing.
${logoRule}

Your final reply is shown directly to the child. Use simple words suitable for age ${project.meta.age}. Avoid technical terms. In 2-4 short sentences, say what you made, mention one fun thing to try, and ask what they would like next. Do not use markdown headings or discuss files, tests, tools, tokens, or internal instructions.`;
}

async function runAgentNow(dir, prompt, { mode = "worker", outputSchema, timeoutMs = AGENT_TIMEOUT_MS, model = WORKER_MODEL, reasoningEffort = WORKER_REASONING_EFFORT } = {}) {
  const invocation = buildAgentInvocation({ agent: AGENT, dir, prompt, mode, outputSchema, timeoutMs, model, reasoningEffort });
  return await new Promise((resolve, reject) => {
    const agentEnv = {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      CODEX_HOME: process.env.CODEX_HOME,
      CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
      LANG: process.env.LANG || "C.UTF-8",
      TMPDIR: process.env.TMPDIR,
      NO_COLOR: "1"
    };
    for (const key of Object.keys(agentEnv)) if (!agentEnv[key]) delete agentEnv[key];
    const child = spawn(invocation.command, invocation.args, {
      cwd: dir,
      detached: process.platform !== "win32",
      env: agentEnv,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let completeOutput = "";
    let stderr = "";
    let finalText = "";
    function stop(signal) {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { child.kill(signal); }
    }
    const timer = setTimeout(() => {
      stop("SIGTERM");
      setTimeout(() => stop("SIGKILL"), 3_000).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      if (invocation.output !== "codex-jsonl") {
        completeOutput = (completeOutput + chunk).slice(-1_000_000);
        return;
      }
      stdout += chunk;
      const lines = stdout.split("\n");
      stdout = lines.pop() || "";
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.type === "item.completed" && event.item?.type === "agent_message") finalText = event.item.text;
        } catch { /* Ignore non-event output. */ }
      }
    });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-8000); });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && invocation.output !== "codex-jsonl") {
        try { finalText = extractAgentReply(completeOutput, invocation.output); }
        catch { finalText = ""; }
      }
      if (signal) reject(new Error("The coding buddy took too long. Please try again."));
      else if (code !== 0) reject(new Error(/login|sign.?in|auth/i.test(stderr) ? "The coding buddy needs a grown-up to sign in on the Pi first." : "The coding buddy had a hiccup. Please try again."));
      else if (!finalText) reject(new Error("The coding buddy finished without an answer. Please try again."));
      else resolve(finalText);
    });
  });
}

function runAgent(dir, prompt, options) {
  const { deadlineAt = Infinity, timeoutMs = AGENT_TIMEOUT_MS, ...rest } = options || {};
  return agentPool.run(
    () => runAgentNow(dir, prompt, {
      ...rest,
      timeoutMs: Number.isFinite(deadlineAt)
        ? timeoutWithinDeadline(timeoutMs, deadlineAt)
        : timeoutMs
    }),
    { deadlineAt }
  );
}

function recentHistory(project) {
  return project.messages.slice(-12).map((message) => `${message.role === "kid" ? "Kid" : "Buddy"}: ${message.text}`).join("\n");
}

async function runSupervisor(dir, project, kidMessage, needsLogo, proposedReply, deadlineAt) {
  const prompt = buildSupervisorPrompt({
    age: project.meta.age,
    projectName: project.meta.name,
    kidMessage,
    history: recentHistory(project),
    validatorPath: VALIDATOR_PATH,
    needsLogo,
    proposedReply
  });
  const schemaJson = await readFile(SUPERVISOR_SCHEMA_PATH, "utf8");
  const response = await runAgent(dir, prompt, { mode: "supervisor", outputSchema: { path: SUPERVISOR_SCHEMA_PATH, json: schemaJson }, timeoutMs: SUPERVISOR_TIMEOUT_MS, model: SUPERVISOR_MODEL, reasoningEffort: SUPERVISOR_REASONING_EFFORT, deadlineAt });
  return parseSupervisorResponse(response);
}

async function buildWithSupervision(dir, project, kidMessage, oldHtml, onProgress = () => {}) {
  const stagingDir = await mkdtemp(path.join(tmpdir(), "kiddo-build-"));
  const deadlineAt = Date.now() + BUILD_TIMEOUT_MS;
  const liveAppFile = path.join(dir, "app.html");
  const liveLogoFile = path.join(dir, "logo.svg");
  const stagedAppFile = path.join(stagingDir, "app.html");
  const stagedLogoFile = path.join(stagingDir, "logo.svg");
  const needsLogo = await stat(liveLogoFile).then(() => false).catch(() => true);
  let lastReview = null;

  try {
    await copyFile(liveAppFile, stagedAppFile);
    const outcome = await repeatUntilApproved({
      maxRounds: MAX_SUPERVISOR_ROUNDS,
      attempt: async ({ round, feedback }) => {
        onProgress(round === 0 ? "building" : "fixing");
        const reply = round === 0
          ? await runAgent(stagingDir, buildAgentPrompt(project, kidMessage, needsLogo), { deadlineAt })
          : await runAgent(stagingDir, buildRevisionPrompt({
              age: project.meta.age,
              projectName: project.meta.name,
              kidMessage,
              feedback,
              validatorPath: VALIDATOR_PATH,
              needsLogo
            }), { deadlineAt });

        onProgress("checking");
        const html = await readFile(stagedAppFile, "utf8").catch(() => "");
        const logo = needsLogo ? await readFile(stagedLogoFile, "utf8").catch(() => "") : null;
        const appValidation = validateHtml(html);
        const logoValidation = needsLogo ? validateLogoSvg(logo) : { ok: true, errors: [], warnings: [] };
        const validation = {
          ok: appValidation.ok && logoValidation.ok,
          errors: [...appValidation.errors, ...logoValidation.errors],
          warnings: [...appValidation.warnings, ...logoValidation.warnings]
        };
        if (!validation.ok) {
          lastReview = {
            verdict: "improve",
            feedback: `The automatic checks found these errors:\n- ${validation.errors.join("\n- ")}`,
            checks: ["Deterministic HTML and JavaScript validation failed."]
          };
          console.warn(reviewRejectionLog(project.meta.id, round + 1, MAX_SUPERVISOR_ROUNDS, "automatic validation", lastReview.feedback));
        } else {
          onProgress("reviewing");
          lastReview = await runSupervisor(stagingDir, project, kidMessage, needsLogo, reply, deadlineAt);
          if (lastReview.verdict === "improve") {
            console.warn(reviewRejectionLog(project.meta.id, round + 1, MAX_SUPERVISOR_ROUNDS, "supervisor", lastReview.feedback));
          }
        }
        return { html, logo, reply, validation, review: lastReview };
      }
    });
    if (outcome.approved) {
      onProgress("finishing");
      const publishFile = `${liveAppFile}.${randomUUID()}.tmp`;
      await writeFile(publishFile, outcome.html);
      if (needsLogo) {
        const publishLogoFile = `${liveLogoFile}.${randomUUID()}.tmp`;
        await writeFile(publishLogoFile, outcome.logo);
        await rename(publishLogoFile, liveLogoFile);
      }
      await rename(publishFile, liveAppFile);
      return { ...outcome, published: true, logoCreated: needsLogo };
    }
  } catch (error) {
    console.error("Reviewed build failed:", error.message);
    return {
      html: oldHtml,
      reply: "My checker had a little wobble, so I kept your working app safe. Please try your idea again!",
      validation: { ok: true, errors: [], warnings: ["The reviewed build could not finish; the live app was not changed."] },
      review: lastReview,
      published: false
    };
  } finally {
    if (stagingDir.startsWith(`${tmpdir()}${path.sep}kiddo-build-`)) {
      await rm(stagingDir, { recursive: true, force: true }).catch((error) => console.error("Could not clean staging folder:", error.message));
    }
  }

  return {
    html: oldHtml,
    reply: "I couldn't finish that change, but your working app is still safe. Please ask a grown-up to check the Raspberry Pi.",
    validation: { ok: true, errors: [], warnings: ["The reviewed update was not accepted; the previous version was restored."] },
    review: lastReview,
    published: false
  };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(res, 200, { ok: true });
  }
  if (!requireApiSafety(req, res)) return;
  if (req.method === "GET" && url.pathname === "/api/projects") {
    return json(res, 200, { projects: await listProjects() });
  }
  if (req.method === "POST" && url.pathname === "/api/projects") {
    if ((await listProjects()).length >= MAX_PROJECTS) return json(res, 409, { error: "This Raspberry Pi has reached its project limit. Ask a grown-up to archive an old project." });
    const input = await bodyJson(req);
    const name = String(input.name || "").trim().slice(0, 60);
    const age = Number(input.age);
    if (name.length < 2) return json(res, 400, { error: "Please give your project a name." });
    if (!Number.isInteger(age) || age < 5 || age > 17) return json(res, 400, { error: "Please choose an age from 5 to 17." });
    let id = slugify(name);
    try { await stat(projectDir(id)); id = `${id}-${randomBytes(2).toString("hex")}`; } catch { /* available */ }
    const dir = projectDir(id);
    await mkdir(dir);
    const now = new Date().toISOString();
    const meta = { id, name, age, createdAt: now, updatedAt: now };
    await Promise.all([
      saveJson(path.join(dir, "project.json"), meta),
      writeFile(path.join(dir, "app.html"), starterPage(name)),
      saveJson(path.join(dir, "chat.json"), [{ id: randomUUID(), role: "buddy", text: `Hi! I’m your coding buddy. What should we turn ${name} into?`, at: now }])
    ]);
    const versionControl = await recordProjectVersion(meta, "create");
    return json(res, 201, { ...publicProject(await readProject(id)), versionControl });
  }

  const match = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)(?:\/(chat|logo))?$/);
  if (!match) return json(res, 404, { error: "Not found." });
  const [, id, action] = match;
  if (req.method === "GET" && !action) return json(res, 200, publicProject(await readProject(id)));
  if (req.method === "PATCH" && !action) {
    if (activeRuns.has(id)) return json(res, 409, { error: "Wait for Builder Bunny to finish before renaming this project." });
    const input = await bodyJson(req);
    const name = String(input.name || "").trim().slice(0, 60);
    if (name.length < 2) return json(res, 400, { error: "Please give your project a name." });
    const project = await readProject(id);
    let versionControl = { committed: false, pushed: false, owner: "system" };
    if (name !== project.meta.name) {
      project.meta.name = name;
      project.meta.updatedAt = new Date().toISOString();
      await saveJson(path.join(await existingProjectDir(id), "project.json"), project.meta);
      versionControl = await recordProjectManagement(project.meta, "rename");
    }
    return json(res, 200, { ...publicProject(await readProject(id)), versionControl });
  }
  if (req.method === "DELETE" && !action) {
    if (activeRuns.has(id)) return json(res, 409, { error: "Wait for Builder Bunny to finish before deleting this project." });
    const project = await readProject(id);
    const dir = await existingProjectDir(id);
    await rm(dir, { recursive: true });
    const versionControl = await recordProjectManagement(project.meta, "delete");
    return json(res, 200, { deleted: true, id, versionControl });
  }
  if (req.method === "GET" && action === "logo") {
    const logo = await readFile(path.join(await existingProjectDir(id), "logo.svg"));
    res.writeHead(200, {
      "content-type": "image/svg+xml; charset=utf-8",
      "content-length": logo.length,
      "cache-control": "no-cache",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      "x-content-type-options": "nosniff"
    });
    res.end(logo);
    return;
  }
  if (req.method === "POST" && action === "chat") {
    if (activeRuns.has(id)) return json(res, 409, { error: "Your coding buddy is already working on this project." });
    if (pendingBuilds >= MAX_PENDING_BUILDS) return json(res, 503, { error: "The coding buddy has a full idea queue. Please wait a moment, then try again." });
    activeRuns.add(id);
    pendingBuilds += 1;
    try {
      const input = await bodyJson(req);
      const message = String(input.message || "").trim().slice(0, 2000);
      if (!message) return json(res, 400, { error: "Type an idea first." });
      startEventStream(res);
      streamEvent(res, { type: "progress", stage: "building" });
      const project = await readProject(id);
      const dir = await existingProjectDir(id);
      const oldHtml = project.html;
      const kidEntry = { id: randomUUID(), role: "kid", text: message, at: new Date().toISOString() };
      project.messages.push(kidEntry);
      if (project.messages.length > CHAT_HISTORY_LIMIT) project.messages.splice(0, project.messages.length - CHAT_HISTORY_LIMIT);
      await saveJson(path.join(dir, "chat.json"), project.messages);
      const result = await buildWithSupervision(dir, project, message, oldHtml, (stage) => streamEvent(res, { type: "progress", stage }));
      const { html, reply, validation, review } = result;
      const buddyEntry = { id: randomUUID(), role: "buddy", text: reply.trim(), at: new Date().toISOString() };
      project.messages.push(buddyEntry);
      if (project.messages.length > CHAT_HISTORY_LIMIT) project.messages.splice(0, project.messages.length - CHAT_HISTORY_LIMIT);
      project.meta.updatedAt = buddyEntry.at;
      await Promise.all([
        saveJson(path.join(dir, "chat.json"), project.messages),
        saveJson(path.join(dir, "project.json"), project.meta)
      ]);
      let versionControl = { committed: false, pushed: false, owner: "supervisor" };
      if (result.published) {
        streamEvent(res, { type: "progress", stage: "saving" });
        versionControl = await recordProjectVersion(project.meta, "update", review);
      }
      streamEvent(res, { type: "complete", result: { html: securePreviewHtml(html), published: result.published, message: buddyEntry, validation, review: { verdict: review?.verdict || "unavailable", checks: review?.checks || [] }, versionControl } });
      res.end();
      return;
    } catch (error) {
      if (res.headersSent) {
        console.error("Streamed build failed:", error.message);
        streamEvent(res, { type: "error", error: "Something got stuck on the Raspberry Pi. Your app is safe. Please try again." });
        res.end();
        return;
      }
      throw error;
    } finally {
      pendingBuilds -= 1;
      activeRuns.delete(id);
    }
  }
  return json(res, 405, { error: "That action is not allowed." });
}

async function serveStatic(req, res, url) {
  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!/^[a-zA-Z0-9._-]+$/.test(file)) return json(res, 404, { error: "Not found." });
  try {
    const body = await readFile(path.join(PUBLIC, file));
    const type = file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".css") ? "text/css; charset=utf-8" : file.endsWith(".svg") ? "image/svg+xml; charset=utf-8" : "application/javascript; charset=utf-8";
    res.writeHead(200, browserSecurityHeaders({ "content-type": type, "content-length": body.length, "cache-control": "no-cache" }));
    res.end(body);
  } catch { json(res, 404, { error: "Not found." }); }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://kiddo.local");
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    const notFound = error.code === "ENOENT";
    json(res, notFound ? 404 : 500, {
      error: notFound
        ? "I couldn't find that project. Please go back and choose it again."
        : "Something got stuck on the Raspberry Pi. Your app is safe. Please try again."
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Kiddo Programmer is ready.`);
  console.log(`On this Pi: http://localhost:${PORT}`);
  console.log(`On the iPad: http://<PI-IP>:${PORT}`);
});
