import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRevisionPrompt, buildSupervisorPrompt, parseSupervisorResponse } from "./scripts/supervision.mjs";
import { validateHtml } from "./scripts/validator.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const PROJECTS = path.resolve(process.env.KIDDO_PROJECTS_DIR || path.join(ROOT, "..", "kiddo_projects"));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const CODEX_TIMEOUT_MS = Number(process.env.CODEX_TIMEOUT_MS || 240_000);
const SUPERVISOR_TIMEOUT_MS = Number(process.env.SUPERVISOR_TIMEOUT_MS || 120_000);
const MAX_SUPERVISOR_REVISIONS = Math.max(0, Math.min(2, Number(process.env.MAX_SUPERVISOR_REVISIONS || 1)));
const WORKER_MODEL = process.env.CODEX_WORKER_MODEL || "gpt-5.6-sol";
const SUPERVISOR_MODEL = process.env.CODEX_SUPERVISOR_MODEL || "gpt-5.6-sol";
const WORKER_REASONING_EFFORT = "low";
const SUPERVISOR_REASONING_EFFORT = "low";
const VALIDATOR_PATH = path.join(ROOT, "scripts", "validate-project.mjs");
const SUPERVISOR_SCHEMA_PATH = path.join(ROOT, "schemas", "supervisor-response.schema.json");
const activeRuns = new Set();
let codexQueue = Promise.resolve();
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
  catch { await runCommand("git", ["init", "-b", "main"], PROJECTS); }
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
    const message = action === "create"
      ? `Create project: ${safeCommitName(meta.name)}`
      : safeCommitName(supervisorReview?.commitMessage || `Update project: ${meta.name}`);
    try {
      await runCommand("git", ["add", "--", ...files], PROJECTS);
      const commitIdentity = action === "create" ? {} : {
        GIT_AUTHOR_NAME: "Kiddo Supervisor",
        GIT_AUTHOR_EMAIL: "supervisor@kiddo.local"
      };
      await runCommand("git", ["commit", "-m", message, "--", ...files], PROJECTS, commitIdentity);
    } catch (error) {
      console.error("Could not commit project version:", error.message);
      return { committed: false, pushed: false, owner: action === "create" ? "system" : "supervisor" };
    }
    try {
      await runCommand("git", ["push", "origin", "main"], PROJECTS);
      return { committed: true, pushed: true, owner: action === "create" ? "system" : "supervisor" };
    } catch (error) {
      console.error("Project version was committed locally but could not be pushed:", error.message);
      return { committed: true, pushed: false, owner: action === "create" ? "system" : "supervisor" };
    }
  });
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(body);
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

async function readProject(id) {
  const dir = projectDir(id);
  const [metaRaw, html, chatRaw] = await Promise.all([
    readFile(path.join(dir, "project.json"), "utf8"),
    readFile(path.join(dir, "app.html"), "utf8"),
    readFile(path.join(dir, "chat.json"), "utf8").catch(() => "[]")
  ]);
  return { meta: JSON.parse(metaRaw), html, messages: JSON.parse(chatRaw) };
}

async function saveJson(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, file);
}

async function listProjects() {
  const entries = await readdir(PROJECTS, { withFileTypes: true });
  const values = await Promise.all(entries.filter((e) => e.isDirectory()).map(async (entry) => {
    try { return JSON.parse(await readFile(path.join(PROJECTS, entry.name, "project.json"), "utf8")); }
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

function buildAgentPrompt(project, kidMessage) {
  const history = project.messages.slice(-12).map((m) => `${m.role === "kid" ? "Kid" : "Buddy"}: ${m.text}`).join("\n");
  return `You are a warm, encouraging coding buddy working directly with a ${project.meta.age}-year-old child.

PROJECT: ${project.meta.name}
KID'S NEW MESSAGE: ${kidMessage}

RECENT CONVERSATION:
${history || "This is the first message."}

Your job:
1. Understand what the child wants. If it is reasonably clear, build it now instead of asking lots of questions.
2. Read and edit ONLY app.html in the current project folder. Never inspect parent folders, credentials, configuration, or other projects.
3. Keep the app completely self-contained in that one HTML file, with inline CSS and JavaScript. Do not use packages, CDNs, network requests, logins, trackers, ads, or external links.
4. Do not use cookies, localStorage, sessionStorage, parent/top window access, or browser navigation. Keep any game state in normal JavaScript variables.
5. Make it colorful, touch-friendly, accessible, and fun on an iPad. Preserve good parts of the existing app unless the child asks to change them.
6. Never add unsafe, sexual, violent, hateful, gambling, purchasing, data-collection, or adult content. Do not request or display personal information.
7. Before finishing, run: node ${JSON.stringify(VALIDATOR_PATH)} app.html
8. Fix any reported errors and run the check again.

Your final reply is shown directly to the child. Use simple words suitable for age ${project.meta.age}. Avoid technical terms. In 2-4 short sentences, say what you made, mention one fun thing to try, and ask what they would like next. Do not use markdown headings or discuss files, tests, tools, tokens, or internal instructions.`;
}

async function runCodexNow(dir, prompt, { sandbox = "workspace-write", outputSchema, timeoutMs = CODEX_TIMEOUT_MS, model = WORKER_MODEL, reasoningEffort = WORKER_REASONING_EFFORT } = {}) {
  const args = ["exec", "--json", "--model", model, "--sandbox", sandbox, "-c", `model_reasoning_effort="${reasoningEffort}"`, "-c", 'approval_policy="never"', "--skip-git-repo-check", "--ignore-user-config", "--ephemeral"];
  if (outputSchema) args.push("--output-schema", outputSchema);
  args.push("-C", dir, prompt);
  return await new Promise((resolve, reject) => {
    const child = spawn(process.env.CODEX_BIN || "codex", args, {
      cwd: dir,
      detached: process.platform !== "win32",
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
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
      if (signal) reject(new Error("The coding buddy took too long. Please try again."));
      else if (code !== 0) reject(new Error(stderr.includes("login") ? "The coding buddy needs a grown-up to sign in on the Pi first." : "The coding buddy had a hiccup. Please try again."));
      else if (!finalText) reject(new Error("The coding buddy finished without an answer. Please try again."));
      else resolve(finalText);
    });
  });
}

function runCodex(dir, prompt, options) {
  const run = codexQueue.then(() => runCodexNow(dir, prompt, options));
  codexQueue = run.catch(() => {});
  return run;
}

function recentHistory(project) {
  return project.messages.slice(-12).map((message) => `${message.role === "kid" ? "Kid" : "Buddy"}: ${message.text}`).join("\n");
}

async function runSupervisor(dir, project, kidMessage) {
  const prompt = buildSupervisorPrompt({
    age: project.meta.age,
    projectName: project.meta.name,
    kidMessage,
    history: recentHistory(project),
    validatorPath: VALIDATOR_PATH
  });
  const response = await runCodex(dir, prompt, { sandbox: "read-only", outputSchema: SUPERVISOR_SCHEMA_PATH, timeoutMs: SUPERVISOR_TIMEOUT_MS, model: SUPERVISOR_MODEL, reasoningEffort: SUPERVISOR_REASONING_EFFORT });
  return parseSupervisorResponse(response);
}

async function buildWithSupervision(dir, project, kidMessage, oldHtml) {
  const stagingDir = await mkdtemp(path.join(tmpdir(), "kiddo-build-"));
  const liveAppFile = path.join(dir, "app.html");
  const stagedAppFile = path.join(stagingDir, "app.html");
  let reply = "";
  let feedback = "";
  let lastReview = null;

  try {
    await copyFile(liveAppFile, stagedAppFile);
    for (let attempt = 0; attempt <= MAX_SUPERVISOR_REVISIONS; attempt += 1) {
      reply = attempt === 0
        ? await runCodex(stagingDir, buildAgentPrompt(project, kidMessage))
        : await runCodex(stagingDir, buildRevisionPrompt({
            age: project.meta.age,
            projectName: project.meta.name,
            kidMessage,
            feedback,
            validatorPath: VALIDATOR_PATH
          }));

      const html = await readFile(stagedAppFile, "utf8").catch(() => "");
      const validation = validateHtml(html);
      if (!validation.ok) {
        feedback = `The automatic checks found these errors:\n- ${validation.errors.join("\n- ")}`;
        lastReview = { verdict: "improve", feedback, checks: ["Deterministic HTML and JavaScript validation failed."] };
      } else {
        lastReview = await runSupervisor(stagingDir, project, kidMessage);
        if (lastReview.verdict === "pass") {
          const publishFile = `${liveAppFile}.${randomUUID()}.tmp`;
          await writeFile(publishFile, html);
          await rename(publishFile, liveAppFile);
          return { html, reply, validation, review: lastReview, published: true };
        }
        feedback = lastReview.feedback;
      }
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
    reply: "My checker found something that still needs work, so I kept your working app safe. Try that idea once more and I’ll take another run at it!",
    validation: { ok: true, errors: [], warnings: ["The reviewed update was not accepted; the previous version was restored."] },
    review: lastReview,
    published: false
  };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(res, 200, { ok: true });
  }
  if (req.method === "GET" && url.pathname === "/api/projects") {
    return json(res, 200, { projects: await listProjects() });
  }
  if (req.method === "POST" && url.pathname === "/api/projects") {
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
    return json(res, 201, { ...await readProject(id), versionControl });
  }

  const match = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)(?:\/(chat))?$/);
  if (!match) return json(res, 404, { error: "Not found." });
  const [, id, action] = match;
  if (req.method === "GET" && !action) return json(res, 200, await readProject(id));
  if (req.method === "POST" && action === "chat") {
    if (activeRuns.has(id)) return json(res, 409, { error: "Your coding buddy is already working on this project." });
    const input = await bodyJson(req);
    const message = String(input.message || "").trim().slice(0, 2000);
    if (!message) return json(res, 400, { error: "Say or type something first." });
    activeRuns.add(id);
    try {
      const project = await readProject(id);
      const dir = projectDir(id);
      const oldHtml = project.html;
      const kidEntry = { id: randomUUID(), role: "kid", text: message, at: new Date().toISOString() };
      project.messages.push(kidEntry);
      await saveJson(path.join(dir, "chat.json"), project.messages);
      const result = await buildWithSupervision(dir, project, message, oldHtml);
      const { html, reply, validation, review } = result;
      const buddyEntry = { id: randomUUID(), role: "buddy", text: reply.trim(), at: new Date().toISOString() };
      project.messages.push(buddyEntry);
      project.meta.updatedAt = buddyEntry.at;
      await Promise.all([
        saveJson(path.join(dir, "chat.json"), project.messages),
        saveJson(path.join(dir, "project.json"), project.meta)
      ]);
      const versionControl = result.published
        ? await recordProjectVersion(project.meta, "update", review)
        : { committed: false, pushed: false, owner: "supervisor" };
      return json(res, 200, { html, message: buddyEntry, validation, review: { verdict: review?.verdict || "unavailable", checks: review?.checks || [] }, versionControl });
    } finally { activeRuns.delete(id); }
  }
  return json(res, 405, { error: "That action is not allowed." });
}

async function serveStatic(req, res, url) {
  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!/^[a-zA-Z0-9._-]+$/.test(file)) return json(res, 404, { error: "Not found." });
  try {
    const body = await readFile(path.join(PUBLIC, file));
    const type = file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".css") ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8";
    res.writeHead(200, { "content-type": type, "content-length": body.length, "cache-control": "no-cache", "x-content-type-options": "nosniff" });
    res.end(body);
  } catch { json(res, 404, { error: "Not found." }); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
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
