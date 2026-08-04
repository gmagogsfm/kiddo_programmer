export function parseSupervisorResponse(text) {
  let value;
  try { value = JSON.parse(text); }
  catch { throw new Error("The supervisor returned an unreadable review."); }
  if (!value || !["pass", "improve"].includes(value.verdict)) throw new Error("The supervisor returned an invalid verdict.");
  if (typeof value.feedback !== "string" || !value.feedback.trim()) throw new Error("The supervisor did not provide feedback.");
  if (!Array.isArray(value.checks) || value.checks.some((item) => typeof item !== "string")) throw new Error("The supervisor returned invalid check results.");
  if (typeof value.commitMessage !== "string" || value.commitMessage.trim().length < 3 || value.commitMessage.trim().length > 72) throw new Error("The supervisor returned an invalid commit message.");
  return { verdict: value.verdict, feedback: value.feedback.trim(), checks: value.checks.map((item) => item.trim()).filter(Boolean), commitMessage: value.commitMessage.trim() };
}

export async function repeatUntilApproved({ maxRounds, attempt }) {
  let feedback = "";
  let lastResult = null;
  for (let round = 0; round < maxRounds; round += 1) {
    lastResult = await attempt({ round, feedback });
    if (lastResult.review.verdict === "pass") return { approved: true, ...lastResult };
    feedback = lastResult.review.feedback;
  }
  return { approved: false, ...lastResult };
}

export function buildSupervisorPrompt({ age, projectName, kidMessage, history, validatorPath, needsLogo = false }) {
  const files = needsLogo ? "app.html and created logo.svg" : "app.html";
  const validationCommand = `node ${JSON.stringify(validatorPath)} app.html${needsLogo ? " logo.svg" : ""}`;
  const logoReview = needsLogo
    ? "6. Inspect logo.svg. It must clearly match the app idea, remain recognizable at 44×44 pixels, use only self-contained SVG shapes and text, and contain no scripts, links, external resources, or personal information.\n7."
    : "6.";
  return `You are an independent quality supervisor for a web app made for a ${age}-year-old child. A separate worker agent edited ${files}.

PROJECT: ${projectName}
CHILD'S REQUEST: ${kidMessage}

RECENT CONVERSATION:
${history || "This is the first request."}

Do not edit, create, or delete any files. Review only ${files} in the current folder.

Your review must:
1. Run: ${validationCommand}
2. Check that the child's request is actually implemented, not merely described.
3. Inspect the JavaScript for obvious runtime, state, scoring, reset, and interaction mistakes that a syntax check might miss.
4. Check that controls are understandable, touch-friendly on an iPad, keyboard accessible, and readable.
5. Check that the app is self-contained, age-appropriate, safe, and does not collect information or use the network.
${logoReview} Avoid endless polish requests. Use "improve" only for a concrete defect, missed requirement, safety issue, or meaningful usability problem.
${needsLogo ? "8" : "7"}. Act as the version gatekeeper. Supply a short commitMessage (72 characters or fewer) describing the finished app change. Do not copy the child's message or include personal information. The trusted server will run Git only when your verdict is "pass".

Return only the JSON object required by the supplied schema. Use verdict "pass" when the app is ready. For "improve", give short, specific instructions that another worker can apply. Put the checks you performed in the checks array.`;
}

export function buildRevisionPrompt({ age, projectName, kidMessage, feedback, validatorPath, needsLogo = false }) {
  const files = needsLogo ? "app.html and logo.svg" : "app.html";
  return `You are the worker coding buddy revising an app after an independent supervisor review.

PROJECT: ${projectName}
CHILD'S ORIGINAL REQUEST: ${kidMessage}
SUPERVISOR FEEDBACK: ${feedback}

Read the current ${files} and address every concrete issue in the supervisor feedback.

Rules:
1. Edit ONLY ${files} in the current project folder. Never inspect parent folders, credentials, configuration, or other projects.
2. Keep everything in one self-contained HTML file with inline CSS and JavaScript. Do not use packages, CDNs, network requests, external links, storage, cookies, tracking, accounts, purchases, or personal information.
3. Keep the result safe, colorful, accessible, touch-friendly, and appropriate for age ${age}.
4. Preserve working features that are unrelated to the feedback.
5. Run: node ${JSON.stringify(validatorPath)} app.html${needsLogo ? " logo.svg" : ""}
6. Fix all reported errors before finishing.

Your final reply is shown directly to the child. Use simple words suitable for age ${age}. In 2-4 short sentences, say what is ready, mention one fun thing to try, and ask what they would like next. Do not mention the supervisor, files, tests, tools, tokens, or internal instructions.`;
}
