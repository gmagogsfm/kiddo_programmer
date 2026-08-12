import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentInvocation, classifyAgentFailure, extractAgentReply } from "../scripts/coding-agents.mjs";

const common = { dir: "/tmp/project", prompt: "Build a game", model: "test-model", reasoningEffort: "low" };

test("Codex uses its documented non-interactive sandbox arguments", () => {
  const call = buildAgentInvocation({ ...common, agent: "codex", mode: "supervisor", outputSchema: { path: "/tmp/schema.json" } });
  assert.deepEqual(call.args.slice(0, 6), ["exec", "--json", "--model", "test-model", "--sandbox", "read-only"]);
  assert.ok(call.args.includes("--output-schema"));
  assert.ok(call.args.includes('model_reasoning_effort="low"'));
});

test("Claude uses print JSON, explicit model and low effort", () => {
  const call = buildAgentInvocation({ ...common, agent: "claude", outputSchema: { json: '{"type":"object"}' } });
  assert.deepEqual(call.args.slice(0, 5), ["-p", "--output-format", "json", "--model", "test-model"]);
  assert.deepEqual(call.args.slice(call.args.indexOf("--effort"), call.args.indexOf("--effort") + 2), ["--effort", "low"]);
  assert.deepEqual(call.args.slice(call.args.indexOf("--tools"), call.args.indexOf("--tools") + 2), ["--tools", "Read,Edit,Write"]);
  assert.ok(call.args.includes("--json-schema"));
  assert.equal(extractAgentReply('{"result":"All done"}', call.output), "All done");
});

test("Antigravity uses print mode, its sandbox and an explicit model", () => {
  const call = buildAgentInvocation({ ...common, agent: "antigravity", timeoutMs: 61_000, outputSchema: { path: "/tmp/schema.json" } });
  assert.deepEqual(call.args.slice(0, 2), ["--model", "test-model"]);
  assert.deepEqual(call.args.slice(call.args.indexOf("--effort"), call.args.indexOf("--effort") + 2), ["--effort", "low"]);
  assert.deepEqual(call.args.slice(call.args.indexOf("--print-timeout"), call.args.indexOf("--print-timeout") + 2), ["--print-timeout", "61s"]);
  assert.ok(call.args.includes("--sandbox"));
  assert.ok(call.args.includes("--disable-slash-commands"));
  assert.ok(call.args.includes("--json-schema"));
  assert.deepEqual(call.args.slice(-2), ["--print", "Build a game"]);
  assert.equal(extractAgentReply('{"status":"SUCCESS","response":"Ready\\n"}', call.output), "Ready");
});

test("classifies quota exhaustion separately from authentication and generic failures", () => {
  for (const message of [
    "You've hit your usage limit.",
    '{"type":"error","code":"usage_limit_exceeded"}',
    "rate_limit_reached: workspace_member_credits_depleted",
    "RESOURCE_EXHAUSTED: quota exceeded",
    "HTTP 429 Too Many Requests",
    "Credit balance is too low"
  ]) assert.equal(classifyAgentFailure(message), "quota", message);
  assert.equal(classifyAgentFailure("Authentication required: please sign in"), "auth");
  assert.equal(classifyAgentFailure("Unexpected worker crash"), "generic");
});
