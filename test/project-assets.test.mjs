import assert from "node:assert/strict";
import test from "node:test";
import { starterLogoSvg } from "../scripts/project-assets.mjs";
import { validateLogoSvg } from "../scripts/validator.mjs";

test("starter project logos are valid, self-contained SVG images", () => {
  const logo = starterLogoSvg('Stars & <Planets> "Game"');
  assert.equal(validateLogoSvg(logo).ok, true);
  assert.match(logo, /viewBox="0 0 128 128"/);
  assert.match(logo, /Stars &amp; &lt;Planets&gt; &quot;Game&quot;/);
  assert.doesNotMatch(logo, /<script|href=|url\(/i);
});

test("starter project logos are deterministic and vary by project", () => {
  assert.equal(starterLogoSvg("Counting"), starterLogoSvg("Counting"));
  assert.notEqual(starterLogoSvg("Counting"), starterLogoSvg("Space"));
});
