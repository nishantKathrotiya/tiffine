/**
 * WCAG AA contrast verification for the design tokens.
 *
 * Token colors are parsed out of globals.css and every foreground/background
 * pair the UI actually renders is measured. Contrast is judged by measurement,
 * not by eye: the original saffron looked fine and was 3.19:1.
 *
 * Run: npx tsx scripts/verify-contrast.mts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const clean = hex.replace("#", "").trim();
  return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16)) as RGB;
}

function relativeLuminance(rgb: RGB): number {
  const [r, g, b] = rgb.map((channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [
    relativeLuminance(hexToRgb(foreground)),
    relativeLuminance(hexToRgb(background)),
  ].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Extract `--name: #hex;` declarations from a CSS block. */
function parseTokens(css: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const [, name, value] of css.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[name] = value;
  }
  return tokens;
}

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

// The light palette is the first :root block; the dark override is the
// [data-theme="dark"] block.
const lightBlock = css.slice(css.indexOf(":root {"), css.indexOf("@media"));
const darkStart = css.indexOf(':root[data-theme="dark"]');
const darkBlock = css.slice(darkStart, css.indexOf("@theme inline"));

const light = parseTokens(lightBlock);
const dark = parseTokens(darkBlock);

type Pair = { label: string; fg: string; bg: string; min: number };

/** Every pair the interface actually renders. */
const PAIRS: Pair[] = [
  { label: "body text on page bg", fg: "text", bg: "bg", min: 4.5 },
  { label: "body text on surface", fg: "text", bg: "surface", min: 4.5 },
  { label: "muted text on surface", fg: "text-muted", bg: "surface", min: 4.5 },
  { label: "muted text on page bg", fg: "text-muted", bg: "bg", min: 4.5 },
  // Non-text/decorative (icons, placeholders) — AA large/UI threshold.
  { label: "subtle text on surface", fg: "text-subtle", bg: "surface", min: 3 },
  { label: "primary button label", fg: "text-on-primary", bg: "primary", min: 4.5 },
  { label: "primary button hover", fg: "text-on-primary", bg: "primary-hover", min: 4.5 },
  { label: "primary text on surface", fg: "primary", bg: "surface", min: 4.5 },
  { label: "primary pill", fg: "primary", bg: "primary-subtle", min: 4.5 },
  { label: "success pill", fg: "success", bg: "success-subtle", min: 4.5 },
  { label: "warning pill", fg: "warning", bg: "warning-subtle", min: 4.5 },
  { label: "danger pill", fg: "danger", bg: "danger-subtle", min: 4.5 },
  { label: "info pill", fg: "info", bg: "info-subtle", min: 4.5 },
  { label: "danger button label", fg: "surface", bg: "danger", min: 4.5 },
];

let failures = 0;

function checkTheme(name: string, tokens: Record<string, string>) {
  console.log(`\n=== ${name} ===`);
  for (const { label, fg, bg, min } of PAIRS) {
    const fgHex = tokens[fg];
    const bgHex = tokens[bg];

    if (!fgHex || !bgHex) {
      console.log(`  SKIP  ${label.padEnd(26)} (missing --${!fgHex ? fg : bg})`);
      continue;
    }

    const ratio = contrastRatio(fgHex, bgHex);
    const pass = ratio >= min;
    if (!pass) failures++;
    console.log(
      `  ${pass ? "PASS" : "FAIL"}  ${label.padEnd(26)} ${ratio.toFixed(2)}:1` +
        ` (need ${min})  ${fgHex} on ${bgHex}`,
    );
  }
}

checkTheme("LIGHT", light);
// Dark inherits any token it does not override.
checkTheme("DARK", { ...light, ...dark });

console.log(`\n${"=".repeat(60)}`);
console.log(failures === 0 ? "  All contrast pairs meet WCAG AA." : `  ${failures} pair(s) below AA.`);
console.log(`${"=".repeat(60)}\n`);

process.exit(failures > 0 ? 1 : 0);
