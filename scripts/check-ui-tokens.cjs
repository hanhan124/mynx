#!/usr/bin/env node
/**
 * UI token ratchet (runs as part of `npm run lint`).
 *
 * Pages must use semantic tokens instead of hard-coded presentation values.
 * Existing debt is recorded per file in scripts/ui-token-baseline.json; the
 * check fails when any file gains a new violation, and reports files that
 * improved so the baseline can be lowered with `npm run ui:tokens:update`.
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "src");
const baselinePath = path.join(__dirname, "ui-token-baseline.json");

const RULES = {
  "font-size-px": {
    pattern: /\btext-\[\d+(?:\.\d+)?px\]/g,
    hint: "use text-body / text-callout / text-footnote / text-caption2 / text-subheadline / text-headline / text-title3",
  },
  "hex-color-in-markup": {
    pattern: /#[0-9a-fA-F]{3,8}\b/g,
    hint: "use a --color-* token (bg-surface, text-accent, ...)",
  },
  "raw-black-white": {
    pattern: /\b(?:bg|text|border)-(?:white|black)\b/g,
    hint: "use bg-surface / text-on-accent / a semantic token",
  },
  "tailwind-palette-color": {
    pattern:
      /\b(?:bg|text|border|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g,
    hint: "use semantic tokens (success / warning / danger / accent)",
  },
  "inline-switch": {
    pattern: /role="switch"/g,
    hint: "use components/Switch.svelte (or SwitchTrack for whole-row switches)",
    exempt: ["src/components/Switch.svelte", "src/components/SwitchCard.svelte"],
  },
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".svelte")) out.push(full);
  }
  return out;
}

function markupOf(source) {
  return source
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "");
}

function scan() {
  const result = {};
  for (const file of walk(srcDir).sort()) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const markup = markupOf(fs.readFileSync(file, "utf8"));
    const counts = {};
    for (const [name, rule] of Object.entries(RULES)) {
      if (rule.exempt?.includes(rel)) continue;
      const n = (markup.match(rule.pattern) ?? []).length;
      if (n > 0) counts[name] = n;
    }
    if (Object.keys(counts).length > 0) result[rel] = counts;
  }
  return result;
}

const current = scan();

if (process.argv.includes("--update")) {
  fs.writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`UI token baseline updated (${Object.keys(current).length} files).`);
  process.exit(0);
}

const baseline = fs.existsSync(baselinePath)
  ? JSON.parse(fs.readFileSync(baselinePath, "utf8"))
  : {};

const failures = [];
const improved = [];
for (const [file, counts] of Object.entries(current)) {
  for (const [rule, n] of Object.entries(counts)) {
    const allowed = baseline[file]?.[rule] ?? 0;
    if (n > allowed) failures.push(`${file}: ${rule} ${n} > ${allowed} — ${RULES[rule].hint}`);
  }
}
for (const [file, counts] of Object.entries(baseline)) {
  for (const [rule, allowed] of Object.entries(counts)) {
    const n = current[file]?.[rule] ?? 0;
    if (n < allowed) improved.push(`${file}: ${rule} ${allowed} -> ${n}`);
  }
}

if (failures.length > 0) {
  console.error("UI token check failed (new hard-coded presentation values):");
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
const total = Object.values(current).reduce(
  (sum, counts) => sum + Object.values(counts).reduce((a, b) => a + b, 0),
  0,
);
console.log(`UI token check passed (${total} recorded exceptions).`);
if (improved.length > 0) {
  console.log("Improved — lower the baseline with `npm run ui:tokens:update`:");
  for (const line of improved) console.log(`  ${line}`);
}
