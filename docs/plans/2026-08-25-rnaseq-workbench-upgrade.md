# RNA-seq 科研工作台升级实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在保留单重复内部探索分析能力的前提下，增强 RNA-seq 的统计透明度、QC/富集输出与页面交互布局。

**Architecture:** 保持现有 React + TypeScript + Tauri + R runner 架构。前端增加面向实验设计和运行状态的信息层；R 端在现有 DEG、缓存、富集流程中增加单重复元数据、方向性富集输出和质量摘要，所有结果继续写入当前 run 目录。

**Tech Stack:** React 18, TypeScript, CSS variables, Tauri, R, edgeR, DESeq2, clusterProfiler, openxlsx。

---

### Task 1: 统计模式与配置契约

**Files:** `src/lib/rnaseq/types.ts`, `src/lib/rnaseq/defaults.ts`, `src-tauri/r/runner.R`

增加单重复模式、QC 汇总和元数据字段；保留单重复 edgeR 固定 BCV/TREAT，不增加阻断；R runner 写出模式、警告、过滤前后基因数、样本数和设计公式。

### Task 2: 上下调方向性富集

**Files:** `src-tauri/r/modules/enrich.R`, `src/lib/rnaseq/types.ts`

将 ORA 的上调和下调基因分别作为输入集合，使用同一 tested-gene universe，分别保存 Up/Down CSV，并在合并图中增加 Direction 字段和图例。

### Task 3: QC 与可复现性输出

**Files:** `src-tauri/r/runner.R`, `src/pages/rnaseq/PlotsStep.tsx`

输出 `QC_Summary.csv`、`Analysis_Metadata.csv` 和单重复 notice；在绘图页增加质量与方法摘要卡片。

### Task 4: RNA-seq 页面信息架构与交互

**Files:** `src/pages/rnaseq/RnaSeqPage.tsx`, `ImportStep.tsx`, `AnalysisStep.tsx`, `PlotsStep.tsx`, `src/styles/rnaseq.css`

增加顶部实验状态带，集中显示 Counts、样本、分组、比较和统计模式；优化步骤导航、运行状态、空状态、错误状态和按钮层级，不改动其它页面。

### Task 5: Verification

运行 `npx tsc --noEmit`、`npm run lint`、R parser 和 `npm run build`，并检查 git diff 只涉及 RNA-seq 与计划文档。
