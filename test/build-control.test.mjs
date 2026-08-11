import assert from "node:assert/strict";
import test from "node:test";
import { createTaskPool, reviewRejectionLog, timeoutWithinDeadline } from "../scripts/build-control.mjs";

test("limits concurrent tasks without serializing the whole queue", async () => {
  const pool = createTaskPool(2);
  let active = 0;
  let peak = 0;
  const releases = [];
  const task = () => pool.run(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => releases.push(resolve));
    active -= 1;
  });

  const runs = [task(), task(), task()];
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 2);
  assert.equal(peak, 2);
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 2);
  releases.splice(0).forEach((release) => release());
  await Promise.all(runs);
});

test("expires work while it is waiting for an agent slot", async () => {
  const pool = createTaskPool(1);
  let release;
  const first = pool.run(() => new Promise((resolve) => { release = resolve; }));
  const queued = pool.run(() => assert.fail("expired task should not start"), { deadlineAt: Date.now() + 20 });
  await assert.rejects(queued, /took too long/);
  release();
  await first;
});

test("caps each agent timeout at the remaining build budget", () => {
  assert.equal(timeoutWithinDeadline(240_000, 105_000, 100_000), 5_000);
  assert.equal(timeoutWithinDeadline(2_000, 105_000, 100_000), 2_000);
  assert.throws(() => timeoutWithinDeadline(2_000, 100_000, 100_000), /took too long/);
});

test("writes concise one-line review rejection logs", () => {
  const line = reviewRejectionLog("sand-box", 2, 3, "automatic validation", "Missing logo.\nAdd a viewBox.");
  assert.equal(line, "Build review rejected sand-box (round 2/3, automatic validation): Missing logo. Add a viewBox.");
});
