#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { validateHtml, validateLogoSvg } from "./validator.mjs";

const file = process.argv[2] || "app.html";
try {
  const results = [validateHtml(await readFile(file, "utf8"))];
  if (process.argv[3]) results.push(validateLogoSvg(await readFile(process.argv[3], "utf8")));
  const result = {
    ok: results.every((item) => item.ok),
    errors: results.flatMap((item) => item.errors),
    warnings: results.flatMap((item) => item.warnings)
  };
  for (const warning of result.warnings) console.log(`Note: ${warning}`);
  if (!result.ok) {
    for (const error of result.errors) console.error(`Error: ${error}`);
    process.exitCode = 1;
  } else console.log("Looks good! The app passed its checks.");
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
