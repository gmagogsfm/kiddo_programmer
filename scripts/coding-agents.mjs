const DEFAULTS = Object.freeze({
  codex: { binary: "codex", model: "gpt-5.6-sol" },
  claude: { binary: "claude", model: "sonnet" },
  antigravity: { binary: "agy", model: "gemini-3.6-flash-low" }
});

export const SUPPORTED_AGENTS = Object.freeze(Object.keys(DEFAULTS));

export function classifyAgentFailure(output) {
  const text = String(output || "").toLowerCase();
  if (/you(?:'|’)ve hit your usage limit|usage_limit_exceeded|rate_limit_reached|workspace_(?:member|owner)_(?:credits_depleted|usage_limit_reached)|insufficient_quota|resource_exhausted|too many requests|\b429\b|\b(?:rate|usage) limit (?:reached|exceeded|exhausted)|\bquota (?:reached|exceeded|exhausted)|\b(?:credits?|balance) (?:depleted|exhausted|used up)|credit balance.{0,30}too low|out of credits/.test(text)) return "quota";
  if (/login|sign.?in|not authenticated|authentication required|unauthorized|invalid (?:api )?key|auth token/.test(text)) return "auth";
  return "generic";
}

export function normalizeAgent(value = "codex") {
  const agent = String(value).trim().toLowerCase();
  if (!SUPPORTED_AGENTS.includes(agent)) {
    throw new Error(`Unsupported coding agent: ${value}`);
  }
  return agent;
}

export function defaultModel(agent) {
  return DEFAULTS[normalizeAgent(agent)].model;
}

export function buildAgentInvocation({
  agent,
  dir,
  prompt,
  mode = "worker",
  model = defaultModel(agent),
  reasoningEffort = "low",
  outputSchema,
  timeoutMs = 240_000
}) {
  agent = normalizeAgent(agent);
  const readOnly = mode === "supervisor";

  if (agent === "codex") {
    const args = [
      "exec", "--json", "--model", model,
      "--sandbox", readOnly ? "read-only" : "workspace-write",
      "-c", `model_reasoning_effort="${reasoningEffort}"`,
      "-c", 'approval_policy="never"',
      "--skip-git-repo-check", "--ignore-user-config", "--ephemeral"
    ];
    if (outputSchema?.path) args.push("--output-schema", outputSchema.path);
    args.push("-C", dir, prompt);
    return { command: process.env.KIDDO_AGENT_BIN || process.env.CODEX_BIN || DEFAULTS.codex.binary, args, output: "codex-jsonl" };
  }

  if (agent === "claude") {
    const args = [
      "-p", "--output-format", "json",
      "--model", model,
      "--effort", reasoningEffort,
      "--max-turns", readOnly ? "8" : "24",
      "--bare", "--safe-mode", "--disable-slash-commands",
      "--strict-mcp-config", "--no-session-persistence",
      "--tools", readOnly ? "Read" : "Read,Edit,Write",
      "--dangerously-skip-permissions"
    ];
    if (outputSchema?.json) args.push("--json-schema", outputSchema.json);
    args.push(prompt);
    return { command: process.env.KIDDO_AGENT_BIN || process.env.CLAUDE_BIN || DEFAULTS.claude.binary, args, output: "claude-json" };
  }

  const printTimeout = `${Math.max(1, Math.ceil(timeoutMs / 1000))}s`;
  const args = [
    "--model", model,
    "--effort", reasoningEffort,
    "--print-timeout", printTimeout,
    "--sandbox",
    "--disable-slash-commands",
    "--dangerously-skip-permissions",
    "--output-format", "json"
  ];
  if (outputSchema?.path) args.push("--json-schema", outputSchema.path);
  args.push("--print", prompt);
  return {
    command: process.env.KIDDO_AGENT_BIN || process.env.AGY_BIN || DEFAULTS.antigravity.binary,
    args,
    output: "antigravity-json"
  };
}

export function extractAgentReply(output, format) {
  const text = String(output || "").trim();
  if (format === "text") return text;
  if (format === "claude-json") {
    const value = JSON.parse(text);
    if (value.structured_output !== undefined) return JSON.stringify(value.structured_output);
    if (typeof value.result === "string") return value.result.trim();
    return "";
  }
  if (format === "antigravity-json") {
    const value = JSON.parse(text);
    return typeof value.response === "string" ? value.response.trim() : "";
  }
  throw new Error(`Unsupported complete-output format: ${format}`);
}
