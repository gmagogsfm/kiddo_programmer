import test from "node:test";
import assert from "node:assert/strict";
import { buildRevisionPrompt, buildSupervisorPrompt, parseSupervisorResponse } from "../scripts/supervision.mjs";

test("parses a valid supervisor result", () => {
  assert.deepEqual(parseSupervisorResponse('{"verdict":"pass","feedback":"Ready.","checks":["Syntax passed"],"commitMessage":"Add the star timer"}'), {
    verdict: "pass",
    feedback: "Ready.",
    checks: ["Syntax passed"],
    commitMessage: "Add the star timer"
  });
});

test("rejects malformed supervisor output", () => {
  assert.throws(() => parseSupervisorResponse("VERDICT: PASS"), /unreadable/);
  assert.throws(() => parseSupervisorResponse('{"verdict":"maybe","feedback":"Unsure","checks":[],"commitMessage":"Review app"}'), /invalid verdict/);
});

test("supervisor prompt is read-only and includes the request", () => {
  const prompt = buildSupervisorPrompt({ age: 9, projectName: "Stars", kidMessage: "Add a timer", history: "", validatorPath: "/validator.mjs" });
  assert.match(prompt, /Do not edit, create, or delete/);
  assert.match(prompt, /Add a timer/);
  assert.match(prompt, /validator\.mjs/);
  assert.match(prompt, /version gatekeeper/);
});

test("revision prompt passes supervisor feedback to the worker", () => {
  const prompt = buildRevisionPrompt({ age: 9, projectName: "Stars", kidMessage: "Add a timer", feedback: "Reset the timer on restart.", validatorPath: "/validator.mjs" });
  assert.match(prompt, /Reset the timer on restart/);
  assert.match(prompt, /Edit ONLY app\.html/);
});
