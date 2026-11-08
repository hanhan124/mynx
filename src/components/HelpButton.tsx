import { useState, useEffect, useRef } from "react";
import Modal from "./Modal";
import { IconQuestionMark, IconX, IconChevronRight } from "@tabler/icons-react";
import { useLanguage } from "@/lib/i18n";

interface Props {
  variant?: "inline" | "icon";
}

export default function HelpButton({
  variant = "icon",
  children,
}: Props & { children: (close: () => void) => React.ReactNode }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={`help-btn help-btn--${variant}`}
        onClick={() => setOpen(true)}
        title={t("help.title")}
        aria-label={t("help.title")}
      >
        <IconQuestionMark size={variant === "inline" ? 14 : 13} stroke={1.75} />
        {variant === "inline" && <span>{t("help.label")}</span>}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} wide>
        {children(() => setOpen(false))}
      </Modal>
    </>
  );
}

/* ================================================================
 * 通用教程辅助子组件
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

function EnglishToolTutorial({
  type,
  onClose,
}: {
  type: "qpcr" | "image" | "chart";
  onClose: () => void;
}) {
  const qpcr = type === "qpcr";
  const chart = type === "chart";
  const title = qpcr
    ? "qPCR analysis guide"
    : chart
      ? "Scientific plotting guide"
      : "Image to PNG guide";
  const subtitle = qpcr
    ? "From Ct values to charts in four steps"
    : chart
      ? "Journal-ready figures from your data, powered by a local R engine"
      : "Batch conversion, compression and watermarks";
  const sections = chart
    ? [
        ["Pick a chart", "Choose a template from the left catalog; each covers one figure style (bar, box, volcano, PCA, …)."],
        ["Import data", "Paste, type or upload your data, then map columns to axes, groups and errors."],
        ["Style & layout", "Set palette, fonts, axis titles, legend and journal size presets (89/120/183 mm)."],
        ["Generate", "Render with the local R engine and export PNG/SVG/PDF at publication quality."],
      ]
    : qpcr
      ? [
          ["Prepare", "Use an Excel workbook containing Target/Gene, Sample/Group, and Ct columns."],
          ["Transform", "Open the workbook, choose the worksheet, then transform data into the analysis layout."],
          ["Calculate", "Choose a calculation method, reference gene, replicate count, and optional control group."],
          ["Export", "Run calculation to save the workbook and create charts for each target gene."],
        ]
      : [
          ["Add files", "Add image files or folders with the buttons, or drop them onto the files card."],
          ["Set options", "Pick lossless optimization or lossy (indexed color) compression, an optional text or image watermark, and where outputs go."],
          ["Convert", "Start conversion. Progress streams live and can be cancelled; a per-file result table follows."],
        ];
  return (
    <div className="tutorial">
      <div className="tutorial__header">
        <div><div className="tutorial__title">{title}</div><div className="tutorial__subtitle">{subtitle}</div></div>
        <button className="tutorial__close" onClick={onClose} aria-label="Close guide"><IconX size={16} stroke={1.75} /></button>
      </div>
      <div className="tutorial__body"><div className="tutorial__content" style={{ width: "100%" }}>
        <section className="tutorial__section"><h2 className="tutorial__h2">Quick start</h2><p className="tutorial__subtitle-inline">Follow the workflow below</p><ol>{sections.map(([heading, text]) => <li key={heading}><strong>{heading}:</strong> {text}</li>)}</ol></section>
        <section className="tutorial__section"><h2 className="tutorial__h2">Notes</h2><div className="tutorial__callout tutorial__callout--info">{qpcr ? "qPCR uses spreadsheet data locally. Keep a copy of your original workbook before processing." : chart ? "Charts are rendered by a local R engine (ggplot2/ComplexHeatmap). Install R when prompted; presets can be saved, imported and exported as JSON." : "Conversion runs fully locally via open-source engines (image-rs, oxipng, resvg). Sources are never overwritten; output files are always new PNGs."}</div></section>
        <div className="tutorial__footer"><button type="button" className="btn btn-primary tutorial__done" onClick={onClose}>Start using Mynx</button></div>
      </div></div>
    </div>
  );
}

/* ================================================================
 * 通用滚动监听 hook — 目录高亮当前可见章节
 * ================================================================ */
function useTutorialScroll(sections: { id: string }[]) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");
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
        { id: sections[0]?.id ?? "", top: -Infinity }
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

  return { activeId, scrollRef, scrollTo };
}

/* ================================================================
 * qPCR 使用教程 — 纯用户视角
 * ================================================================ */

export function QpcrTutorial({ onClose }: { onClose: () => void }) {
  const { language } = useLanguage();
  const sections = [
    { id: "intro", title: "📖 简介" },
    { id: "prep", title: "📋 准备 Excel" },
    { id: "file", title: "① 选文件" },
    { id: "transform", title: "② 转数据" },
    { id: "calc", title: "③ 算表达量" },
    { id: "chart", title: "④ 出图" },
    { id: "faq", title: "❓ 常见问题" },
  ];

  const { activeId, scrollRef, scrollTo } = useTutorialScroll(sections);
  if (language === "en") return <EnglishToolTutorial type="qpcr" onClose={onClose} />;

  return (
    <div className="tutorial">
      <div className="tutorial__header">
        <div>
          <div className="tutorial__title">qPCR 分析使用教程</div>
          <div className="tutorial__subtitle">从原始 Ct 到图表 · 4 步走完</div>
        </div>
        <button className="tutorial__close" onClick={onClose} aria-label="关闭教程">
          <IconX size={16} stroke={1.75} />
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
                  <IconChevronRight size={12} stroke={1.75} />
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
              <li><strong>算表达量</strong> — 选方法 + 内参基因，自动算 RE + 均值 + 标准差</li>
              <li><strong>出图</strong> — 每个基因自动生成柱状图（带误差棒）</li>
            </ol>
            <Callout type="info">
              支持两种计算方法：<strong>相对内参</strong>（默认）和<strong>相对对照（ΔΔCt）</strong>，
              适合处理 96 / 384 孔板数据，把多个目标基因归一化到内参基因。
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
          <Section id="calc" title="③ 算表达量" subtitle="选好方法 + 参数，点「执行计算」">
            <p>先选<strong>计算方法</strong>，再设置其余参数：</p>

            <div className="tutorial__table-wrap">
              <table className="tutorial__table">
                <thead>
                  <tr><th>方法</th><th>说明</th><th>结果列名</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>相对内参</strong>（默认）</td>
                    <td>每个样本 2^-(ΔCt) = 2^-(目标 - 内参)，不做对照归一化</td>
                    <td><code>Relative Expression</code></td>
                  </tr>
                  <tr>
                    <td><strong>相对对照</strong>（ΔΔCt）</td>
                    <td>在相对内参基础上，再除以对照组平均 RE，使对照组 ≈ 1，其余组为相对倍数</td>
                    <td><code>Normalized Expression</code></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p>选定方法后，设置其余参数：</p>
            <ul>
              <li><strong>对照组</strong>（仅 ΔΔCt 方法）：从下拉框选一个组作为对照，其余组归一化到它</li>
              <li><strong>重复次数</strong>：选 1–12，跟实际技术重复数一致</li>
              <li><strong>参考基因</strong>：选 1 个（常用 GAPDH / ACTB），默认选第一个基因</li>
              <li><strong>柱状图颜色</strong>：默认蓝色，可自定义，选择会自动记住</li>
              <li><strong>重复处理</strong>：选 0 关闭。两种模式二选一：
                <ul>
                  <li><strong>择优重复数</strong>：选 K（≥2）时为每个样本挑选标准差最低的 K 个重复，
                    生成 <code>Summary_Best_Replicates</code> 汇总表</li>
                  <li><strong>离群值剔除</strong>：选 ±K×SD 时迭代剔除偏离组均值超过 K×SD 的重复，
                    生成 <code>Summary_Outlier_Removed</code> 汇总表</li>
                </ul>
              </li>
            </ul>

            <p>相对表达量计算公式：</p>
            <div className="tutorial__formula">
              <code>相对内参：RE = 2<sup>−(Ct<sub>目标</sub> − Ct<sub>内参</sub>)</sup></code>
            </div>
            <div className="tutorial__formula" style={{ marginTop: 8 }}>
              <code>相对对照：NE = RE / 对照组平均RE</code>
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
                  <tr><td>C</td><td>Relative / Normalized Expression（取决于方法）</td></tr>
                  <tr><td>D</td><td>该组 Average（均值）</td></tr>
                  <tr><td>E</td><td>该组 Stdev（标准差）</td></tr>
                  <tr><td>F</td><td>Group_Name（组名）</td></tr>
                  <tr><td>G</td><td>Method（方法标注，含对照组名）</td></tr>
                </tbody>
              </table>
            </div>
            <p>此外还会生成一张 <code>Summary_All_Genes</code> 汇总表，包含所有基因所有组的表达量、均值和标准差，每行末尾标注 Method，并附上原始 Ct 值：内参基因和目标基因各按重复列出一列（直接从 <code>Transformed Data</code> 复制，标黄的填补值会一并标黄）。表头按列区块配色（蓝=基因/组名、深蓝=重复、绿=均值/标准差、橙=方法、黄=内参 Ct、紫=目标 Ct），并冻结了首行和前两列，方便区分。</p>
            <p>如果勾选了「择优重复数」≥ 2，还会生成一张 <code>Summary_Best_Replicates</code> 汇总表：
              对每个基因 × 样本组，从所有重复中穷举选出<strong>标准差最低的 K 个重复</strong>，
              格式与 <code>Summary_All_Genes</code> 一致（含原始内参 / 目标 Ct），
              每行 Method 列会额外标注 <code>Best-K subset</code>。</p>
            <Callout type="warn">
              ⚠️ 该表是<strong>内部 QC / 探索性参考</strong>，不是标准统计结果：只保留标准差最低的 K 个重复
              会系统性低估变异（SD 偏小），属于选择性报告，<strong>不直接用于发表</strong>。
              正式报告一律以 <code>Summary_All_Genes</code>（全部重复的均值 ± SD）为准。
            </Callout>
            <p>如果选「离群值剔除」，还会生成一张 <code>Summary_Outlier_Removed</code> 汇总表：
              按预先定义的客观规则（迭代式剔除偏离组均值超过 K×SD 的重复，未超阈值不剔除）
              给出剔除后的均值 ± SD，格式同 <code>Summary_All_Genes</code>；
              被剔除的重复留空，末尾 <code>Removed</code> 列标注被剔除的重复编号。
              规则客观且可披露，<strong>可用于发表</strong>（在方法学中写明规则即可）。</p>
            <Callout type="warn">
              ⚠️ 如果某组数据有缺失（Ct 为空），该组的均值和标准差不会计算，显示为 N/A。
              请回到原始 Excel 补上对应孔位的 Ct 值后重新转换 + 计算。
            </Callout>
            <Callout type="info">
              ΔΔCt 方法要求对照组必须有<strong>完整且有效的重复数据</strong>，
              否则会提示「未找到对照组的有效数据」。请确保对照组的 Ct 值齐全。
            </Callout>
          </Section>

          {/* ── ④ 出图 ── */}
          <Section id="chart" title="④ 出图" subtitle="计算完自动生成，打开 Excel 就能看">
            <p>
              计算完成后，图表会<strong>自动嵌入</strong>到每个基因 sheet 的底部，
              并新建一张 <code>Charts_All_Genes</code> 汇总表，把<strong>所有基因的柱状图
              纵向排列复制</strong>到一起，方便一次浏览全部结果。
              每张图是一根柱状图：
            </p>
            <ul>
              <li>横轴 = 不同样本 / 分组</li>
              <li>纵轴标题根据方法不同：
                <ul>
                  <li>相对内参：<code>Normalize to {`{内参基因}`}</code></li>
                  <li>相对对照：<code>Normalize to {`{对照组}`} ({`{内参基因}`})</code></li>
                </ul>
              </li>
              <li>柱子颜色 = 你选的颜色</li>
              <li>重复次数 ≥ 2 时自动添加<strong>误差棒</strong>（标准差，单向向上）</li>
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
              如果选了「相对对照」方法，「对照组」也必须有值。
            </Faq>
            <Faq q="相对对照（ΔΔCt）提示「未找到对照组有效数据」？">
              切换到「相对对照」方法后，需要在<strong>对照组</strong>下拉里选一个组名。
              该组必须在 Transformed Data 里有<strong>完整的技术重复</strong>且 Ct 值都有效（非空）。
              如果对照组 Ct 缺失，请回原始 Excel 补齐后重新转换 + 计算。
            </Faq>
            <Faq q="表达量全是 N/A？">
              通常是参考基因那几行 Ct 缺失（原始数据有空格或 N/A）。
              打开生成的 Excel，看 Transformed Data sheet 里参考基因那列的<strong>黄格子</strong>，
              回原始 Excel 补上对应孔位的 Ct，再重新转换 + 计算。
            </Faq>
            <Faq q="想用多个内参（GAPDH + ACTB）？">
              当前版本只支持 1 个内参基因。想用多内参的话：在 Excel 里先用公式算出
              多个内参基因的<strong>几何均值</strong>，作为一个新的单一参考列导入即可。
            </Faq>
            <Faq q="想看 Control vs Treat 的 Fold Change？">
              直接选「相对对照（ΔΔCt）」方法，对照组选 Control 组即可。
              算出的 Normalized Expression 就是相对对照组的倍数变化（对照组 ≈ 1）。
            </Faq>
            <Faq q="图的颜色 / 样式想改？">
              直接在 Excel 里双击图表修改——图表是 Excel 原生对象，所有样式都能二次编辑。
              也可以在「柱状图颜色」里选一个新色，选择会自动保存，下次计算自动用新颜色。
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
 * 图片转 PNG 使用教程
 * ================================================================ */

export function ImageConvertTutorial({ onClose }: { onClose: () => void }) {
  const { language } = useLanguage();
  const sections = [
    { id: "intro", title: "📖 简介" },
    { id: "files", title: "① 添加文件" },
    { id: "compress", title: "② 压缩设置" },
    { id: "watermark", title: "③ 水印设置" },
    { id: "output", title: "④ 输出位置" },
    { id: "result", title: "⑤ 转换结果" },
    { id: "faq", title: "❓ 常见问题" },
  ];

  const { activeId, scrollRef, scrollTo } = useTutorialScroll(sections);
  if (language === "en") return <EnglishToolTutorial type="image" onClose={onClose} />;

  return (
    <div className="tutorial">
      <div className="tutorial__header">
        <div>
          <div className="tutorial__title">图片转 PNG 使用教程</div>
          <div className="tutorial__subtitle">批量转换 · 无损/有损压缩 · 水印</div>
        </div>
        <button className="tutorial__close" onClick={onClose} aria-label="关闭教程">
          <IconX size={16} stroke={1.75} />
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
                  <IconChevronRight size={12} stroke={1.75} />
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
              Mynx 图片转 PNG 模块可以<strong>批量</strong>把常见图片格式转换为 PNG：
              PNG / JPG / TIFF / WebP / BMP / GIF / ICO / TGA / PNM / QOI / DDS / SVG 等，
              并支持<strong>无损优化</strong>、<strong>有损压缩</strong>和<strong>水印</strong>。
            </p>
            <p>典型流程：</p>
            <ol>
              <li><strong>添加文件</strong> — 文件、文件夹或直接拖入</li>
              <li><strong>压缩设置</strong> — 无损优化 / 有损索引色</li>
              <li><strong>水印</strong> — 文字或图片 logo，可平铺</li>
              <li><strong>开始转换</strong> — 实时进度，可随时取消</li>
            </ol>
            <Callout type="info">
              转换全部在本地完成，由成熟开源引擎驱动（image-rs 解码、oxipng 无损优化、
              resvg 渲染 SVG），无需安装 ImageMagick 等外部程序。
            </Callout>
          </Section>

          {/* ── ① 添加文件 ── */}
          <Section id="files" title="① 添加文件" subtitle="文件 / 文件夹 / 拖放">
            <p>三种方式：</p>
            <ul>
              <li><code>添加文件</code> — 多选文件</li>
              <li><code>添加文件夹</code> — 递归扫描子文件夹里的图片</li>
              <li>把文件或文件夹<strong>直接拖到</strong>左侧卡片里</li>
            </ul>
            <p>列表会显示缩略图、尺寸和大小，可单独移除或一键清空。</p>
            <Callout type="tip">
              多页 TIFF 会<strong>每一页单独导出</strong>为 <code>名字_p1.png</code>、
              <code>名字_p2.png</code>…；动图（GIF / 动图 WebP）取第一帧。
            </Callout>
          </Section>

          {/* ── ② 压缩设置 ── */}
          <Section id="compress" title="② 压缩设置" subtitle="无损 or 有损">
            <div className="tutorial__table-wrap">
              <table className="tutorial__table">
                <thead>
                  <tr><th>模式</th><th>原理</th><th>适合</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>无损优化</strong>（默认）</td>
                    <td>像素完全不变，用 oxipng 重新组织压缩流；优化强度越高压得越小、耗时越长</td>
                    <td>截图、图表、需要保真的一切</td>
                  </tr>
                  <tr>
                    <td><strong>有损压缩（索引色）</strong></td>
                    <td>把颜色量化到 256 / 128 / 64 / 32 色调色板，可加抖动；体积通常降到原来的 20%–50%</td>
                    <td>照片分享、表情包、体积敏感场景</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <Callout type="warn">
              ⚠️ 有损模式会改变像素颜色（最多只剩所选颜色数），输出<strong>不可逆</strong>。
              需要保真请用无损。
            </Callout>
          </Section>

          {/* ── ③ 水印设置 ── */}
          <Section id="watermark" title="③ 水印设置" subtitle="文字或图片 logo">
            <p>开关打开后可选两种水印：</p>
            <ul>
              <li>
                <strong>文字水印</strong> — 内容默认使用文件名（留空即可），也可自定义；
                支持字体（微软雅黑 / 黑体 / 宋体 / Arial 等）、字号、粗体、白/黑颜色、
                不透明度、九宫格位置或<strong>平铺</strong>，以及半透明文字底色
              </li>
              <li>
                <strong>图片水印</strong> — 选一张 PNG logo，
                控制相对大小（10%–60%）、不透明度和位置
              </li>
            </ul>
            <Callout type="info">
              水印在转换前叠加，原图永不修改。字体使用系统自带字体；
              若系统找不到可用字体（极少数精简系统），转换仍会完成，仅跳过水印并提示。
            </Callout>
          </Section>

          {/* ── ④ 输出位置 ── */}
          <Section id="output" title="④ 输出位置" subtitle="三种落盘方式">
            <ul>
              <li>
                <strong>源目录子文件夹</strong>（默认）— 在每个源文件所在目录创建
                <code>PNG_output_年月日_时分秒</code>，多次转换互不覆盖
              </li>
              <li><strong>与原图同目录</strong> — 直接生成在原文件旁边</li>
              <li><strong>自定义目录</strong> — 所有输出集中到一个文件夹</li>
            </ul>
            <Callout type="warn">
              ⚠️ 重压缩 PNG 时输出永远写入<strong>新文件</strong>（重名自动加
              <code>-min</code> / <code>-1</code> 后缀），原图不会被覆盖或删除。
            </Callout>
          </Section>

          {/* ── ⑤ 转换结果 ── */}
          <Section id="result" title="⑤ 转换结果" subtitle="逐文件对比">
            <p>
              转换完成后会生成结果表：每个文件的<strong>原始大小 → 转换后大小</strong>、
              压缩率、成功 / 失败状态，底部汇总总体节省的体积百分比。
            </p>
            <p>转换中可随时点「取消」，已完成的文件保留。</p>
            <Callout type="tip">
              点「打开输出文件夹」直达结果目录。个别文件失败不影响其余文件，
              失败原因悬停在状态上可查看。
            </Callout>
          </Section>

          {/* ── FAQ ── */}
          <Section id="faq" title="❓ 常见问题" subtitle="对号入座，看怎么办">
            <Faq q="为什么转换后 PNG 反而变大了？">
              无损优化对<strong>已经高度压缩</strong>的 PNG 提升有限，个别文件可能略增
              （oxipng 保证不破坏像素）。照片类内容建议改用<strong>有损索引色</strong>模式。
            </Faq>
            <Faq q="HEIC / iPhone 照片支持吗？">
              暂不支持 HEIC（需要系统级解码器）。可先在系统相册导出为 JPG 再转换。
            </Faq>
            <Faq q="水印字体没生效？">
              水印使用系统字体：Windows 用微软雅黑 / 黑体 / 宋体等，macOS 自动映射到苹方 /
              宋体-简。精简系统可能缺字体，此时转换正常完成但水印被跳过。
            </Faq>
            <Faq q="有损压缩选多少色合适？">
              256 色几乎看不出差别；截图 / 图表 128 色也很安全；照片 64 或 32 色
              体积最小，可开「抖动」减少色带。
            </Faq>
            <Faq q="SVG 转出来的 PNG 分辨率是多少？">
              SVG 是矢量格式，Mynx 会自动渲染到最长边 ≥1024px（上限 8192），
              保证导出后清晰可用。
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
 * 科研绘图教程(与 qPCR / 图片转 PNG 教程同一套结构与样式)
 * ================================================================ */

export function ChartStudioTutorial({ onClose }: { onClose: () => void }) {
  const { language } = useLanguage();
  const sections = [
    { id: "intro", title: "📖 简介" },
    { id: "flow", title: "🧭 出图流程" },
    { id: "preset", title: "💾 参数管理" },
    { id: "faq", title: "❓ 常见问题" },
  ];

  const { activeId, scrollRef, scrollTo } = useTutorialScroll(sections);
  if (language === "en") return <EnglishToolTutorial type="chart" onClose={onClose} />;

  return (
    <div className="tutorial">
      <div className="tutorial__header">
        <div>
          <div className="tutorial__title">科研绘图使用教程</div>
          <div className="tutorial__subtitle">选模板 → 导数据 → 调版式 → 生成导出</div>
        </div>
        <button className="tutorial__close" onClick={onClose} aria-label="关闭教程">
          <IconX size={16} stroke={1.75} />
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
                  <IconChevronRight size={12} stroke={1.75} />
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
              科研绘图模块用内置的 <strong>R 引擎</strong>(ggplot2 / ComplexHeatmap)在本地把数据
              渲染成<strong>发表级图表</strong>:柱状图、箱线图、火山图、PCA、热图等几十种模板,
              输出直接对齐期刊栏宽(单栏 89 mm / 1.5 栏 120 mm / 双栏 183 mm)。
            </p>
            <Callout type="info">
              首次出图会要求安装 R 与相关包,按提示确认即可;之后所有绘制都在本机完成,
              数据不出本机。
            </Callout>
          </Section>

          {/* ── 出图流程 ── */}
          <Section id="flow" title="🧭 出图流程" subtitle="四步一张图">
            <ol>
              <li><strong>选模板</strong> — 左侧图库按类型挑选图表模板</li>
              <li><strong>导数据</strong> — 粘贴 / 上传数据,把列映射到坐标轴、分组与误差棒</li>
              <li><strong>调版式</strong> — 配色、字体、坐标轴标题、图例与期刊尺寸预设</li>
              <li><strong>生成</strong> — 本地 R 渲染,导出 PNG / SVG / PDF</li>
            </ol>
            <Callout type="tip">
              生成过程中可随时「取消」;界面实时显示渲染进度与日志。
            </Callout>
          </Section>

          {/* ── 参数管理 ── */}
          <Section id="preset" title="💾 参数管理" subtitle="一次调好,反复套用">
            <p>
              页面右上角四个按钮管理当前图表的全部参数:
            </p>
            <ul>
              <li><strong>保存参数</strong> — 当前模板 + 数据映射 + 版式存为 JSON 预设</li>
              <li><strong>导入参数</strong> — 从 JSON 预设文件恢复</li>
              <li><strong>加载出图参数</strong> — 读取某次出图自动保存的同名参数清单</li>
              <li><strong>导出参数</strong> — 把预设分享给同事或另一台电脑</li>
            </ul>
            <Callout type="tip">
              「已保存的参数」卡片里可一键套用历史预设,微调后再次保存为新版本。
            </Callout>
          </Section>

          {/* ── FAQ ── */}
          <Section id="faq" title="❓ 常见问题" subtitle="对号入座,看怎么办">
            <Faq q="提示未找到 Rscript 怎么办?">
              点击页面右上角的「Rscript 未找到」标签,按提示通过 winget / Homebrew 安装 R;
              安装完成无需重启,再点一次标签即可检测到。
            </Faq>
            <Faq q="生成的图能到多大分辨率?">
              PNG 按 300 dpi 输出,SVG / PDF 为矢量格式,可无限放大;期刊投稿优先选
              PDF 或 SVG。
            </Faq>
            <Faq q="图表数据和我的原始数据会被上传吗?">
              不会。渲染由本机 R 完成,数据与图片全程不出本机。
            </Faq>
          </Section>

          <div className="tutorial__footer">
            <button className="btn btn-primary tutorial__done" onClick={onClose}>
              我看完了,开始使用 →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
