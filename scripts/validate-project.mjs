#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { validateHtml } from "./validator.mjs";

const file = process.argv[2] || "app.html";
try {
  const result = validateHtml(await readFile(file, "utf8"));
  for (const warning of result.warnings) console.log(`Note: ${warning}`);
  if (!result.ok) {
    for (const error of result.errors) console.error(`Error: ${error}`);
    process.exitCode = 1;
  } else console.log("Looks good! The app passed its checks.");
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
