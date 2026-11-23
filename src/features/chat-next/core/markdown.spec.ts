import { describe, expect, it } from "vitest";
import { normalizeMath } from "./markdown.js";

describe("normalizeMath", () => {
  it("turns multi-line \\[ … \\] into a $$ block", () => {
    expect(normalizeMath("前文\n\\[\nE = mc^2\n\\]\n后文")).toBe("前文\n$$\nE = mc^2\n$$\n\n后文");
  });

  it("turns single-line \\[ … \\] into a $$ block", () => {
    expect(normalizeMath("\\[ \\Delta C_t = C_t - C_{ref} \\]")).toBe("$$\n\\Delta C_t = C_t - C_{ref}\n$$\n");
  });

  it("repairs malformed nested left delimiters in a display formula", () => {
    const source = String.raw`$$ \text{相对表达量}

2^{-\left\ \left(Ct_{\text{目的,样本}}-Ct_{\text{内参,样本}}\right)
\left(Ct_{\text{目的,对照}}-Ct_{\text{内参,对照}}\right)} $$`;
    expect(normalizeMath(source)).toBe(String.raw`$$
\text{相对表达量}
2^{- (Ct_{\text{目的,样本}}-Ct_{\text{内参,样本}})
(Ct_{\text{目的,对照}}-Ct_{\text{内参,对照}})}
$$`);
  });

  it("keeps list indentation", () => {
    expect(normalizeMath("1. 计算：\n   \\[ 2^{-\\Delta\\Delta C_t} \\]")).toBe(
      "1. 计算：\n   $$\n   2^{-\\Delta\\Delta C_t}\n   $$\n",
    );
  });

  it("splits $$ delimiters that share lines with a multi-line formula", () => {
    expect(normalizeMath("$$ a = b\n+ c $$")).toBe("$$\na = b\n+ c\n$$");
  });

  it("leaves well-formed blocks, inline math and code alone", () => {
    const text = "$$\nx\n$$\n行内 $x^2$ 与 \\(y\\)\n`\\[not math\\]`\n```\n\\[ code \\]\n$$ code $$\n```";
    expect(normalizeMath(text)).toBe(text);
  });

  it("leaves multi-backtick spans, indented code and currency alone", () => {
    const text = "用 ``\\[x\\]`` 表示\n\n    \\[ indented code \\]\n    $$ a\n    b $$\n\n价格 $5 和 $10";
    expect(normalizeMath(text)).toBe(text);
  });

  it("renders LaTeX that a model put inside code as math", () => {
    expect(normalizeMath("`2^{-\\Delta\\Delta Ct}` 这个简化公式")).toBe("$2^{-\\Delta\\Delta Ct}$ 这个简化公式");
    expect(normalizeMath("```\n\\Delta\\Delta Ct = \\Delta Ct_{\\text{对照}} - \\Delta Ct_{\\text{样本}}\n```")).toBe(
      "$$\n\\Delta\\Delta Ct = \\Delta Ct_{\\text{对照}} - \\Delta Ct_{\\text{样本}}\n$$",
    );
    expect(normalizeMath("```latex\n\\text{相对表达量} = 2^{\\Delta\\Delta Ct}\n```")).toBe(
      "$$\n\\text{相对表达量} = 2^{\\Delta\\Delta Ct}\n$$",
    );
  });

  it("keeps real code, paths and LaTeX documents as code", () => {
    const samples = [
      "`C:\\Users\\me\\data.csv`",
      "`printf(\"\\n\")`",
      "```python\nx = r\"\\alpha\"\n```",
      "```latex\n\\documentclass{article}\n\\begin{document}\n$x$\n\\end{document}\n```",
      "```\nconst f = (a) => a;\n```",
      "```\n\\Delta streaming",
    ];
    for (const sample of samples) expect(normalizeMath(sample)).toBe(sample);
  });

  it("handles 4-backtick fences, list-item fences and shell/R/regex code", () => {
    const keep = [
      "````\n```\n\\alpha\n````",
      "`src\\alpha`",
      "`echo \\alpha`",
      "`x <- \\alpha`",
      "`\\d+`",
      "```r\nx <- 2^{\\Delta}\n```",
    ];
    for (const sample of keep) expect(normalizeMath(sample)).toBe(sample);
    expect(normalizeMath("- 公式：\n  ```math\n  2^{-\\Delta\\Delta Ct}\n  ```")).toBe(
      "- 公式：\n  $$\n  2^{-\\Delta\\Delta Ct}\n  $$",
    );
    expect(normalizeMath("- ```\n  \\frac{a}{b}\n  ```")).toBe("- $$\n  \\frac{a}{b}\n  $$");
    expect(normalizeMath("`x_1 \\cdot y`")).toBe("$x_1 \\cdot y$");
  });

  it("gives the same result when a paragraph is cached", () => {
    const text = "第一段 `\\Delta Ct`\n\n第二段 \\[ x^2 \\]";
    expect(normalizeMath(text)).toBe(normalizeMath(text));
    expect(normalizeMath(`${text}\n\n追加`)).toBe(`${normalizeMath(text)}\n\n追加`);
  });

  it("stays fast on long backtick runs", () => {
    const text = `${"`".repeat(200)}\\alpha ${"`".repeat(199)} \\[x\\]`;
    const started = Date.now();
    normalizeMath(text);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it("never splits a display block at a blank line after a stray \\]", () => {
    expect(normalizeMath("\\]\n\\[\na\n\nb\n\\]")).toBe("\\]\n$$\na\nb\n$$\n");
  });

  it("keeps mixed-case and root-relative paths as code", () => {
    for (const sample of ["`fooBar\\alpha`", "`\\server\\alpha`"]) expect(normalizeMath(sample)).toBe(sample);
  });

  it("recognises more commands and tiny script-only formulas", () => {
    expect(normalizeMath("`\\mathcal{F}`")).toBe("$\\mathcal{F}$");
    expect(normalizeMath("`a_{i}`")).toBe("$a_{i}$");
    expect(normalizeMath("`array_{index}`")).toBe("`array_{index}`");
  });

  it("handles shell arguments, \\text words, \\color and Unicode scripts", () => {
    for (const sample of ["`ls foo_{i}`", "`cp x_{i} y`", "`mv a_{i} b`"]) expect(normalizeMath(sample)).toBe(sample);
    expect(normalizeMath("`\\text{function } f(x)`")).toBe("$\\text{function } f(x)$");
    expect(normalizeMath("`\\color{red}{x}`")).toBe("$\\color{red}{x}$");
    expect(normalizeMath("`β_{i}`")).toBe("$β_{i}$");
  });

  it("keeps blank lines inside a formula fence", () => {
    expect(normalizeMath("```math\n\\alpha\n\n\\beta\n```")).toBe("$$\n\\alpha\n\n\\beta\n$$");
  });

  it("returns plain text unchanged", () => {
    expect(normalizeMath("no math here")).toBe("no math here");
  });
});
