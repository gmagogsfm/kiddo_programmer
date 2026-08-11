const DEADLINE_MESSAGE = "The build took too long. Please try again.";

export function timeoutWithinDeadline(timeoutMs, deadlineAt, now = Date.now()) {
  const remaining = Math.floor(deadlineAt - now);
  if (remaining <= 0) throw new Error(DEADLINE_MESSAGE);
  return Math.max(1, Math.min(timeoutMs, remaining));
}

export function createTaskPool(limit) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Task pool limit must be a positive integer.");
  let active = 0;
  const queue = [];

  function drain() {
    while (active < limit && queue.length) {
      const entry = queue.shift();
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.deadlineAt <= Date.now()) {
        entry.reject(new Error(DEADLINE_MESSAGE));
        continue;
      }
      active += 1;
      Promise.resolve()
        .then(entry.task)
        .then(entry.resolve, entry.reject)
        .finally(() => {
          active -= 1;
          drain();
        });
    }
  }

  return {
    run(task, { deadlineAt = Infinity } = {}) {
      return new Promise((resolve, reject) => {
        const entry = { task, resolve, reject, deadlineAt, timer: null };
        if (Number.isFinite(deadlineAt)) {
          const waitMs = deadlineAt - Date.now();
          if (waitMs <= 0) return reject(new Error(DEADLINE_MESSAGE));
          entry.timer = setTimeout(() => {
            const index = queue.indexOf(entry);
            if (index !== -1) queue.splice(index, 1);
            reject(new Error(DEADLINE_MESSAGE));
          }, waitMs);
        }
        queue.push(entry);
        drain();
      });
    }
  };
}

export function reviewRejectionLog(projectId, round, maxRounds, source, feedback) {
  const summary = String(feedback || "No feedback provided.")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return `Build review rejected ${projectId} (round ${round}/${maxRounds}, ${source}): ${summary}`;
}
