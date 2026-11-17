export function qpcrAnalysisTemplate(language: "zh" | "en"): string {
  if (language === "zh") {
    return `# qPCR 实验与分析记录（MIQE 参考模板）

> 请按实验实际填写；Mynx 不会自动推断未提供的实验信息。本模板用于记录，不替代实验设计审查。

## 1. 实验概况
- 项目/实验名称：
- 实验日期：
- 操作者：
- 仪器型号与软件版本：
- 原始数据文件/工作表：
- 样本与分组说明：

## 2. 样本与实验设计
- 生物学重复数及其定义：
- 技术重复数：
- 样本处理、核酸提取方法：
- RNA/DNA 质量与定量方法：
- 反转录试剂、输入量及反应条件（如适用）：

## 3. 引物与检测体系
- 靶标/基因及引物序列（5′→3′）：
- 扩增子长度：
- 检测化学/探针信息：
- 扩增效率与标准曲线范围：
- 特异性验证（熔解曲线/电泳/测序）：
- 参考基因及稳定性依据：

## 4. 对照与质量控制
- 无模板对照（NTC）：
- 无反转录对照（如适用）：
- 阳性/阴性对照：
- 排除标准及排除样本/孔：
- 缺失 Ct 与黄色填补值的检查及处理说明：
- 偏差、异常曲线或重复间差异：

## 5. Mynx 分析设置
- Mynx 版本：
- 参考基因：
- 分析方法（2^-ΔCt / 2^-ΔΔCt）：
- 对照组：
- 重复数/最佳重复设置：
- 离群值设置：
- 转换表中的黄色填补单元格数：
- 运行日期与输出文件：

## 6. 结果与报告
- 归一化与统计方法：
- 多重检验校正方法（如适用）：
- 主要结果/图表文件：
- 统计结果文件：
- 结果解释与限制：
- 原始数据、分析文件及版本保存位置：
`;
  }

  return `# qPCR experiment and analysis record (MIQE reference template)

> Complete this from the experiment. Mynx does not infer information that was not provided. This record supports reporting; it does not replace experimental-design review.

## 1. Experiment overview
- Project / experiment:
- Date:
- Operator:
- Instrument model and software version:
- Raw data file / worksheet:
- Sample and group description:

## 2. Samples and design
- Number and definition of biological replicates:
- Number of technical replicates:
- Sample treatment and nucleic-acid extraction:
- RNA/DNA quality and quantification:
- Reverse-transcription reagents, input, and conditions (if applicable):

## 3. Primers and assay
- Target and primer sequences (5′→3′):
- Amplicon length:
- Detection chemistry / probe details:
- Amplification efficiency and standard-curve range:
- Specificity validation (melt curve / gel / sequencing):
- Reference gene and stability rationale:

## 4. Controls and quality control
- No-template control (NTC):
- No-RT control (if applicable):
- Positive / negative controls:
- Exclusion criteria and excluded samples/wells:
- Review and handling of missing Ct and yellow imputed values:
- Deviations, abnormal curves, or replicate variation:

## 5. Mynx analysis settings
- Mynx version:
- Reference gene:
- Analysis method (2^-ΔCt / 2^-ΔΔCt):
- Control group:
- Replicate / best-replicate setting:
- Outlier setting:
- Yellow imputed cells in transformed data:
- Run date and output files:

## 6. Results and reporting
- Normalization and statistical methods:
- Multiple-testing correction (if applicable):
- Main results / figure files:
- Statistics file:
- Interpretation and limitations:
- Location of archived raw data, analysis file, and version:
`;
}
