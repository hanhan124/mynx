# Mynx RNA-seq 方法与可复现性说明

RNA-seq 子功能以用户提供的 `rnaseq_DE_heatmap.R` 为分析契约，并将可调整参数映射到界面。统计实现沿用 Bioconductor 的 DESeq2、edgeR 和 ComplexHeatmap；界面只收集配置，R 引擎负责计算和导出。

## 数据与设计约束

- 差异分析输入必须是每个样本的原始整数 gene-level counts。TPM、FPKM 和已经按库大小缩放的矩阵用于展示时可以另行导入，但不能作为 DESeq2/edgeR 的差异分析输入。
- 每个比较明确写出 `case` 与 `control`，log2FC 的方向为 case 相对 control。
- 每组至少两个生物学重复时使用 DESeq2 Wald 或 edgeR quasi-likelihood；任一组只有一个样本时使用固定 BCV 的 edgeR exploratory 路径，界面会持续显示警告。
- 低表达过滤默认使用 edgeR `filterByExpr`。它是独立过滤，避免把大量没有检测能力的基因带入模型。
- 批次是技术协变量，不是生物学分组。启用后使用 `~ batch + group`，若批次与分组完全混杂，模型会自动移除 batch 项并写入 `logs/run.log`。

## 图形与阈值

热图使用 VST 或 log-CPM；默认按行 Z-score 并对色阶截断，PCA 使用同一变换后的表达矩阵。火山图使用每个比较实际运行时的 padj 与 |log2FC| 阈值。QC、MA、MDS、样本距离、DEG 汇总和目标基因图是描述性输出，不会改变差异检验。

## 结果审计

每次运行都会保存：

- `prepared/params.json`：完整输入参数；
- `logs/config_used.txt`：R 端实际使用的配置；
- `logs/sessionInfo.txt`：R 与包版本；
- `logs/run.log`：过滤、模型选择、批次可估计性和警告；
- `data/counts_clean_integer.csv` 与 `data/sample_table.csv`：清洗后的矩阵和样本设计表。

建议在正式报告中同时提交原始 counts、样本设计表、参数文件、运行日志和 sessionInfo，并在解释单样本比较时明确其探索性性质。

参考：

- [DESeq2 vignette](https://bioconductor.org/packages/release/bioc/vignettes/DESeq2/inst/doc/DESeq2.html)
- [edgeR User's Guide](https://bioconductor.org/packages/release/bioc/vignettes/edgeR/inst/doc/edgeRUsersGuide.pdf)
- [filterByExpr reference](https://rdrr.io/bioc/edgeR/man/filterByExpr.html)
- [ComplexHeatmap reference book](https://jokergoo.github.io/ComplexHeatmap-reference/book/)
- [nf-core/rnaseq QC overview](https://nf-co.re/rnaseq/latest/docs/usage)
