import test from "node:test";
import assert from "node:assert/strict";
import { buildRevisionPrompt, buildSupervisorPrompt, parseSupervisorResponse, repeatUntilApproved } from "../scripts/supervision.mjs";

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

test("first-request prompts include the logo in work and review", () => {
  const supervisor = buildSupervisorPrompt({ age: 9, projectName: "Stars", kidMessage: "Make a space game", history: "", validatorPath: "/validator.mjs", needsLogo: true });
  const revision = buildRevisionPrompt({ age: 9, projectName: "Stars", kidMessage: "Make a space game", feedback: "Make the logo clearer.", validatorPath: "/validator.mjs", needsLogo: true });
  assert.match(supervisor, /app\.html and created logo\.svg/);
  assert.match(supervisor, /app\.html logo\.svg/);
  assert.match(revision, /Edit ONLY app\.html and logo\.svg/);
});

test("review feedback repeats until the supervisor approves", async () => {
  const received = [];
  const outcome = await repeatUntilApproved({
    maxRounds: 5,
    attempt: async ({ round, feedback }) => {
      received.push(feedback);
      return {
        html: `<p>round ${round}</p>`,
        reply: "Done",
        validation: { ok: true },
        review: round < 2
          ? { verdict: "improve", feedback: `fix ${round}`, checks: [] }
          : { verdict: "pass", feedback: "Ready", checks: [], commitMessage: "Finish app" }
      };
    }
  });
  assert.equal(outcome.approved, true);
  assert.deepEqual(received, ["", "fix 0", "fix 1"]);
  assert.equal(outcome.html, "<p>round 2</p>");
});
