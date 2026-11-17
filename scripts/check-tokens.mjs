// Fails when the web app holds a raw colour literal (hex, rgb(), hsl() and the other colour functions) outside the
// theme binding files. Colours go through names: a theme role (apps/web/src/ui/theme/roles.ts, bound by
// ui/theme/brand.ts) or a shell token (apps/web/src/brand/shell.ts). Runs in `npm run check`.
//
// Allowed, and printed on every run so they stay countable:
//   - THEME_FILES: the files that BIND values. A literal there is the authority, not a violation.
//   - an inline `token-literal-ok: <reason>` comment on the same line (loud, per line, never per file);
//   - KNOWN: a ratchet of literals that predate this gate, each with its reason. A KNOWN entry that no longer matches
//     fails the gate, so the list only shrinks.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "apps/web/src";
const THEME_FILES = ["apps/web/src/ui/theme/brand.ts", "apps/web/src/ui/theme/derive.ts", "apps/web/src/brand/shell.ts"];
const KNOWN = [
  {
    file: "apps/web/src/ui/dom.ts",
    literal: "#0b5fff",
    reason: "HIGHLIGHT_FALLBACK, the outline inside the page iframe when no accent can be read. Owned by the shared UI; move it into ui/theme.",
  },
];
const SCANNED = /\.(ts|tsx|css|js|mjs|html)$/;
const TEST = /\.test\.(ts|tsx|js|mjs)$/;

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g;
const FUNC = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g;
const SUPPRESS = /token-literal-ok:\s*\S/;

/** Every colour literal on one line. */
export function literals(line) {
  return [...line.matchAll(HEX), ...line.matchAll(FUNC)].map((m) => m[0]);
}

// The gate proves it is armed before it trusts a clean run.
const MUST_CATCH = ["color: #fff;", "fill: '#FF62AD'", "x = \"#5a347080\"", "rgb(0 0 0)", "rgba(0,0,0,.2)", "hsl(1 2% 3%)", "oklch(70% .1 200)"];
const MUST_PASS = ["href=\"#/demo/form/wayfill\"", "document.getElementById(\"root\")", "url(#n)", "%23n", "color-mix(in srgb, var(--fg) 8%, transparent)", "accentColor()", "#root { }", "label(x)"];
for (const s of MUST_CATCH) if (!literals(s).length) { console.error(`check-tokens: self-test missed a literal in ${s}`); process.exit(1); }
for (const s of MUST_PASS) if (literals(s).length) { console.error(`check-tokens: self-test flagged ${s}`); process.exit(1); }

for (const f of THEME_FILES) if (!existsSync(f)) { console.error(`check-tokens: theme file ${f} is gone - update THEME_FILES`); process.exit(1); }

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = walk(ROOT).map((f) => relative(".", f).replaceAll("\\", "/")).filter((f) => SCANNED.test(f) && !TEST.test(f));
if (!files.some((f) => f.endsWith("brand/brand.css"))) { console.error("check-tokens: brand.css was not scanned - the gate cannot see its target"); process.exit(1); }

let bad = 0;
const suppressed = [];
const knownSeen = new Set();
for (const f of files) {
  if (THEME_FILES.includes(f)) continue;
  readFileSync(f, "utf8").split(/\r?\n/).forEach((line, i) => {
    for (const lit of literals(line)) {
      const known = KNOWN.findIndex((k) => k.file === f && k.literal === lit);
      if (known >= 0) { knownSeen.add(known); continue; }
      if (SUPPRESS.test(line)) { suppressed.push(`${f}:${i + 1} ${lit}`); continue; }
      console.error(`${f}:${i + 1}: raw colour ${lit} - use a theme role var(--fg|--accent|...) or a shell token var(--ink-*) from brand/shell.ts`);
      bad++;
    }
  });
}
KNOWN.forEach((k, i) => {
  if (!knownSeen.has(i)) { console.error(`check-tokens: KNOWN ${k.literal} is no longer in ${k.file} - delete the entry`); bad++; }
});

if (bad) { console.error(`check-tokens: ${bad} finding(s)`); process.exit(1); }
console.log(`check-tokens: clean (${files.length} files; ${THEME_FILES.length} theme files hold the literals; ` +
  `${KNOWN.length} known, ${suppressed.length} suppressed)`);
for (const k of KNOWN) console.log(`  known: ${k.file} ${k.literal} - ${k.reason}`);
for (const s of suppressed) console.log(`  suppressed: ${s}`);
