/**
 * RNA-seq 帮助文档 — 介绍参考脚本方法论与三步流程。
 */
import { useState } from "react";
import { IconX } from "@tabler/icons-react";
import { useLanguage } from "@/lib/i18n";

type Section = { id: string; zh: string; en: string };

const SECTIONS: Section[] = [
  { id: "flow", zh: "流程概览", en: "Workflow" },
  { id: "methods", zh: "统计方法", en: "Statistical methods" },
  { id: "figures", zh: "输出图形", en: "Output figures" },
  { id: "files", zh: "结果文件", en: "Output files" },
  { id: "faq", zh: "常见问题", en: "FAQ" },
];

export function RnaSeqTutorial({ onClose }: { onClose: () => void }) {
  const { language } = useLanguage();
  const en = language === "en";
  const l = (zh: string, enStr: string) => (en ? enStr : zh);
  const [active, setActive] = useState(SECTIONS[0].id);

  const go = (id: string) => {
    setActive(id);
    document.getElementById(`rtut-${id}`)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="tutorial">
      <div className="tutorial__header">
        <div>
          <div className="tutorial__title">{l("RNA-seq 分析", "RNA-seq analysis")}</div>
          <div className="tutorial__subtitle">
            {l(
              "差异分析 + 热图/PCA/火山图 — 方法论与发表级 R 脚本逐行一致",
              "DE + heatmap/PCA/volcano — line-for-line faithful to the reference R script",
            )}
          </div>
        </div>
        <button type="button" className="tutorial__close" onClick={onClose}>
          <IconX size={16} stroke={1.75} />
        </button>
      </div>

      <div className="tutorial__body">
        <nav className="tutorial__nav">
          <div className="tutorial__nav-title">{l("目录", "Contents")}</div>
          <ul>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`tutorial__nav-item${active === s.id ? " active" : ""}`}
                  onClick={() => go(s.id)}
                >
                  {l(s.zh, s.en)}
                </button>
              </li>
            ))}
          </ul>
          <div className="tutorial__nav-tip">
            {l("引擎与输出布局完全由参考脚本决定", "The engine and output layout follow the reference script exactly")}
          </div>
        </nav>

        <div className="tutorial__content">
          <section id="rtut-flow" className="tutorial__section">
            <h2 className="tutorial__h2">{l("流程概览", "Workflow")}</h2>
            <p className="tutorial__subtitle-inline">
              {l("三步完成,每步的参数即参考脚本的配置项", "Three steps; every parameter maps to the reference script's config")}
            </p>
            <div className="tutorial__callout tutorial__callout--info">
              <strong>1. {l("数据导入", "Import")}</strong>
              <p>
                {l(
                  "选择原始整数 Counts 矩阵(csv/tsv/txt/xlsx)。可设置样本显示名(热图横轴、相关性图、PCA 标签使用)。",
                  "Pick a raw integer count matrix (csv/tsv/txt/xlsx). Optionally set sample display names (used on heatmaps, correlation and PCA).",
                )}
              </p>
              <strong>2. {l("分组与分析", "Design & DE")}</strong>
              <p>
                {l(
                  "把样本拖入分组 → 配置比较(case vs control)→ 运行。任一组只有 1 个样本时自动走无重复路径(edgeR exactTest + 固定 BCV);两组都有重复时用 DESeq2 或 edgeR QL 检验。",
                  "Assign samples to groups → configure comparisons (case vs control) → run. Singleton groups trigger the no-replicate path (edgeR exactTest with fixed BCV); otherwise DESeq2 or edgeR QL is used.",
                )}
              </p>
              <strong>3. {l("图形输出", "Plots")}</strong>
              <p>
                {l(
                  "配置整体热图(标记基因/聚类数)、选定基因热图(基因簇)、热图样式、PCA 与火山图,然后生成并在画廊查看。",
                  "Configure the overall heatmap (markers/clusters), the selected-gene heatmap (gene clusters), heatmap style, PCA and volcano — then generate and browse the gallery.",
                )}
              </p>
            </div>
          </section>

          <section id="rtut-methods" className="tutorial__section">
            <h2 className="tutorial__h2">{l("统计方法", "Statistical methods")}</h2>
            <p className="tutorial__subtitle-inline">
              {l("与参考脚本 rnaseq_DE_heatmap.R 完全一致", "Identical to the reference script rnaseq_DE_heatmap.R")}
            </p>
            <div className="tutorial__table-wrap">
              <table className="tutorial__table">
                <thead>
                  <tr>
                    <th>{l("场景", "Scenario")}</th>
                    <th>{l("方法", "Method")}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{l("有重复(每组 ≥2)", "Replicated (each group ≥2)")}</td>
                    <td>
                      {l(
                        "DESeq2 Wald 或 edgeR QL F 检验;低表达过滤默认 filterByExpr",
                        "DESeq2 Wald or edgeR QL F-test; default filterByExpr",
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td>{l("无重复(任一组 =1)", "No replicates (any group =1)")}</td>
                    <td>
                      {l(
                        "edgeR exactTest + 固定 BCV(人 0.4 / 同基因型 0.1 / 技术重复 0.01);P 值仅用于探索性排序",
                        "edgeR exactTest with fixed BCV (human 0.4 / isogenic 0.1 / technical 0.01); P values are exploratory",
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td>{l("Up/Down 判定", "Up/Down calls")}</td>
                    <td>
                      {l(
                        "padj < 阈值 且 log2FC ≥ +阈值 判 Up,≤ −阈值 判 Down,其余 NS;padj 为 NA 一律 NS",
                        "padj < cutoff and log2FC ≥ +cutoff → Up; ≤ −cutoff → Down; else NS; NA padj counts as NS",
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td>{l("热图/PCA 表达量", "Heatmap/PCA values")}</td>
                    <td>
                      {l(
                        "DESeq2 VST(blind=TRUE)或 edgeR log-CPM;热图默认按行 Z-score、±2 截断、红=高表达",
                        "DESeq2 VST (blind=TRUE) or edgeR log-CPM; heatmap defaults to row Z-score, ±2 clamp, red = high",
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td>{l("数据清洗", "Count cleaning")}</td>
                    <td>
                      {l(
                        "空基因名丢弃;重名基因按原始计数相加(sum)/留均值最大(max_mean)/改名(make_unique);取整 round/floor/ceiling",
                        "Empty gene names dropped; duplicates summed (sum) / max-mean kept (max_mean) / renamed (make_unique); rounding round/floor/ceiling",
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="rtut-figures" className="tutorial__section">
            <h2 className="tutorial__h2">{l("输出图形", "Output figures")}</h2>
            <ul>
              <li>
                <strong>heatmap_overall.png</strong> —{" "}
                {l(
                  "整体热图:表达基因(默认全部,按方差排序)+ 聚类色块(C1..Ck)+ 左侧标记基因连线;附带 Z-score 矩阵 csv",
                  "overall heatmap: expressed genes (default all, ranked by variance) + cluster colour bar (C1..Ck) + marker-gene links on the left; Z-score matrix exported as csv",
                )}
              </li>
              <li>
                <strong>sample_correlation_overall.png</strong> —{" "}
                {l("样本间 Pearson 相关性热图", "between-sample Pearson correlation heatmap")}
              </li>
              <li>
                <strong>heatmap_gene_clusters.png</strong> —{" "}
                {l(
                  "选定基因热图:按基因簇分块(Transcription / Melanogenesis / …),可控制是否聚类与簇名显示",
                  "selected-gene heatmap: split by gene clusters (Transcription / Melanogenesis / …), with clustering and cluster-name toggles",
                )}
              </li>
              <li>
                <strong>PCA_selected.png</strong> —{" "}
                {l(
                  "PCA:方差前 500 个基因,坐标轴以 0 为中心,附坐标与方差占比 csv",
                  "PCA on the top 500 variable genes, axes centred at 0; coordinates and variance csv included",
                )}
              </li>
              <li>
                <strong>volcano_&lt;比较&gt;.png</strong> —{" "}
                {l(
                  "火山图:横轴 log2FC、纵轴 −log10(padj),NPG 配色,标注最显著基因",
                  "volcano: log2FC vs −log10(padj), NPG colors, top genes labelled",
                )}
              </li>
            </ul>
          </section>

          <section id="rtut-files" className="tutorial__section">
            <h2 className="tutorial__h2">{l("结果文件", "Output files")}</h2>
            <pre className="tutorial__code">{`<输出根目录>/<运行名>/
├─ DE/      DE_<比较>.csv · DE_summary.csv
├─ heatmap/ heatmap_*.png · *_matrix.csv
├─ plots/   PCA_selected.png · volcano_*.png (+ 坐标/方差 csv)
├─ data/    counts_clean_integer.csv · sample_table.csv
├─ logs/    run.log · sessionInfo.txt · config_used.txt
└─ prepared/ params.json(可复现的完整参数)`}</pre>
            <div className="tutorial__callout tutorial__callout--tip">
              {l(
                "「加载结果」选择任意历史运行目录即可还原图形与配置;logs/config_used.txt 记录了本次运行的完整配置。",
                "Load any previous run directory to restore figures and config; logs/config_used.txt records the exact configuration used.",
              )}
            </div>
          </section>

          <section id="rtut-faq" className="tutorial__section">
            <h2 className="tutorial__h2">{l("常见问题", "FAQ")}</h2>
            <details className="tutorial__faq" open>
              <summary>{l("为什么单样本组的 P 值“不可信”?", "Why are P values for singleton groups unreliable?")}</summary>
              <div className="tutorial__faq-body">
                {l(
                  "没有重复就无法从数据估计生物学变异。无重复路径按 edgeR 用户指南 §2.10 固定 BCV,得到的 P 值只能用于探索性排序;正式结论需要生物学重复或 qPCR 验证。",
                  "Without replicates the biological variance cannot be estimated. The no-replicate path fixes the BCV (edgeR guide §2.10); P values are for exploratory ranking only. Confirm with biological replicates or qPCR.",
                )}
              </div>
            </details>
            <details className="tutorial__faq">
              <summary>{l("可以用 TPM/FPKM 吗?", "Can I use TPM/FPKM?")}</summary>
              <div className="tutorial__faq-body">
                {l(
                  "不能。DESeq2/edgeR 的计数模型要求原始整数 Counts;TPM/FPKM 会报错或给出错误结果。",
                  "No. The count models require raw integer counts; TPM/FPKM will error or give wrong results.",
                )}
              </div>
            </details>
            <details className="tutorial__faq">
              <summary>{l("重复基因名会怎么处理?", "How are duplicate gene names handled?")}</summary>
              <div className="tutorial__faq-body">
                {l(
                  "默认 sum:同名行原始计数相加(在取整之前)。也可在导入参数中选 max_mean(保留均值最大行)或 make_unique(改名保留)。",
                  "Default sum: duplicate rows' raw counts are added (before rounding). Also available: max_mean (keep the highest-mean row) and make_unique (rename and keep).",
                )}
              </div>
            </details>
          </section>

          <div className="tutorial__footer">
            <button type="button" className="btn btn-primary tutorial__done" onClick={onClose}>
              {l("开始使用", "Get started")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
