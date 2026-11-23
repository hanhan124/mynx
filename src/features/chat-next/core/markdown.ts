/**
 * Pre-render normalisation for model answers.
 *
 * Models write display math in shapes the Markdown math rules miss:
 * `\[ … \]` spread over several lines or indented inside a list, and
 * `$$ … $$` whose delimiters share a line with the formula. Both become a
 * standard `$$` block on its own lines.
 *
 * Some models (DeepSeek among them) also put bare LaTeX inside code: an
 * inline span like `2^{-\Delta\Delta Ct}` or a fence holding one formula.
 * When the code is clearly a formula (LaTeX math commands or ^{ / _{, and
 * nothing that looks like program code, a shell command, a path or a full
 * LaTeX document) it renders as math. Real code stays code; an unclosed
 * fence (still streaming) is left exactly as written.
 *
 * Runs on every streamed token, so finished paragraphs are cached: only the
 * paragraph still being written is re-processed.
 */

/** Opening fence, optionally after list markers (`- ```math`, `1. ````). */
const FENCE_OPEN = /^((?:[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)*[ \t]*)(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;

/** Fence languages that may hold a formula; anything else is always code. */
const MATH_FENCE_LANGS = new Set(["", "math", "katex", "latex", "tex"]);

const MATH_COMMAND =
  /\\(?:frac|dfrac|tfrac|sqrt|text|mathrm|mathbf|mathit|mathcal|mathbb|mathsf|mathtt|mathfrak|boldsymbol|color|textcolor|boxed|underbrace|overbrace|operatorname|ldots|cdots|dots|forall|exists|subset|subseteq|cup|cap|equiv|ne|prime|ell|hbar|eta|zeta|xi|kappa|nu|Lambda|Phi|Psi|Theta|Pi|Xi|left|right|cdot|times|div|pm|mp|approx|neq|leq|geq|le|ge|sim|propto|infty|partial|nabla|sum|prod|int|lim|log|ln|exp|sin|cos|tan|hat|bar|overline|vec|binom|Delta|delta|alpha|beta|gamma|Gamma|epsilon|varepsilon|theta|lambda|mu|sigma|Sigma|pi|rho|tau|phi|varphi|chi|psi|omega|Omega|quad|qquad|mid|in|to|rightarrow|leftarrow|Rightarrow)(?![A-Za-z])/;
const SCRIPT_GROUP = /[\^_]\{/;
const NOT_A_FORMULA = [
  /[A-Za-z]:\\/, // drive path  C:\Users
  /\\\\[A-Za-z]/, // UNC path / escaped backslash
  /(?:^|[^\\A-Za-z])[A-Za-z][A-Za-z0-9]{2,}\\[A-Za-z]/, // relative path  src\alpha, fooBar\alpha
  /^[ \t]*[a-z]{2,}[\w-]*[ \t]+(?:[\\-]|\S+[ \t]+\\)/m, // shell command  echo \alpha, ls -la (not x_1 \cdot y)
  /\\(?:documentclass|usepackage|begin\{document\}|newcommand|def\b|input\b|include\b)/,
  /["`]|\/\/|;[ \t]*$|=>|<-|#include|^[ \t]*%|\bfunction\b|\breturn\b|\bimport\b/m,
];

/** Short script-only formulas without commands: `a_{i}`, `x^{2} + 1`. */
const SCRIPT_ONLY = /^[\p{L}0-9 _^{}+\-=()*/.,|']{1,40}$/u;
/** `ls foo_{i}`, `cp x_{i} y`: a command word followed by an argument. */
const COMMAND_PREFIX = /^[a-z]{2,}[ \t]+\S/;

/** Whether a code body is really one formula written without math delimiters. */
export function looksLikeFormula(code: string): boolean {
  const body = code.trim();
  if (!body || body.includes("$") || body.length > 600 || body.split("\n").length > 8) return false;
  // Words inside \text{…} are prose, not program keywords.
  const outsideText = body.replace(/\\(?:text|mathrm|textrm|operatorname)\{[^{}]*\}/g, "\\text{}");
  if (NOT_A_FORMULA.some((pattern) => pattern.test(outsideText))) return false;
  // Root-relative path `\server\share`: a leading word that is no LaTeX command.
  const lead = /^\\([A-Za-z]+)\\/.exec(body);
  if (lead && !MATH_COMMAND.test(`\\${lead[1]}`)) return false;
  if (MATH_COMMAND.test(body) || (SCRIPT_GROUP.test(body) && /\\[A-Za-z]/.test(body))) return true;
  // No command at all: only a tiny sub/superscript expression with no words.
  return SCRIPT_ONLY.test(body) && SCRIPT_GROUP.test(body) && !COMMAND_PREFIX.test(body) && !/\p{L}{4,}/u.test(body);
}

/** Cheap pre-check: backslashes, `$$`, or a code span with `_{` / `^{`. */
function mayNeedRewrite(text: string): boolean {
  return text.includes("\\") || text.includes("$$") || /`[^`\n]*[_^]\{/.test(text);
}

interface OpenFence {
  char: string;
  length: number;
  lang: string;
  prefix: string;
  open: string;
  body: string[];
}

/** Rewrite display math and formula-only code; inline `\( \)` / `$ $` already render. */
export function normalizeMath(markdown: string): string {
  if (!mayNeedRewrite(markdown)) return markdown;
  const lines = markdown.split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let fence: OpenFence | null = null;

  const flush = () => {
    if (paragraph.length > 0) out.push(cachedProse(paragraph.join("\n")));
    paragraph = [];
  };

  for (const line of lines) {
    if (fence) {
      const close = FENCE_CLOSE.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) {
        out.push(...closeFence(fence, line));
        fence = null;
      } else {
        fence.body.push(line);
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    // A backtick fence's info string cannot contain backticks.
    if (open && !(open[2][0] === "`" && open[3].includes("`"))) {
      flush();
      fence = {
        char: open[2][0],
        length: open[2].length,
        lang: (open[3].trim().split(/\s+/)[0] ?? "").toLowerCase(),
        prefix: open[1],
        open: line,
        body: [],
      };
      continue;
    }
    paragraph.push(line);
    // A blank line ends a paragraph once its math delimiters are balanced.
    if (line.trim() === "" && balanced(paragraph)) flush();
  }
  flush();
  // Still streaming inside a fence: show it exactly as written so far.
  if (fence) out.push(fence.open, ...fence.body);
  return out.join("\n");
}

function closeFence(fence: OpenFence, closeLine: string): string[] {
  const body = fence.body.join("\n");
  if (!MATH_FENCE_LANGS.has(fence.lang) || !looksLikeFormula(body)) return [fence.open, ...fence.body, closeLine];
  // Keep a fence that opened inside a list item inside that item.
  const indent = " ".repeat(fence.prefix.length);
  // Keep inner blank lines; drop only leading/trailing ones.
  const formula = fence.body.map((line) => line.trim());
  while (formula.length > 0 && !formula[0]) formula.shift();
  while (formula.length > 0 && !formula[formula.length - 1]) formula.pop();
  return [`${fence.prefix}$$`, ...formula.map((line) => (line ? indent + line : "")), `${indent}$$`];
}

/**
 * Whether the paragraph so far closes every display-math block, reading the
 * delimiters in order (a stray `\]` before a `\[` does not count) and
 * ignoring code, so a block with a blank line inside is never split.
 */
function balanced(lines: string[]): boolean {
  const text = replaceCodeSpans(lines.filter((line) => !/^(?: {4}|\t)/.test(line)).join("\n"), () => "");
  let open = 0;
  let dollars = false;
  for (const match of text.matchAll(/\\\[|\\\]|\$\$/g)) {
    if (match[0] === "$$") dollars = !dollars;
    else if (dollars) continue;
    else if (match[0] === "\\[") open += 1;
    else if (open > 0) open -= 1;
  }
  return open === 0 && !dollars;
}

/**
 * Linear scan for inline code spans (a run of N backticks closed by a run of
 * exactly N on the same line). `replace` gets the whole span and the run
 * length. Text without a matching closer is left as it is.
 */
function replaceCodeSpans(text: string, replace: (span: string, ticks: number, code: string) => string): string {
  if (!text.includes("`")) return text;
  return text
    .split("\n")
    .map((line) => {
      if (!line.includes("`")) return line;
      const runs: Array<{ at: number; length: number }> = [];
      for (let i = 0; i < line.length; ) {
        if (line[i] !== "`") {
          i += 1;
          continue;
        }
        const start = i;
        while (i < line.length && line[i] === "`") i += 1;
        runs.push({ at: start, length: i - start });
      }
      // Runs grouped by length: each opener pairs with the next run of its size.
      const byLength = new Map<number, number[]>();
      runs.forEach((run, index) => {
        const list = byLength.get(run.length) ?? [];
        list.push(index);
        byLength.set(run.length, list);
      });
      const cursor = new Map<number, number>();
      let out = "";
      let last = 0;
      for (let index = 0; index < runs.length; index += 1) {
        const run = runs[index];
        if (run.at < last) continue;
        const list = byLength.get(run.length) ?? [];
        let k = cursor.get(run.length) ?? 0;
        while (k < list.length && list[k] <= index) k += 1;
        cursor.set(run.length, k);
        if (k >= list.length) continue;
        const close = runs[list[k]];
        cursor.set(run.length, k + 1);
        const end = close.at + close.length;
        out += line.slice(last, run.at) + replace(line.slice(run.at, end), run.length, line.slice(run.at + run.length, close.at));
        last = end;
        // Skip every run that the span swallowed.
        while (index + 1 < runs.length && runs[index + 1].at < end) index += 1;
      }
      return out + line.slice(last);
    })
    .join("\n");
}

/* Finished paragraphs come back unchanged on every streamed token. */
const PROSE_CACHE_LIMIT = 400;
const proseCache = new Map<string, string>();

function cachedProse(text: string): string {
  const hit = proseCache.get(text);
  if (hit !== undefined) return hit;
  const result = normalizeProse(text);
  if (proseCache.size >= PROSE_CACHE_LIMIT) {
    const oldest = proseCache.keys().next().value;
    if (oldest !== undefined) proseCache.delete(oldest);
  }
  proseCache.set(text, result);
  return result;
}

/** Private-use placeholder (never typed, not a control character). */
const SLOT = "\uE000";
const SLOT_PATTERN = new RegExp(`${SLOT}(\\d+)${SLOT}`, "g");

function normalizeProse(text: string): string {
  if (!mayNeedRewrite(text)) return text;
  // Protect code from the rewrites below: inline spans of any backtick run
  // length (`a`, ``a ` b``) and indented code blocks (4+ spaces / a tab,
  // outside lists that are recognised by the ≤3-space rule further down).
  const spans: string[] = [];
  const protect = (span: string) => {
    spans.push(span);
    return `${SLOT}${spans.length - 1}${SLOT}`;
  };
  // Single-backtick spans that hold a formula become inline math; every other
  // code span is protected as it is.
  const guarded = replaceCodeSpans(text, (span, ticks, code) =>
    ticks === 1 && looksLikeFormula(code) ? `$${repairLatex(code.trim())}$` : protect(span),
  ).replace(/(^|\n)((?: {4}|\t)[^\n]*)/g, (_m, lead: string, line: string) => lead + protect(line));
  const block = (indent: string, body: string) => {
    const formula = repairLatex(body.trim());
    return formula ? `\n${indent}$$\n${indent}${formula.replace(/\n\s*/g, `\n${indent}`)}\n${indent}$$\n` : "";
  };
  const rewritten = guarded
    // \[ … \] (possibly multi-line) → $$ block
    .replace(/(^|\n)( {0,3})\\\[([\s\S]+?)\\\]/g, (_m, lead: string, indent: string, body: string) =>
      lead + block(indent, body).replace(/^\n/, ""),
    )
    // $$ … $$ spanning lines but not on their own lines → $$ block
    .replace(/(^|\n)( {0,3})\$\$([^\n$][\s\S]*?)\$\$[ \t]*(?=\n|$)/g, (match, lead: string, indent: string, body: string) =>
      body.includes("\n") || body.trim() !== body ? lead + block(indent, body).replace(/^\n/, "").replace(/\n$/, "") : match,
    );
  const withBareFormulas = normalizeBareFormulaLines(rewritten);
  return withBareFormulas.replace(SLOT_PATTERN, (_m, index: string) => spans[Number(index)] ?? "");
}

/**
 * Some models omit math delimiters entirely and put one LaTeX expression on
 * each line. Convert only formula-shaped lines; prose, paths and code remain
 * untouched. Existing display blocks are skipped so their inner lines are
 * not wrapped a second time.
 */
function normalizeBareFormulaLines(text: string): string {
  let inDisplayMath = false;
  return text
    .split("\n")
    .flatMap((line) => {
      const trimmed = line.trim();
      if (/^\$\$[ \t]*$/.test(trimmed)) {
        inDisplayMath = !inDisplayMath;
        return [line];
      }
      if (inDisplayMath || trimmed.includes("$") || trimmed.includes("\\[") || trimmed.includes("\\]")) {
        return [line];
      }
      const match = /^([ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?)(\S(?:.*?\S)?)[ \t]*$/.exec(line);
      if (!match || !looksLikeBareFormula(match[2])) return [line];
      const prefix = match[1];
      const continuation = prefix.replace(/[^ \t]/g, " ");
      return [`${prefix}$$`, `${continuation}${repairLatex(match[2])}`, `${continuation}$$`];
    })
    .join("\n");
}

/** Fix a common model typo: an outer `\left\` before another `\left`. */
function repairLatex(formula: string): string {
  return formula
    // Some OpenAI-compatible endpoints return escaped LaTeX commands with
    // two backslashes. Collapse the duplicate before command names.
    .replace(/\\\\(?=[A-Za-z])/g, "\\")
    .replace(/\\left\\(?=\s*\\left\b)/g, "")
    .replace(/\\right\\(?=\s*\\right\b)/g, "")
    // Plain delimiters are valid math too and remain renderable when a model
    // omits a matching `\right` or writes an invalid delimiter after `\left`.
    .replace(/\\(?:left|right|middle)\b/g, "");
}

function looksLikeBareFormula(body: string): boolean {
  if (!looksLikeFormula(body)) return false;
  const outsideText = body
    .replace(/\\(?:text|mathrm|textrm|operatorname)\{[^{}]*\}/g, "")
    .replace(/\\[A-Za-z]+/g, "")
    .replace(/[{}\d\s\\^_+=\-*/.,()[\]|]/g, " ");
  // A command followed by a normal prose word is much more likely to be a
  // sentence such as "\\Delta streaming" than an un-delimited formula.
  const words = outsideText.match(/\p{L}+/gu) ?? [];
  if (words.some((word) => word.length >= 4)) return false;
  return /^\\[A-Za-z]+/.test(body) || /(?:=|[\^_]\{|\\(?:frac|dfrac|tfrac|sqrt|binom))/.test(body);
}
