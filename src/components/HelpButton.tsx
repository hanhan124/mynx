import { useState, useEffect, useRef } from "react";
import Modal from "./Modal";
import { IconQuestionMark, IconX, IconChevronRight } from "@tabler/icons-react";

interface Props {
  variant?: "inline" | "icon";
}

export default function HelpButton({
  variant = "icon",
  children,
}: Props & { children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={`help-btn help-btn--${variant}`}
        onClick={() => setOpen(true)}
        title="查看使用教程"
        aria-label="查看使用教程"
      >
        <IconQuestionMark size={variant === "inline" ? 14 : 13} stroke={2.4} />
        {variant === "inline" && <span>使用教程</span>}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} wide>
        {children(() => setOpen(false))}
      </Modal>
    </>
  );
}

/* ================================================================
 * qPCR 使用教程 — 纯用户视角
 * ================================================================ */

export function QpcrTutorial({ onClose }: { onClose: () => void }) {
  const sections = [
    { id: "intro", title: "📖 简介" },
    { id: "prep", title: "📋 准备 Excel" },
    { id: "file", title: "① 选文件" },
    { id: "transform", title: "② 转数据" },
    { id: "calc", title: "③ 算表达量" },
    { id: "chart", title: "④ 出图" },
    { id: "faq", title: "❓ 常见问题" },
  ];

  const [activeId, setActiveId] = useState("intro");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const onScroll = () => {
      const tops = sections
        .map((s) => {
          const el = root.querySelector(`#tut-${s.id}`) as HTMLElement | null;
          return el ? { id: s.id, top: el.getBoundingClientRect().top - root.getBoundingClientRect().top } : null;
        })
        .filter((x): x is { id: string; top: number } => x !== null);
      const current = tops.reduce(
        (acc, cur) => (cur.top <= 80 && cur.top > acc.top ? cur : acc),
        { id: "intro", top: -Infinity }
      );
      setActiveId(current.id);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollTo = (id: string) => {
    const root = scrollRef.current;
    const el = root?.querySelector(`#tut-${id}`) as HTMLElement | null;
    if (root && el) {
      root.scrollTo({ top: el.offsetTop - root.offsetTop, behavior: "smooth" });
    }
  };

  return (
    <div className="tutorial">
      <div className="tutorial__header">
        <div>
          <div className="tutorial__title">qPCR 分析使用教程</div>
          <div className="tutorial__subtitle">从原始 Ct 到图表 · 4 步走完</div>
        </div>
        <button className="tutorial__close" onClick={onClose} aria-label="关闭教程">
          <IconX size={16} stroke={2} />
        </button>
      </div>

      <div className="tutorial__body">
        <aside className="tutorial__nav">
          <div className="tutorial__nav-title">目录</div>
          <ul>
            {sections.map((s) => (
              <li key={s.id}>
                <button
                  className={`tutorial__nav-item ${activeId === s.id ? "active" : ""}`}
                  onClick={() => scrollTo(s.id)}
                >
                  <IconChevronRight size={12} stroke={2.4} />
                  <span>{s.title}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="tutorial__nav-tip">💡 点目录可快速跳转</div>
        </aside>

        <div className="tutorial__content" ref={scrollRef}>
          {/* ── 简介 ── */}
          <Section id="intro" title="📖 简介" subtitle="这工具能干什么">
            <p>
              Mynx qPCR 分析模块帮你在本地完成 <strong>qPCR 相对定量</strong> 的全部计算和出图，
              不需要手写 Excel 公式，也不依赖任何在线服务。
            </p>
            <p>典型流程（2–5 分钟）：</p>
            <ol>
              <li><strong>选文件</strong> — 仪器导出的 Excel（.xlsx）</li>
              <li><strong>转数据</strong> — 宽表转成长表，统一格式</li>
              <li><strong>算表达量</strong> — 选内参基因，自动算 RE + 均值 + 标准差</li>
              <li><strong>出图</strong> — 每个基因自动生成柱状图（带误差棒）</li>
            </ol>
            <Callout type="info">
              适合处理 96 / 384 孔板数据，需要把多个目标基因归一化到同一个内参基因的场景。
            </Callout>
          </Section>

          {/* ── 准备 Excel ── */}
          <Section id="prep" title="📋 准备 Excel" subtitle="你的文件长这样就 OK">
            <p>只需要 <strong>3 列</strong>核心数据，其余列会被自动忽略：</p>

            <div className="tutorial__table-wrap">
              <table className="tutorial__table">
                <thead>
                  <tr><th>列名</th><th>含义</th><th>必需</th></tr>
                </thead>
                <tbody>
                  <tr><td><code>Target</code> / <code>Gene</code> / <code>基因</code></td><td>基因名（如 GAPDH）</td><td>✓</td></tr>
                  <tr><td><code>Sample</code> / <code>Group</code> / <code>样本</code> / <code>分组</code></td><td>样本或分组名</td><td>✓</td></tr>
                  <tr><td><code>Cq</code> / <code>Ct</code></td><td>Ct 数值</td><td>✓</td></tr>
                  <tr><td><code>Well</code> / <code>Fluor</code> / <code>Content</code> 等</td><td>无关列</td><td>忽略</td></tr>
                </tbody>
              </table>
            </div>

            <p style={{ marginTop: 14 }}><strong>Excel 示例（每行一个孔）：</strong></p>
            <pre className="tutorial__code">{`Well  Fluor  Target   Sample       Cq
----- ------ -------- ------------ ----
A01   SYBR   GAPDH    Sample_A     18.06
A02   SYBR   GAPDH    Sample_A     18.15
A03   SYBR   TNF      Sample_A     25.13
B01   SYBR   GAPDH    Sample_B     18.82
B02   SYBR   TNF      Sample_B     24.87`}</pre>

            <Callout type="warn">
              ⚠️ 只支持 <code>.xlsx</code> 格式。<code>.xls</code> 旧版请先在 Excel 中另存为新格式。
            </Callout>
          </Section>

          {/* ── ① 选文件 ── */}
          <Section id="file" title="① 选文件" subtitle="在第一张卡片里选 Excel">
            <p>两种方式：</p>
            <ul>
              <li>点 <code>打开</code> 按钮，弹出文件选择框</li>
              <li>把 Excel 文件直接拖到卡片虚线框里</li>
            </ul>
            <p>
              选好后卡片会显示 <strong>文件名 + 完整路径</strong>。
              如果文件有多个 sheet，下拉框里选含 Ct 数据的那张。
            </p>
            <Callout type="tip">
              如果文件之前已经转换过，打开后会自动识别基因名，可直接跳到第 ③ 步计算。
            </Callout>
          </Section>

          {/* ── ② 转数据 ── */}
          <Section id="transform" title="② 转数据" subtitle="点「执行转换」">
            <p>
              这一步把原始宽表（每孔一行）转成 <code>Transformed Data</code> sheet：
              每行一个样本的一个重复，列为 <code>Num / Group / 基因名…</code>。
            </p>
            <p>转换过程中：</p>
            <ul>
              <li>每个技术重复保留为独立行（不合并）</li>
              <li>
                缺失的 Ct 值会自动用同一样本该基因的<strong>其他有效重复</strong>填补，并标黄底；
                如果完全没有有效值，填入 <code>50</code> 占位并标黄
              </li>
              <li>几秒内完成，自动保存到原文件</li>
            </ul>
            <p>
              如果文件<strong>已经转换过</strong>，卡片会显示绿色提示「已转换（N 个基因），可直接计算」，
              无需重复执行。
            </p>
            <Callout type="warn">
              ⚠️ 转换后只保留 <code>Num / Group / 基因名</code> 列，原始的 Well / Fluor / Content 等列会被丢弃。
            </Callout>
          </Section>

          {/* ── ③ 算表达量 ── */}
          <Section id="calc" title="③ 算表达量" subtitle="选好参数，点「执行计算」">
            <p>需要设置 3 项：</p>
            <ul>
              <li><strong>重复次数</strong>：选 1–10，跟实际技术重复数一致</li>
              <li><strong>参考基因</strong>：选 1 个（常用 GAPDH / ACTB），默认选第一个基因</li>
              <li><strong>柱状图颜色</strong>：默认蓝色，可自定义，选择会自动记住</li>
            </ul>

            <p>相对表达量计算公式（所有目标基因都按此归一化到参考基因）：</p>
            <div className="tutorial__formula">
              <code>RE = 2<sup>−(Ct<sub>目标基因</sub> − Ct<sub>参考基因</sub>)</sup></code>
            </div>

            <p>算完后，每个目标基因会生成一张独立的 sheet，结构如下：</p>
            <div className="tutorial__table-wrap">
              <table className="tutorial__table">
                <thead>
                  <tr><th>列</th><th>内容</th></tr>
                </thead>
                <tbody>
                  <tr><td>A</td><td>参考基因 Ct 值</td></tr>
                  <tr><td>B</td><td>目标基因 Ct 值</td></tr>
                  <tr><td>C</td><td>Relative Expression（RE）</td></tr>
                  <tr><td>D</td><td>该组 Average（均值）</td></tr>
                  <tr><td>E</td><td>该组 Stdev（标准差）</td></tr>
                  <tr><td>F</td><td>Group_Name（组名）</td></tr>
                </tbody>
              </table>
            </div>
            <p>此外还会生成一张 <code>Summary_All_Genes</code> 汇总表，包含所有基因所有组的 RE、均值和标准差。</p>
            <Callout type="warn">
              ⚠️ 如果某组数据有缺失（Ct 为空），该组的均值和标准差不会计算，显示为 N/A。
              请回到原始 Excel 补上对应孔位的 Ct 值后重新转换 + 计算。
            </Callout>
          </Section>

          {/* ── ④ 出图 ── */}
          <Section id="chart" title="④ 出图" subtitle="计算完自动生成，打开 Excel 就能看">
            <p>
              计算完成后，图表会<strong>自动嵌入</strong>到每个基因 sheet 的底部。
              每张图是一根柱状图：
            </p>
            <ul>
              <li>横轴 = 不同样本 / 分组</li>
              <li>纵轴 = Relative Expression（归一化到参考基因）</li>
              <li>柱子颜色 = 你选的颜色</li>
              <li>重复次数 ≥ 2 时自动添加<strong>误差棒</strong>（标准差）</li>
            </ul>
            <p>
              图表是 <strong>Excel 原生图表对象</strong>，双击即可在 Excel / WPS / LibreOffice 中二次编辑
              （改颜色、改标题、调大小等）。
            </p>
            <Callout type="info">
              ✅ 不需要安装 Excel 也能生成图表——Mynx 直接修改 xlsx 文件的 XML 实现，
              生成后用任何能打开 xlsx 的软件都能看到图。
            </Callout>
          </Section>

          {/* ── FAQ ── */}
          <Section id="faq" title="❓ 常见问题" subtitle="对号入座，看怎么办">
            <Faq q="按钮一直灰着点不动？">
              <strong>「执行转换」灰：</strong>检查文件是不是 <code>.xlsx</code>，以及 sheet 下拉里选对了没。
              <br /><strong>「执行计算」灰：</strong>检查「参考基因」下拉里有没有值（需要先跑过「执行转换」）。
            </Faq>
            <Faq q="Relative Expression 全是 N/A？">
              通常是参考基因那几行 Ct 缺失（原始数据有空格或 N/A）。
              打开生成的 Excel，看 Transformed Data sheet 里参考基因那列的<strong>黄格子</strong>，
              回原始 Excel 补上对应孔位的 Ct，再重新转换 + 计算。
            </Faq>
            <Faq q="想用多个内参（GAPDH + ACTB）？">
              当前版本只支持 1 个内参基因。想用多内参的话：在 Excel 里先用公式算出
              多个内参基因的<strong>几何均值</strong>，作为一个新的单一参考列导入即可。
            </Faq>
            <Faq q="想看 Control vs Treat 的 Fold Change？">
              在导出的 Excel 里，把 Treat 组的 Average 除以 Control 组的 Average，就是 Fold Change。
            </Faq>
            <Faq q="图的颜色 / 样式想改？">
              直接在 Excel 里双击图表修改——图表是 Excel 原生对象，所有样式都能二次编辑。
              也可以在「柱状图颜色」里选一个新色，选择会自动保存，下次计算自动用新颜色。
            </Faq>
            <Faq q="将来会支持 Mac / Linux 吗？">
              会，敬请期待。目前仅支持 Windows。
            </Faq>
          </Section>

          <div className="tutorial__footer">
            <button className="btn btn-primary tutorial__done" onClick={onClose}>
              我看完了，开始使用 →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
 * 教程辅助子组件
 * ================================================================ */

function Section({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section id={`tut-${id}`} className="tutorial__section">
      <h2 className="tutorial__h2">{title}</h2>
      <p className="tutorial__subtitle-inline">{subtitle}</p>
      {children}
    </section>
  );
}

function Callout({
  type,
  children,
}: {
  type: "info" | "warn" | "tip";
  children: React.ReactNode;
}) {
  return <div className={`tutorial__callout tutorial__callout--${type}`}>{children}</div>;
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="tutorial__faq"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>
        <span>{q}</span>
        <span className={`tutorial__faq-arrow ${open ? "open" : ""}`}>›</span>
      </summary>
      <div className="tutorial__faq-body">{children}</div>
    </details>
  );
}
