/**
 * RNA-seq 使用教程 — 沿用 mynx 通用教程组件体系(tutorial__*)。
 */
import { IconX } from "@tabler/icons-react";
import { useLanguage } from "@/lib/i18n";

const SECTIONS = [
  { id: "intro", title: "📖 简介" },
  { id: "prep", title: "🧰 准备工作" },
  { id: "flow", title: "🚀 三步流程" },
  { id: "methods", title: "🧪 统计方法" },
  { id: "figures", title: "📊 图表方法" },
  { id: "output", title: "📦 结果解读" },
  { id: "faq", title: "❓ 常见问题" },
];

type FigureMethod = {
  title: string;
  method: string;
  interpretation: string;
};

const FIGURE_METHODS_ZH: FigureMethod[] = [
  {
    title: "样本 QC",
    method:
      "从进入分析的原始 counts 计算文库深度（各样本 counts 总和）和检测基因数（count > 0 的基因数）；从归一化/变换表达矩阵绘制表达分布箱线图、样本 Pearson 相关性热图与样本欧氏距离热图。",
    interpretation:
      "用于发现测序深度极低、检测基因数异常、整体表达分布偏移或样本间关系异常的样本。它是质量检查，不是差异检验。",
  },
  {
    title: "PCA 图",
    method:
      "对所有未排除基因的 VST/log2-CPM 变换表达矩阵进行主成分分析；默认不再逐基因 Z 标准化，以保留变换后仍有意义的基因间变异结构，坐标轴显示 PC1/PC2 的解释方差比例。可限定为方差最高的一部分基因。",
    interpretation:
      "相近样本应在 PCA 空间中相邻。PCA 反映总体表达结构，不给出某个单基因或组间差异的显著性。",
  },
  {
    title: "MDS 图",
    method:
      "基于变换表达矩阵中样本两两欧氏距离，使用经典多维尺度分析（cmdscale）投影到二维。",
    interpretation:
      "与 PCA 互为独立的样本结构核验；若两图均显示离群样本或批次分离，应回到实验记录和 QC 处理。",
  },
  {
    title: "整体热图",
    method:
      "默认使用候选 DEG；候选基因超过默认 2,000 个上限时按最小 FDR、再按绝对效应量保留。对每个基因在样本间计算行 Z-score，采用欧氏距离和 Ward.D2 层次聚类（默认 k=3），并按簇及首列表达顺序排列；色阶默认截断于 Z-score −2 至 2。",
    interpretation:
      "颜色表示同一基因在各样本间的相对高低，不能比较不同基因的绝对表达量；热图聚类用于模式展示，不是额外的统计检验。",
  },
  {
    title: "选定基因/功能簇热图",
    method:
      "从原始 counts 对当前选定样本重新进行 edgeR TMM 归一化，计算 log2-CPM（prior count=0.5），按用户定义的功能簇和基因顺序展示；每个基因再做行 Z-score。",
    interpretation:
      "适用于展示预先定义的标志物或通路基因。功能簇和基因清单应在论文中说明其生物学来源，避免把事后筛选当作独立验证。",
  },
  {
    title: "火山图",
    method:
      "每个比较的全量检验基因以未收缩 log2FC 为横轴、−log10(BH 调整后 P 值)为纵轴。上调、下调与不显著基因按当前 FDR 和 |log2FC| 阈值着色；阈值虚线、标签数量和标签策略仅影响展示。",
    interpretation:
      "火山图同时呈现效应量与显著性。极小 P 值可按显示下限截断以避免拉伸坐标，但原始表格中的统计量不被改写。",
  },
  {
    title: "MA 图",
    method:
      "每个比较以 log2(mean expression + 1) 为横轴、log2FC 为纵轴；颜色使用与 DEG 判定相同的 up/down/not-significant 分类，可选 y=0 参考线和 LOESS 趋势线。",
    interpretation:
      "用于检查效应量是否随表达强度发生系统性偏移。低表达区的离散度较大是计数数据的常见现象。",
  },
  {
    title: "Venn 图",
    method:
      "默认集合为每个比较中满足当前 DEG 阈值的上、下调基因并集；可切换为样本模式，此时集合为该样本表达高于热图矩阵中位数的基因。集合过多时自动改为两两图。",
    interpretation:
      "比较模式适合描述 DEG 重叠；样本模式仅为探索性表达集合，不可解释为差异基因重叠。Venn 图不提供重叠显著性检验。",
  },
  {
    title: "表达分布箱线图",
    method:
      "将每个样本的归一化/变换表达矩阵展开为长表，按样本绘制箱线图并以分组着色；箱体为四分位范围，中位数为箱内横线，离群点可调整。",
    interpretation: "用于比较各样本总体表达分布是否可比；并非单个基因的组间统计检验。",
  },
  {
    title: "DEG 统计柱状图",
    method:
      "对每个已选比较，直接计数当前阈值下 regulation=up 与 regulation=down 的基因数量，以堆叠或并排柱形图显示。",
    interpretation:
      "仅是差异结果摘要；不同比较的 DEG 数量会受样本量、离散度、测序深度和效应量共同影响，不能单独作为生物学效应强弱的证据。",
  },
  {
    title: "Top 基因条形图",
    method:
      "在每个比较的完整结果中按调整后 P 值升序选择前 N 个基因，以未收缩 log2FC 绘制水平柱形图，并按效应方向着色。",
    interpretation:
      "它展示统计排序靠前的基因，不等同于“表达最高”或“最重要”的基因；应结合 baseMean、功能证据与独立验证解读。",
  },
  {
    title: "样本聚类树状图",
    method:
      "先对归一化/变换表达矩阵计算样本 Pearson 相关性，再以 1−r 作为距离，使用默认 Ward.D2 层次聚类；叶标签按分组着色。",
    interpretation:
      "用于检查样本整体相似性与潜在离群。树的分支高度是相关性距离，不代表系统发育关系或统计显著性。",
  },
  {
    title: "单基因表达小提琴图",
    method:
      "从变换表达矩阵中提取指定基因（未指定时使用标志基因），按组绘制核密度小提琴并叠加每个样本的抖动点；不同基因使用独立 y 轴范围。",
    interpretation:
      "用于直观展示样本层面的表达分布。若需在图上报告 P 值，应采用与设计相符的独立统计检验，而非由小提琴图本身推断。",
  },
  {
    title: "表达密度图",
    method: "将每个样本或分组的全部变换表达值用核密度估计绘制为重叠密度曲线。",
    interpretation:
      "用于检查整体表达分布、归一化后是否仍存在明显平移或多峰；密度曲线不是差异分析。",
  },
  {
    title: "方向性 ORA 富集图",
    method:
      "对每个比较的上调与下调 DEG 分别进行过度富集分析（ORA），将基因符号映射至 Entrez ID；背景优先使用进入该比较检验的所有可映射基因。支持 GO、KEGG 及可选 Reactome/WikiPathways，按数据库和方向保留前 N 个调整后 P 值最小的条目。",
    interpretation:
      "上、下调方向分开可避免相反变化的基因被混合解释。富集受基因 ID 映射、背景集和数据库版本影响，应报告这些信息及多重校正阈值。",
  },
  {
    title: "GSEA 点图与运行分数图",
    method:
      "不以 DEG 阈值筛选基因，而是对每个比较的全部可检验基因排序：优先使用 DESeq2 Wald statistic；无该统计量时使用 sign(log2FC)×−log10(P)。映射至 Entrez ID 后对 GO、KEGG 及可选通路库运行 GSEA；点图横轴为 NES，点大小为−log10(adjusted P)，并导出显著条目的 running-score/leading-edge 图。",
    interpretation:
      "NES 的正负方向相对于比较定义中的 Treatment vs Control。GSEA 更适合连续、协调但单基因效应较弱的信号；需注意基因排序指标和 ID 映射覆盖率。",
  },
];

const FIGURE_METHODS_EN: FigureMethod[] = [
  {
    title: "Sample QC",
    method:
      "Library size (sum of included raw counts) and detected genes (genes with count > 0) are calculated from raw counts. Expression-distribution boxplots, Pearson-correlation heatmaps, and Euclidean-distance heatmaps use the normalized/transformed expression matrix.",
    interpretation:
      "These are quality-control diagnostics for shallow libraries, atypical gene detection, distribution shifts, or unusual sample relationships; they are not differential tests.",
  },
  {
    title: "PCA",
    method:
      "Principal component analysis is performed with prcomp on transformed expression values for all non-excluded genes. Genes are standardized by default, and PC1/PC2 axes report explained variance; an optional high-variance-gene subset can be used.",
    interpretation:
      "Nearby samples have similar global expression profiles. PCA does not assign statistical significance to a gene or group difference.",
  },
  {
    title: "MDS",
    method:
      "Classical multidimensional scaling (cmdscale) projects Euclidean distances among samples in the transformed expression matrix into two dimensions.",
    interpretation:
      "MDS is an independent check of sample structure alongside PCA. Concordant outliers or batch separation should be investigated using QC and experimental metadata.",
  },
  {
    title: "Global heatmap",
    method:
      "Candidate DEGs are used by default. Above the default cap of 2,000 genes, genes are prioritized by minimum FDR and then absolute effect size. Row Z-scores are calculated across samples, and Ward.D2 hierarchical clustering with Euclidean distance (default k = 3) is used; the default color scale is clipped at Z-score −2 to 2.",
    interpretation:
      "Color represents relative expression of the same gene across samples, not absolute expression between genes. Clustering is descriptive and is not an additional statistical test.",
  },
  {
    title: "Selected-gene / functional-cluster heatmap",
    method:
      "Raw counts for the selected samples are re-normalized with edgeR TMM and converted to log2-CPM (prior count = 0.5). User-defined functional clusters and gene order are displayed, followed by row Z-scoring.",
    interpretation:
      "Use this for predefined markers or pathway genes. State the biological source of functional clusters and avoid presenting post hoc selections as independent validation.",
  },
  {
    title: "Volcano plot",
    method:
      "All tested genes are plotted using unshrunken log2FC on the x-axis and −log10(BH-adjusted P value) on the y-axis. Up, down, and non-significant classes use the current FDR and |log2FC| cutoffs; threshold lines and labels are display-only settings.",
    interpretation:
      "The plot jointly shows effect size and significance. A display floor may cap extremely small P values without changing stored statistics.",
  },
  {
    title: "MA plot",
    method:
      "For each comparison, log2(mean expression + 1) is plotted against log2FC. Colors follow the same DEG classification as the result table; a zero reference line and LOESS trend can be displayed.",
    interpretation:
      "Use it to inspect intensity-dependent bias. Greater scatter at low expression is expected for count data.",
  },
  {
    title: "Venn diagram",
    method:
      "By default, each set is the union of up- and down-regulated genes meeting the current DEG threshold for a comparison. In sample mode, a set consists of genes above the heatmap-matrix median in that sample. Large set collections are exported as pairwise Venn diagrams.",
    interpretation:
      "Comparison mode describes DEG-set overlap. Sample mode is exploratory and does not represent differential-gene overlap. No overlap significance test is performed.",
  },
  {
    title: "Expression-distribution boxplot",
    method:
      "Each sample's normalized/transformed expression values are reshaped into a long table and displayed as sample-wise boxplots colored by group.",
    interpretation:
      "This compares global expression distributions, not a gene-level group test.",
  },
  {
    title: "DEG count barplot",
    method:
      "Up- and down-regulated genes are counted directly from the current regulation labels for every selected comparison and shown as stacked or dodged bars.",
    interpretation:
      "It is a result summary. DEG counts are jointly affected by sample size, dispersion, sequencing depth, and effect size, so they are not stand-alone evidence of biological magnitude.",
  },
  {
    title: "Top-gene barplot",
    method:
      "For each comparison, the top N rows ranked by adjusted P value are displayed as horizontal bars of unshrunken log2FC and colored by direction.",
    interpretation:
      "Top-ranked is not synonymous with highest expression or biological importance; interpret with baseMean, functional evidence, and independent validation.",
  },
  {
    title: "Sample dendrogram",
    method:
      "Pearson correlations are calculated among samples from normalized/transformed expression values. Distance is 1−r and hierarchical clustering uses Ward.D2 by default; leaf labels are colored by group.",
    interpretation:
      "Branch height is correlation distance, not phylogeny or statistical significance.",
  },
  {
    title: "Single-gene violin plot",
    method:
      "Specified genes (or marker genes by default) are extracted from the transformed matrix and plotted as group-wise kernel-density violins with individual sample points; each gene has an independent y-scale.",
    interpretation:
      "It displays sample-level distributions. Statistical annotations require a separate test appropriate for the experimental design.",
  },
  {
    title: "Expression-density plot",
    method:
      "All transformed expression values are summarized as kernel-density curves by sample or group.",
    interpretation:
      "Use this to inspect global distribution shifts or multimodality after normalization; it is not a differential analysis.",
  },
  {
    title: "Directional ORA enrichment",
    method:
      "Over-representation analysis is run separately for up- and down-regulated DEGs in each comparison. Gene symbols are mapped to Entrez IDs, and the background is preferably all mapped genes tested in that contrast. GO, KEGG, and optional Reactome/WikiPathways databases are supported.",
    interpretation:
      "Separating directions prevents opposite effects from being interpreted as one mechanism. Results depend on identifier mapping, background definition, and database version.",
  },
  {
    title: "GSEA dotplot and running-score plot",
    method:
      "GSEA uses all tested genes rather than a DEG cutoff. DESeq2 contrasts are ranked by Wald statistic; otherwise the rank is sign(log2FC) × −log10(P). After Entrez mapping, GSEA is run for selected databases. Dotplots show NES and adjusted significance, and top terms receive running-score/leading-edge plots.",
    interpretation:
      "NES direction is relative to Treatment versus Control. GSEA is useful for coordinated, weak single-gene effects; report the ranking metric and identifier-mapping coverage.",
  },
];

function FigureMethods({
  items,
  methodLabel,
  interpretationLabel,
}: {
  items: FigureMethod[];
  methodLabel: string;
  interpretationLabel: string;
}) {
  return (
    <div>
      {items.map((item) => (
        <details key={item.title} className="tutorial__faq">
          <summary>
            <span>{item.title}</span>
            <span className="tutorial__faq-arrow">›</span>
          </summary>
          <div className="tutorial__faq-body">
            <strong>{methodLabel}：</strong>
            {item.method}
            <br />
            <strong>{interpretationLabel}：</strong>
            {item.interpretation}
          </div>
        </details>
      ))}
    </div>
  );
}

export function RnaSeqTutorial({ onClose }: { onClose: () => void }) {
  const { language } = useLanguage();
  if (language === "en") return <EnglishRnaSeqTutorial onClose={onClose} />;
  const go = (id: string) => {
    const el = document.getElementById(`rtut-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="tutorial">
      <div className="tutorial__header">
        <div>
          <div className="tutorial__title">RNA-seq 分析使用教程</div>
          <div className="tutorial__subtitle">导入 → 分组 → DEG → 绘图导出</div>
        </div>
        <button
          type="button"
          className="tutorial__close"
          onClick={onClose}
          aria-label="关闭"
        >
          <IconX size={14} stroke={2} />
        </button>
      </div>
      <div className="tutorial__body">
        <nav className="tutorial__nav">
          <div className="tutorial__nav-title">目录</div>
          <ul>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="tutorial__nav-item"
                  onClick={() => go(s.id)}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
          <div className="tutorial__nav-tip">
            完整方法学说明见输出的 Analysis_Report.md
          </div>
        </nav>
        <div className="tutorial__content">
          <section id="rtut-intro" className="tutorial__section">
            <h2 className="tutorial__h2">📖 简介</h2>
            <p className="tutorial__subtitle-inline">RNA-seq 差异表达分析与绘图流水线</p>
            <p>
              本工具完成从<strong>基因计数矩阵</strong>到<strong>分析图表</strong>
              的全流程:数据导入与规范化、 分组比较的实验设计、DEG 差异分析,以及 14
              类图表(热图 / PCA / 火山图 / 富集分析等)的参数化导出。
            </p>
            <div className="tutorial__callout tutorial__callout--info">
              统计计算由本机 <code>R</code> 引擎完成。每次运行都会写出
              <code>session_info.txt</code>，记录 R 与 Bioconductor
              包的精确版本，便于复现。
            </div>
          </section>

          <section id="rtut-prep" className="tutorial__section">
            <h2 className="tutorial__h2">🧰 准备工作</h2>
            <p className="tutorial__subtitle-inline">安装 R 与依赖包</p>
            <ol>
              <li>
                安装 <strong>R ≥ 4.0</strong>(<code>https://cloud.r-project.org</code>
                ),加入 PATH 或装在 <code>C:\Program Files\R\</code>(会自动扫描)。
              </li>
              <li>
                首次运行会检测缺失的 R/Bioconductor 包，并在确认后自动安装(需要联网)。
              </li>
              <li>首次运行会检测 R 与所需依赖；缺失时确认后即可自动安装。</li>
            </ol>
            <div className="tutorial__callout tutorial__callout--warn">
              数据应为<strong>原始或 estimated read counts</strong>(基因 ×
              样本矩阵)。TPM/FPKM/已取对数的矩阵不适用于 DESeq2/edgeR。
            </div>
            <p className="tutorial__subtitle-inline">主要 R 包</p>
            <p>
              差异分析使用 <code>DESeq2</code>、<code>edgeR</code>；变换与热图使用
              <code>ComplexHeatmap</code>、<code>circlize</code>、<code>pheatmap</code>；
              作图使用 <code>ggplot2</code>、<code>ggrepel</code>、<code>ggsci</code>、
              <code>paletteer</code>；富集分析使用 <code>clusterProfiler</code>
              ；结果写入使用
              <code>openxlsx</code>。具体版本以输出目录的 <code>session_info.txt</code>{" "}
              为准。
            </p>
          </section>

          <section id="rtut-flow" className="tutorial__section">
            <h2 className="tutorial__h2">🚀 三步流程</h2>
            <p className="tutorial__subtitle-inline">导入 → 差异分析 → 绘图导出</p>
            <p>
              <strong>1. 数据导入:</strong>选择 CSV/TSV/TXT/XLSX
              计数文件(支持拖拽)。自动规范为标准矩阵: featureCounts 预设丢弃注释列、HTSeq
              预设过滤 <code>__no_feature</code>、重复基因名按计数求和合并。
            </p>
            <p>
              <strong>2. 差异分析:</strong>
              把样本从「样本池」拖入分组(或按前缀自动分组),勾选「纳入」, 设置 Treatment vs
              Control 比较,然后运行 DEG。当前简化工作流固定使用 <code>~ condition</code>
              单因素设计。
            </p>
            <p>
              <strong>3. 绘图导出:</strong>
              左侧选择图类型,右侧调参数;「快速预览」用于检查布局,正式导出默认使用 300
              dpi；「导出全部图表」按当前选择批量生成。
            </p>
            <div className="tutorial__callout tutorial__callout--tip">
              已跑过 DEG 的历史目录可以直接在「分析结果来源」处加载(自动还原 params.json
              配置),跳过重跑直接绘图。
            </div>
          </section>

          <section id="rtut-methods" className="tutorial__section">
            <h2 className="tutorial__h2">🧪 统计方法</h2>
            <p className="tutorial__subtitle-inline">引擎选择与阈值</p>
            <details className="tutorial__faq" open>
              <summary>
                <span>从原始 counts 到 DEG 的完整统计流程</span>
                <span className="tutorial__faq-arrow">›</span>
              </summary>
              <div className="tutorial__faq-body">
                <ol>
                  <li>
                    <strong>输入与基因 ID：</strong>使用非负原始或 estimated
                    counts。检测到小数时，软件会四舍五入为整数并在日志及 Analysis_Meta
                    中记录；TPM、FPKM 与 log
                    转换数据不能作为计数模型输入。空基因名会删除，重复基因符号按各样本原始
                    counts 求和合并。
                  </li>
                  <li>
                    <strong>统一低表达过滤：</strong>默认保留在至少 2 个样本中达到至少 10
                    counts
                    的基因；样本总数少于该值时使用可用样本数。该过滤在建模前完成，以减少低信息基因带来的多重检验负担。标志基因和功能簇基因可为后续确认性可视化保留。
                  </li>
                  <li>
                    <strong>实验设计：</strong>本功能固定使用 <code>~ condition</code>{" "}
                    单因素设计。每个样本只需分配到一个生物学组，并明确 Treatment 相对于
                    Control 的比较方向。
                  </li>
                  <li>
                    <strong>重复比较：</strong>
                    每一个比较独立选择方法。具有生物学重复的比较默认采用
                    DESeq2：负二项广义线性模型、median-of-ratios size factors 与 Wald
                    检验；可手动选择 edgeR QL F-test，使用 TMM、稳健离散度估计和
                    quasi-likelihood F 检验。
                  </li>
                  <li>
                    <strong>两组各 1 个样本：</strong>采用 edgeR 的 TMM 归一化和固定 BCV
                    的 exactTest。BCV 默认 0.4，适合人类生物学重复变异的保守假设；0.1 与
                    0.01
                    分别只适用于高度同质或技术重复情形。该分支不能估计组内离散度，结果为探索性候选证据而非确认性结论。
                  </li>
                  <li>
                    <strong>效应量、显著性与校正：</strong>DESeq2 报告未收缩
                    log2FC，并在可用时额外提供 ashr 收缩效应量（否则 normal prior
                    回退）供展示；DEG 判定始终使用未收缩 log2FC。edgeR 结果使用 TMM 归一化
                    CPM 的均值作为 baseMean 对应量。P 值使用 Benjamini–Hochberg 法校正。
                  </li>
                  <li>
                    <strong>默认 DEG 规则：</strong>FDR &lt; 0.05、|log2FC| &gt; 1.5 且
                    baseMean 高于设置下限（默认 0）。更改阈值会重建图表的 up/down
                    标签；若改变了实验设计、输入或比较，应完整重跑 DEG。
                  </li>
                  <li>
                    <strong>可复现性：</strong>
                    每次运行导出原始结果、参数、归一化矩阵、分析元数据、RDS
                    缓存、Analysis_Report.md 及 session_info.txt。Methods
                    中应报告软件版本、参考基因组/定量流程、过滤规则、设计公式、比较方向、FDR、效应量阈值与富集背景。
                  </li>
                </ol>
              </div>
            </details>
            <div className="tutorial__table-wrap">
              <table className="tutorial__table">
                <thead>
                  <tr>
                    <th>场景</th>
                    <th>引擎</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>非 1 对 1 比较(默认)</td>
                    <td>
                      <code>DESeq2</code>
                    </td>
                    <td>Wald 检验 + VST + lfcShrink(ashr)</td>
                  </tr>
                  <tr>
                    <td>两组各 1 个样本</td>
                    <td>
                      <code>edgeR</code>
                    </td>
                    <td>固定 BCV + exactTest（候选线索）</td>
                  </tr>
                  <tr>
                    <td>手动指定</td>
                    <td>
                      <code>edger_qlf</code>
                    </td>
                    <td>QL F-test,稳健离散度估计</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              差异判定阈值:调整后 p 值(FDR)&lt; 0.05 且 |log2FC| &gt;
              1.5(可在「分析参数」调整); 火山图标注数、p 值下限等只影响展示。
            </p>
            <p className="tutorial__subtitle-inline">可直接放入 Methods 的中文段落</p>
            <pre className="tutorial__code">{`RNA-seq 原始基因计数矩阵在 MyNX 中进行差异表达分析。重复基因符号按原始计数求和合并，并保留至少在 2 个样本中达到 10 counts 的基因。对于具有生物学重复的比较，采用 DESeq2（median-of-ratios size-factor normalization，Wald test）；变换表达值用于 PCA、样本 QC 和热图，DESeq2 的 lfcShrink（优先 ashr，必要时回退 normal）仅作为效应量参考，差异判定使用未收缩 log2 fold change。对于两组均仅含 1 个样本的 1 对 1 比较，采用 edgeR TMM normalization 和固定 BCV=0.4 的 exactTest，该结果仅作为探索性候选证据。多重检验采用 Benjamini–Hochberg 方法；差异基因定义为 FDR < 0.05 且 |log2FC| > 1.5。图形以 300 dpi PNG/PDF 导出，完整参数和软件版本记录于 Analysis_Metadata.csv 与 session_info.txt。`}</pre>
            <p className="tutorial__subtitle-inline">Methods-ready English paragraph</p>
            <pre className="tutorial__code">{`Raw gene-count matrices were analyzed in MyNX. Duplicate gene symbols were collapsed by summing raw counts, and genes were retained when they reached at least 10 counts in at least two samples. Comparisons with biological replicates were analyzed with DESeq2 using median-of-ratios size-factor normalization and the Wald test. Transformed expression values were used for PCA, sample QC, and heatmaps; DESeq2 lfcShrink (ashr when available, with a normal-prior fallback) was reported as an effect-size reference, while regulation was classified using the unshrunken log2 fold change. For 1-vs-1 comparisons in which both groups contained one sample, edgeR TMM normalization and a fixed BCV of 0.4 were used with exactTest; these results are exploratory candidate evidence only. P values were adjusted with the Benjamini–Hochberg procedure, and genes with FDR < 0.05 and |log2FC| > 1.5 were considered differentially expressed. Figures were exported as 300-dpi PNG/PDF files, with complete parameters and software versions recorded in Analysis_Metadata.csv and session_info.txt.`}</pre>
            <div className="tutorial__callout tutorial__callout--warn">
              单重复模式的 p 值为<strong>近似值</strong>,检验语义与 Wald/QLF
              不同,两种模式结果不可直接对比; 发表前需以 qPCR 或生物学重复(≥3)验证。BCV
              参考值:人源 0.4 / 同基因型 0.1 / 技术重复 0.01。
            </div>
          </section>

          <section id="rtut-figures" className="tutorial__section">
            <h2 className="tutorial__h2">📊 图表方法</h2>
            <p className="tutorial__subtitle-inline">每个图的输入、计算与解读边界</p>
            <p>
              以下说明与当前软件实现一致。除非另有说明，图形展示使用归一化或变换后的表达值；图形本身不增加额外的假设检验。
            </p>
            <FigureMethods
              items={FIGURE_METHODS_ZH}
              methodLabel="方法"
              interpretationLabel="解读"
            />
          </section>

          <section id="rtut-output" className="tutorial__section">
            <h2 className="tutorial__h2">📦 结果解读</h2>
            <p className="tutorial__subtitle-inline">输出目录内容</p>
            <ul>
              <li>
                <code>RNAseq_Analysis_Results.xlsx</code> — 总表:Normalized_Matrix /
                Candidate_Genes / 每比较 All 与 DEGs / Analysis_Meta(参数记录)
              </li>
              <li>
                <code>&lt;Comp&gt;_DEGs.csv</code> — 每个比较的差异基因列表
              </li>
              <li>
                <code>plots/</code> — 全部图表(PNG 300dpi / SVG / PDF 可选)
              </li>
              <li>
                <code>Analysis_Report.md</code> — 自动生成的方法学描述(可直接用于论文
                Methods)
              </li>
              <li>
                <code>sample_correlation.*</code> / <code>sample_distance.*</code> —
                样本相关性与距离 QC 热图
              </li>
              <li>
                <code>session_info.txt</code> — R 与全部已加载 R 包的版本信息
              </li>
              <li>
                <code>params.json</code> — 本次全部参数(可用于复现/还原配置)
              </li>
            </ul>
          </section>

          <section id="rtut-faq" className="tutorial__section">
            <h2 className="tutorial__h2">❓ 常见问题</h2>
            <details className="tutorial__faq">
              <summary>
                <span>提示「未找到 Rscript」?</span>
                <span className="tutorial__faq-arrow">›</span>
              </summary>
              <div className="tutorial__faq-body">
                安装 R 后点右上角红色标签重新检测。标准安装位置(
                <code>C:\Program Files\R\R-x.x.x\bin</code>)会自动扫描, 自定义位置请把
                Rscript 加入 PATH 环境变量。
              </div>
            </details>
            <details className="tutorial__faq">
              <summary>
                <span>分析失败,日志里有 Error?</span>
                <span className="tutorial__faq-arrow">›</span>
              </summary>
              <div className="tutorial__faq-body">
                最常见是 R 包缺失(首次运行会自动安装,失败时手动在 R 中执行
                <code>
                  BiocManager::install(c('DESeq2','edgeR','ComplexHeatmap','clusterProfiler'))
                </code>
                ); 其次是数据问题(样本列非数值、组内无样本、输入 TPM/FPKM/log
                矩阵)。日志面板可一键复制错误信息。
              </div>
            </details>
            <details className="tutorial__faq">
              <summary>
                <span>图能预览但想改尺寸?</span>
                <span className="tutorial__faq-arrow">›</span>
              </summary>
              <div className="tutorial__faq-body">
                「期刊尺寸」提供 Nature/Science/Cell
                单双栏预设,一键应用到全部图;也可在每类图的「尺寸」折叠面板单独调整,
                或切全局「尺寸=手动」。
              </div>
            </details>
            <div className="tutorial__footer">
              <button
                type="button"
                className="btn btn-primary tutorial__done"
                onClick={onClose}
              >
                开始使用
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function EnglishRnaSeqTutorial({ onClose }: { onClose: () => void }) {
  const sections = [
    ["intro", "📖 Overview"],
    ["prep", "🧰 Preparation"],
    ["flow", "🚀 Workflow"],
    ["methods", "🧪 Statistics"],
    ["figures", "📊 Figure methods"],
    ["output", "📦 Outputs"],
    ["faq", "❓ FAQ"],
  ];
  const go = (id: string) =>
    document
      .getElementById(`rtut-en-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div className="tutorial">
      <div className="tutorial__header">
        <div>
          <div className="tutorial__title">RNA-seq analysis guide</div>
          <div className="tutorial__subtitle">Import → groups → DEG → plot export</div>
        </div>
        <button
          type="button"
          className="tutorial__close"
          onClick={onClose}
          aria-label="Close"
        >
          <IconX size={14} stroke={2} />
        </button>
      </div>
      <div className="tutorial__body">
        <nav className="tutorial__nav">
          <div className="tutorial__nav-title">Contents</div>
          <ul>
            {sections.map(([id, title]) => (
              <li key={id}>
                <button
                  type="button"
                  className="tutorial__nav-item"
                  onClick={() => go(id)}
                >
                  {title}
                </button>
              </li>
            ))}
          </ul>
          <div className="tutorial__nav-tip">
            A methods summary is exported as Analysis_Report.md.
          </div>
        </nav>
        <div className="tutorial__content">
          <section id="rtut-en-intro" className="tutorial__section">
            <h2 className="tutorial__h2">📖 Overview</h2>
            <p className="tutorial__subtitle-inline">
              Differential expression and result plotting
            </p>
            <p>
              Start with a gene-count matrix, configure groups and comparisons, run DEG
              analysis, then export heatmaps, PCA, volcano plots, enrichment plots, and
              other figures.
            </p>
            <div className="tutorial__callout tutorial__callout--info">
              Computations run through a local R engine. Each run writes{" "}
              <code>session_info.txt</code> with the exact R and Bioconductor package
              versions for reproducibility.
            </div>
          </section>
          <section id="rtut-en-prep" className="tutorial__section">
            <h2 className="tutorial__h2">🧰 Preparation</h2>
            <p className="tutorial__subtitle-inline">R, packages, and raw counts</p>
            <ol>
              <li>
                Install <strong>R 4.0 or later</strong> from{" "}
                <code>https://cloud.r-project.org</code>, or approve the in-app
                installation when prompted.
              </li>
              <li>
                Missing R/Bioconductor packages are detected before analysis and installed
                only after confirmation.
              </li>
              <li>
                Use a non-negative raw or estimated-count matrix. Fractional counts are
                rounded and recorded in <code>Analysis_Meta</code>; TPM, FPKM, and
                log-transformed data are not valid inputs for DESeq2 or edgeR.
              </li>
            </ol>
            <p className="tutorial__subtitle-inline">Main R packages</p>
            <p>
              Differential analysis uses <code>DESeq2</code> and <code>edgeR</code>;
              transformations and heatmaps use <code>ComplexHeatmap</code>,{" "}
              <code>circlize</code>, and <code>pheatmap</code>; figures use{" "}
              <code>ggplot2</code>, <code>ggrepel</code>, <code>ggsci</code>, and{" "}
              <code>paletteer</code>; enrichment uses <code>clusterProfiler</code>;
              workbooks use <code>openxlsx</code>. Exact versions are listed in{" "}
              <code>session_info.txt</code>.
            </p>
          </section>
          <section id="rtut-en-flow" className="tutorial__section">
            <h2 className="tutorial__h2">🚀 Workflow</h2>
            <p>
              <strong>1. Import:</strong> choose a CSV, TSV, TXT, or XLSX counts file.
              Format presets clean featureCounts or HTSeq input automatically.
            </p>
            <p>
              <strong>2. Differential analysis:</strong> assign samples to groups, include
              the required groups, set Treatment vs Control comparisons, and run DEG. This
              streamlined workflow uses a single-factor <code>~ condition</code> design.
            </p>
            <p>
              <strong>3. Plot export:</strong> choose a chart type, adjust its scope and
              styling, use Quick preview, then export one chart or all selected chart
              types at 300 dpi.
            </p>
          </section>
          <section id="rtut-en-methods" className="tutorial__section">
            <h2 className="tutorial__h2">🧪 Statistics</h2>
            <div className="tutorial__table-wrap">
              <table className="tutorial__table">
                <thead>
                  <tr>
                    <th>Scenario</th>
                    <th>Engine</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Replicated comparison</td>
                    <td>
                      <code>DESeq2</code>
                    </td>
                    <td>
                      Median-of-ratios, Wald test, VST, lfcShrink for effect-size
                      reference
                    </td>
                  </tr>
                  <tr>
                    <td>One sample in each group</td>
                    <td>
                      <code>edgeR</code>
                    </td>
                    <td>
                      TMM, fixed BCV = 0.4, exactTest; exploratory candidate evidence only
                    </td>
                  </tr>
                  <tr>
                    <td>Manual replicated-data option</td>
                    <td>
                      <code>edger_qlf</code>
                    </td>
                    <td>QL F-test with robust dispersion estimation</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="tutorial__subtitle-inline">Methods-ready English paragraph</p>
            <pre className="tutorial__code">{`Raw gene-count matrices were analyzed in MyNX. Duplicate gene symbols were collapsed by summing raw counts, and genes were retained when they reached at least 10 counts in at least two samples. Comparisons with biological replicates were analyzed with DESeq2 using median-of-ratios size-factor normalization and the Wald test. Transformed expression values were used for PCA, sample QC, and heatmaps; DESeq2 lfcShrink (ashr when available, with a normal-prior fallback) was reported as an effect-size reference, while regulation was classified using the unshrunken log2 fold change. For 1-vs-1 comparisons in which both groups contained one sample, edgeR TMM normalization and a fixed BCV of 0.4 were used with exactTest; these results are exploratory candidate evidence only. P values were adjusted with the Benjamini–Hochberg procedure, and genes with FDR < 0.05 and |log2FC| > 1.5 were considered differentially expressed. Figures were exported as 300-dpi PNG/PDF files, with complete parameters and software versions recorded in Analysis_Metadata.csv and session_info.txt.`}</pre>
            <div className="tutorial__callout tutorial__callout--warn">
              Fixed-BCV 1-vs-1 results are approximate. Confirm key findings with
              biological replicates or independent experiments.
            </div>
          </section>
          <section id="rtut-en-figures" className="tutorial__section">
            <h2 className="tutorial__h2">📊 Figure methods</h2>
            <p className="tutorial__subtitle-inline">
              Inputs, calculations, and interpretation limits for every output
            </p>
            <details className="tutorial__faq" open>
              <summary>
                <span>Complete statistical workflow</span>
                <span className="tutorial__faq-arrow">›</span>
              </summary>
              <div className="tutorial__faq-body">
                <ol>
                  <li>
                    <strong>Input and identifiers:</strong> use non-negative raw or
                    estimated counts. Fractional values are rounded before model fitting
                    and the number rounded is recorded in <code>Analysis_Meta</code>; TPM,
                    FPKM, and log-transformed data are invalid. Empty gene names are
                    removed and duplicate symbols are collapsed by summing raw counts.
                  </li>
                  <li>
                    <strong>Pre-filtering:</strong> by default, genes must reach at least
                    10 counts in at least two samples; the required sample count is capped
                    by the available number of samples. This occurs before model fitting
                    to reduce low-information multiple testing.
                  </li>
                  <li>
                    <strong>Design:</strong> this streamlined workflow uses a
                    single-factor <code>~ condition</code> design. Assign every sample to
                    one biological group and define Treatment relative to Control for
                    every contrast.
                  </li>
                  <li>
                    <strong>Per-contrast engine:</strong> replicated contrasts use DESeq2
                    by default (negative-binomial GLM, median-of-ratios size factors, Wald
                    test); edgeR QL F-test with robust dispersion is an advanced
                    replicated-data option. A 1-vs-1 contrast with one sample in each
                    group uses TMM and fixed-BCV exactTest as exploratory candidate
                    evidence only.
                  </li>
                  <li>
                    <strong>Effect size and FDR:</strong> regulation uses unshrunken
                    log2FC. DESeq2 may additionally report ashr-shrunken LFC (normal-prior
                    fallback) for effect-size reference. P values are adjusted by
                    Benjamini–Hochberg. The default rule is FDR &lt; 0.05 and |log2FC|
                    &gt; 1.5, with baseMean above the configured limit.
                  </li>
                  <li>
                    <strong>Reproducibility:</strong> the output folder records result
                    tables, normalized matrices, run parameters, model metadata, an
                    automatic methods report, and exact R/package versions. Report the
                    quantification source, filtering rule, design formula, comparison
                    direction, thresholds, and enrichment background in a manuscript.
                  </li>
                </ol>
              </div>
            </details>
            <p>
              Unless stated otherwise, figures use normalized or transformed expression
              values. A figure is descriptive and does not add a separate hypothesis test.
            </p>
            <FigureMethods
              items={FIGURE_METHODS_EN}
              methodLabel="Method"
              interpretationLabel="Interpretation"
            />
          </section>
          <section id="rtut-en-output" className="tutorial__section">
            <h2 className="tutorial__h2">📦 Outputs</h2>
            <ul>
              <li>
                <code>RNAseq_Analysis_Results.xlsx</code> — normalized matrix, candidate
                genes, and per-comparison results
              </li>
              <li>
                <code>&lt;Comparison&gt;_DEGs.csv</code> — differential-gene tables
              </li>
              <li>
                <code>plots/</code> — exported PNG, SVG, and/or PDF figures
              </li>
              <li>
                <code>Analysis_Report.md</code> — generated methods summary
              </li>
              <li>
                <code>Analysis_Metadata.csv</code> — thresholds, normalization, model, and
                filtering record
              </li>
              <li>
                <code>session_info.txt</code> — exact R and loaded-package versions
              </li>
              <li>
                <code>params.json</code> — reproducible run settings
              </li>
            </ul>
          </section>
          <section id="rtut-en-faq" className="tutorial__section">
            <h2 className="tutorial__h2">❓ FAQ</h2>
            <details className="tutorial__faq">
              <summary>
                <span>Rscript is not found</span>
                <span className="tutorial__faq-arrow">›</span>
              </summary>
              <div className="tutorial__faq-body">
                Click Run DEG analysis and confirm the in-app installation. Standard R
                folders are scanned automatically; add a custom location to PATH if
                detection still fails.
              </div>
            </details>
            <details className="tutorial__faq">
              <summary>
                <span>Analysis fails with an R error</span>
                <span className="tutorial__faq-arrow">›</span>
              </summary>
              <div className="tutorial__faq-body">
                Check the live log. Common causes are non-numeric sample columns, empty
                groups, or a TPM/FPKM/log-transformed matrix. Missing packages are
                detected and offered for installation before analysis.
              </div>
            </details>
            <details className="tutorial__faq">
              <summary>
                <span>I want to change a figure size</span>
                <span className="tutorial__faq-arrow">›</span>
              </summary>
              <div className="tutorial__faq-body">
                Use Journal size presets for all charts or open the Size section for a
                specific chart.
              </div>
            </details>
            <div className="tutorial__footer">
              <button
                type="button"
                className="btn btn-primary tutorial__done"
                onClick={onClose}
              >
                Start using Mynx
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
