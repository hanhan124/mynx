/* Dev-only audit harness (v5): postcss AST-based dead-rule removal.
   Preserves original formatting of surviving rules via postcss raws. */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";

const SRC = "D:/vibe_coding/mynx/src";
const FILES = [
  "src/styles/rnaseq.css",
  "src/styles/pages.css",
  "src/styles/components.css",
  "src/styles/golden-gate.css",
  "src/styles/unified.css",
  "src/styles/layout.css",
];

const keep = new Set();
const prefixes = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(name)) {
      const text = readFileSync(p, "utf8");
      for (const m of text.matchAll(/[A-Za-z_][A-Za-z0-9_-]*/g)) {
        keep.add(m[0]);
        if (/[-_]$/.test(m[0])) prefixes.push(m[0]);
      }
    }
  }
}
walk(SRC);

function referenced(token) {
  if (keep.has(token)) return true;
  for (const p of prefixes) if (token.startsWith(p)) return true;
  return false;
}
function classTokens(str) {
  const stripped = str.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, " ").replace(/\[[^\]]*\]/g, " ");
  return [...stripped.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)].map(m => m[1]);
}
function isDeadSelector(sel) {
  const tokens = classTokens(sel);
  if (tokens.length === 0) return false;
  return tokens.every(t => !referenced(t));
}

let removedCount = 0;
function processNode(root, removedAnimRefs) {
  const animRefs = new Set();
  for (const node of [...root.nodes]) {
    if (node.type === "rule") {
      const selectors = node.selectors.map(s => s.trim());
      if (selectors.every(isDeadSelector)) {
        node.remove();
        removedCount++;
        continue;
      }
      for (const m of node.toString().matchAll(/animation(?:-name)?\s*:\s*([^;\s,]+)/g)) {
        animRefs.add(m[1]);
      }
    } else if (node.type === "atrule") {
      if (node.name === "media") {
        const inner = processNode(node, removedAnimRefs);
        inner.forEach(a => animRefs.add(a));
        if (node.nodes.length === 0) {
          node.remove();
          removedCount++;
        }
      } else if (node.name === "keyframes") {
        // decide after all rules are known — handled by caller in second pass
        continue;
      }
    }
  }
  return animRefs;
}

for (const f of FILES) {
  const abs = join("D:/vibe_coding/mynx", f);
  const before = readFileSync(abs, "utf8");
  const root = postcss.parse(before, { from: abs });
  removedCount = 0;
  processNode(root, new Set());
  // second pass: drop keyframes whose name is unreferenced (in this file or in src)
  let kfRemoved = 0;
  for (const node of [...root.nodes]) {
    if (node.type === "atrule" && node.name === "keyframes") {
      const name = node.params.split(",")[0].trim();
      const referencedInFile = before.match(new RegExp(`animation[^;]*:\\s*[^;]*\\b${name}\\b`));
      if (!keep.has(name) && !referencedInFile) {
        node.remove();
        kfRemoved++;
      }
    }
  }
  const after = root.toString();
  const removedLines = before.split("\n").length - after.split("\n").length;
  try {
    postcss.parse(after, { from: abs + ".check" });
  } catch (e) {
    console.log(`${f}: RESULT UNPARSEABLE — skipped (${e.message.slice(0, 60)})`);
    continue;
  }
  if (removedLines > 0) {
    writeFileSync(abs, after);
    console.log(`${f}: removed ${removedLines} lines (${removedCount} rules, ${kfRemoved} keyframes) — parse OK`);
  } else {
    console.log(`${f}: no change`);
  }
}
