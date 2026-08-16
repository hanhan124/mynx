/**
 * RNA-seq 使用教程 — 沿用 mynx 通用教程组件体系(tutorial__*)。
 */
import { IconX } from "@tabler/icons-react";

const SECTIONS = [
  { id: "intro", title: "📖 简介" },
  { id: "prep", title: "🧰 准备工作" },
  { id: "flow", title: "🚀 三步流程" },
  { id: "methods", title: "🧪 统计方法" },
  { id: "output", title: "📦 结果解读" },
  { id: "faq", title: "❓ 常见问题" },
];

export function RnaSeqTutorial({ onClose }: { onClose: () => void }) {
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
            <p className="tutorial__subtitle-inline">
              RNA-seq 差异表达分析与绘图流水线
            </p>
            <p>
              本工具完成从<strong>基因计数矩阵</strong>到<strong>分析图表</strong>
              的全流程:数据导入与规范化、 分组比较的实验设计、DEG 差异分析,以及 14
              类图表(热图 / PCA / 火山图 / 富集分析等)的参数化导出。
            </p>
            <div className="tutorial__callout tutorial__callout--info">
              统计计算由外部 <code>R</code> 引擎完成(DESeq2 / edgeR / clusterProfiler /
              ComplexHeatmap), 结果以 Excel 工作簿 + PNG/SVG/PDF 图表输出到本地目录。
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
              <li>首次运行会自动安装缺失的 R 包(需要联网,耗时数分钟至十几分钟)。</li>
              <li>
                页面右上角可查看 Rscript 状态;安装 R 后点击标签即可重新检测,无需重启。
              </li>
            </ol>
            <div className="tutorial__callout tutorial__callout--warn">
              数据需要是<strong>原始整数 read counts</strong>(基因 ×
              样本矩阵)。TPM/FPKM/已取对数的矩阵不适用于 DESeq2/edgeR。
            </div>
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
              Control 比较,然后运行 DEG。可选批次设置(<code>~ batch + condition</code>{" "}
              设计)。
            </p>
            <p>
              <strong>3. 绘图导出:</strong>
              左侧选择图类型,右侧调参数;「快速预览」低分辨率秒出效果, 「导出此图」按 300
              dpi 正式输出,「导出全部图表」顺序生成全部 14 类。
            </p>
            <div className="tutorial__callout tutorial__callout--tip">
              已跑过 DEG 的历史目录可以直接在「分析结果来源」处加载(自动还原 params.json
              配置),跳过重跑直接绘图。
            </div>
          </section>

          <section id="rtut-methods" className="tutorial__section">
            <h2 className="tutorial__h2">🧪 统计方法</h2>
            <p className="tutorial__subtitle-inline">引擎选择与阈值</p>
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
                    <td>各组 ≥ 2 重复(默认)</td>
                    <td>
                      <code>DESeq2</code>
                    </td>
                    <td>Wald 检验 + VST + lfcShrink(ashr)</td>
                  </tr>
                  <tr>
                    <td>任一组为单重复</td>
                    <td>
                      <code>edgeR</code>
                    </td>
                    <td>固定 BCV + TREAT(见下方提示)</td>
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
              1(可在「分析参数」调整); 火山图标注数、p 值下限等也会影响展示。
            </p>
            <div className="tutorial__callout tutorial__callout--warn">
              单重复模式的 p 值为<strong>近似值</strong>,检验语义与 Wald/QLF
              不同,两种模式结果不可直接对比; 发表前需以 qPCR 或生物学重复(≥3)验证。BCV
              参考值:人源 0.4 / 同基因型 0.1 / 技术重复 0.01。
            </div>
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
                <code>sample_correlation.*</code> — 样本相关性 QC 热图(组内 r &lt; 0.8
                会告警)
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
                );
                其次是数据问题(样本列非数值、组内无样本、批次与分组完全混淆)。日志面板可一键复制错误信息。
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
