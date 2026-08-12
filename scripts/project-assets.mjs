function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function starterLogoSvg(projectName) {
  const name = String(projectName || "My project").trim() || "My project";
  const first = [...name][0]?.toUpperCase() || "★";
  const mark = /^[A-Z0-9]$/.test(first) ? first : "★";
  const palettes = [
    ["#6757e8", "#9d8cff", "#fff4a8"],
    ["#188a78", "#54c9ae", "#fff0a6"],
    ["#d15b46", "#ff9478", "#dff8ff"],
    ["#376fc4", "#76a8f2", "#ffe59a"]
  ];
  const paletteIndex = [...name].reduce((sum, character) => sum + character.codePointAt(0), 0) % palettes.length;
  const [dark, light, accent] = palettes[paletteIndex];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-labelledby="title">
  <title id="title">${xmlEscape(name)} project</title>
  <rect width="128" height="128" rx="28" fill="${dark}"/>
  <path d="M18 84 42 46l22 20 22-31 24 49v24H18Z" fill="${light}"/>
  <circle cx="94" cy="31" r="13" fill="${accent}"/>
  <rect x="35" y="68" width="58" height="42" rx="14" fill="#fff" opacity=".96"/>
  <text x="64" y="98" text-anchor="middle" font-family="system-ui,sans-serif" font-size="34" font-weight="800" fill="${dark}">${xmlEscape(mark)}</text>
</svg>\n`;
}
