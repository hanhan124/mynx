/**
 * 步骤 3:图形输出 — 热图/样本相关性/选定基因热图/PCA/火山图。
 * 参数结构与参考脚本 CONFIG$heatmap / overall_heatmap / selected_heatmaps / plots 一致;
 * 生成逻辑完全由 R 引擎(rnaseq_engine.R)执行,本页只负责配置与展示。
 */
import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  IconPalette,
  IconPlayerPlay,
  IconPlayerStop,
  IconFolderOpen,
  IconPhoto,
  IconFlame,
  IconChartDots,
  IconChartHistogram,
  IconZoomIn,
  IconX,
  IconLayersIntersect,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { showToast } from "@/components/Toast";
import Modal from "@/components/Modal";
import { useRnaSeq } from "./store";
import {
  NumField,
  SelectField,
  SwitchField,
  TextField,
  CheckChips,
  Collapse,
} from "./fields";
import { openInShell } from "@/lib/rnaseq/io";
import { readImageDataURL } from "@/lib/rnaseq/results";
import { cleanGeneList } from "@/lib/rnaseq/defaults";
import { useLanguage } from "@/lib/i18n";
import type { AdditionalPlotsOptions } from "@/lib/rnaseq/types";
import { Button, TextInput } from "@mantine/core";

/** 连续色板(热图 Z-score / 相关性) */
const HEAT_PALETTES = [
  "RdBu",
  "RdYlBu",
  "PiYG",
  "PRGn",
  "BrBG",
  "PuOr",
  "RdGy",
  "Spectral",
  "viridis",
  "magma",
  "inferno",
  "plasma",
  "cividis",
  "rocket",
  "mako",
  "turbo",
];
/** 离散色板(分组 / 基因簇) */
const DISCRETE_PALETTES = ["Set2", "Dark2", "Set1", "Set3", "Paired", "Pastel1", "npg"];
const EXPORT_FORMATS = ["png", "pdf"];
const ADDITIONAL_BOOLEAN_KEYS = [
  "library_size",
  "expression_distribution",
  "sample_distance",
  "mds",
  "ma",
  "deg_summary",
  "deg_dotplot",
  "deg_matrix",
  "upset",
  "gene_expression",
] as const satisfies readonly (keyof AdditionalPlotsOptions)[];

export default function PlotsStep({ goAnalysis }: { goAnalysis: () => void }) {
  const { language } = useLanguage();
  const l = (zh: string, en: string) => (language === "en" ? en : zh);
  const st = useRnaSeq();
  const cfg = st.config;
  const running = st.runStatus === "running";

  const browseResult = async () => {
    const picked = await open({
      directory: true,
      multiple: false,
      title: l("选择引擎运行结果目录", "Select an engine run directory"),
    });
    if (!picked) return;
    const p = Array.isArray(picked) ? picked[0] : picked;
    await st.loadResultDir(p);
  };

  const runHeatmaps = async () => {
    if (!st.hasResult && !cfg.data_file) {
      goAnalysis();
      return;
    }
    await st.startRun(["heatmap"]);
  };
  const runPlots = async () => {
    if (!st.hasResult && !cfg.data_file) {
      goAnalysis();
      return;
    }
    if (!st.hasResult && cfg.plots.volcano.enabled)
      showToast(
        l(
          "尚未加载 DE 结果：PCA 仍可生成，火山图将在有对应结果时生成。",
          "No DE result is loaded: PCA can still run; volcano plots need DE results.",
        ),
        "info",
      );
    await st.startRun(["plots"]);
  };
  const runSelected = async () => {
    const selectedHeatmaps =
      cfg.overall_heatmap.enabled || cfg.selected_heatmaps.some((job) => job.enabled !== false);
    const selectedPlots =
      cfg.plots.pca.some((job) => job.enabled !== false) || cfg.plots.volcano.enabled;
    if (!selectedHeatmaps && !selectedPlots && !cfg.plots.additional.enabled) {
      showToast(
        l("请先选择至少一种输出图形。", "Select at least one figure to generate."),
        "info",
      );
      return;
    }
    if (!st.hasResult && !cfg.data_file) {
      goAnalysis();
      return;
    }
    if (!st.hasResult && cfg.plots.volcano.enabled)
      showToast(
        l(
          "当前没有 DE 结果：将继续生成可用图形，火山图会在对应结果存在时输出。",
          "No DE result is loaded: available figures will run; volcano plots require DE results.",
        ),
        "info",
      );
    const steps: string[] = [];
    if (selectedHeatmaps) steps.push("heatmap");
    if (selectedPlots || cfg.plots.additional.enabled) steps.push("plots");
    await st.startRun(steps);
  };

  const groupNames = Object.keys(cfg.groups);
  const comparisonNames = cfg.comparisons
    .map((comparison) => comparison.name)
    .filter(Boolean);
  const overallHeatmapEnabled = cfg.overall_heatmap.enabled;
  const selectedHeatmapsEnabled = cfg.selected_heatmaps.some((job) => job.enabled !== false);
  const pcaEnabled = cfg.plots.pca.some((job) => job.enabled !== false);
  const volcanoEnabled = cfg.plots.volcano.enabled;
  const anyHeatmapEnabled = overallHeatmapEnabled || selectedHeatmapsEnabled;
  const selectedFigureCount =
    Number(overallHeatmapEnabled) +
    Number(selectedHeatmapsEnabled) +
    Number(pcaEnabled) +
    Number(volcanoEnabled) +
    Number(cfg.plots.additional.enabled);
  const singletonGroups = Object.entries(cfg.groups)
    .filter(([, samples]) => samples.length < 2)
    .map(([name]) => name);

  return (
    <div className="rx-step">
      {/* ── 先选图,再配置参数 ── */}
      <section className="card rx-figure-picker">
        <div className="card-title">
          <IconChartDots size={15} stroke={1.75} />
          <span>{l("选择输出图形", "Choose figures")}</span>
          <span className="rx-title-actions">
            <span className="rx-tag" aria-live="polite">
              {selectedFigureCount} {l("类图形已选择", "figure groups selected")}
            </span>
          </span>
        </div>
        <div className="card-body">
          <p className="rx-source-desc">
            {l(
              "先勾选要生成的图形；只有已选择的图形才会显示参数。取消选择不会清空已填写的参数。",
              "Select the figures first. Parameters appear only for selected figures; clearing a selection keeps its settings.",
            )}
          </p>
          {singletonGroups.length > 0 && (
            <div className="rx-beta-note" role="status">
              <span className="rx-beta-note-text">
                {l(
                  `分组 ${singletonGroups.join("、")} 没有生物学重复。仍可继续生成图形；差异分析中的 P 值和 FDR 仅用于探索性排序。`,
                  `Group${singletonGroups.length > 1 ? "s" : ""} ${singletonGroups.join(", ")} has no biological replicates. Figures remain available; DE P values and FDR are exploratory.`,
                )}
              </span>
            </div>
          )}
          <div className="rx-figure-picker-grid">
            <SwitchField
              label={l("整体热图", "Overall heatmap")}
              checked={overallHeatmapEnabled}
              onChange={(v) =>
                st.updateConfig((d) => {
                  d.overall_heatmap.enabled = v;
                })
              }
              hint={l("按表达变异或 DEG 并集展示全局基因模式。", "Global expression patterns from variable genes or a DEG union.")}
            />
            <SwitchField
              label={l("选定基因热图", "Selected-gene heatmap")}
              checked={selectedHeatmapsEnabled}
              onChange={(v) =>
                st.updateConfig((d) => {
                  if (v && d.selected_heatmaps.length === 0) {
                    d.selected_heatmaps.push({
                      name: "gene_clusters",
                      title: l("选定基因", "Selected genes"),
                      gene_groups: null,
                      samples: null,
                      n_clusters: null,
                      options: {
                        cluster_rows: false,
                        cluster_columns: false,
                        show_row_dend: true,
                        show_column_dend: true,
                        border: false,
                        show_row_title: false,
                        width: 4.5,
                      },
                    });
                  }
                  d.selected_heatmaps.forEach((job) => {
                    job.enabled = v;
                  });
                })
              }
              hint={l("按预先定义的基因簇输出一张或多张热图。", "Plot one or more heatmaps from defined gene clusters.")}
            />
            <SwitchField
              label="PCA"
              checked={pcaEnabled}
              onChange={(v) =>
                st.updateConfig((d) => {
                  if (v && d.plots.pca.length === 0) {
                    d.plots.pca.push({
                      name: "PCA_selected",
                      samples: null,
                      ntop: 500,
                      pcs: [1, 2],
                      label_samples: true,
                      ellipse: false,
                      legend_pos: "right",
                      square_panel: true,
                      width_mm: 76,
                      height_mm: 62,
                    });
                  }
                  d.plots.pca.forEach((job) => {
                    job.enabled = v;
                  });
                })
              }
              hint={l("检查样本整体表达结构和组间分离。", "Inspect global sample structure and group separation.")}
            />
            <SwitchField
              label={l("火山图", "Volcano plots")}
              checked={volcanoEnabled}
              onChange={(v) =>
                st.updateConfig((d) => {
                  d.plots.volcano.enabled = v;
                })
              }
              hint={l("展示 log2FC 与校正后 P 值；需要对应 DE 结果。", "Show log2FC versus adjusted P; requires matching DE results.")}
            />
            <SwitchField
              label={l("QC 与描述性图", "QC & descriptive plots")}
              checked={cfg.plots.additional.enabled}
              onChange={(v) =>
                st.updateConfig((d) => {
                  d.plots.additional.enabled = v;
                })
              }
              hint={l("选择文库、表达分布、样本距离等质量控制输出。", "Select library, expression, sample-distance and other QC outputs.")}
            />
          </div>
        </div>
      </section>

      {/* ── 结果来源 ── */}
      <section className="card">
        <div className="card-title">
          <IconFlame size={15} stroke={1.75} />
          <span>{l("结果来源", "Result source")}</span>
          <span className="rx-title-actions">
            {st.hasResult ? (
              <span className="rx-tag rx-tag--ok">{l("已就绪", "ready")}</span>
            ) : (
              <span className="rx-tag rx-tag--err">{l("无结果", "no result")}</span>
            )}
          </span>
        </div>
        <div className="card-body">
          <p className="rx-source-desc">
            {l(
              "图形从运行结果目录读取(DE/、heatmap/、plots/及 QC/DEG 分类目录)。可重新生成,或加载历史结果目录。",
              "Figures are read from the run directory (DE/, heatmap/, plots/ and QC/DEG categories). Regenerate or load a previous run.",
            )}
          </p>
          <div className="rx-path-row">
            <TextInput
              size="sm"
              className="rx-path-input"
              value={st.resultDir}
              readOnly
              placeholder={l("尚未加载结果目录", "No result directory loaded")}
            />
            <Button type="button" variant="default" size="sm" onClick={() => void browseResult()}>
              {l("浏览", "Browse")}
            </Button>
            {st.hasResult && (
              <Button
                type="button"
                variant="default"
                size="sm"
                aria-label={l("打开结果目录", "Open result directory")}
                onClick={() => void openInShell(st.resultDir)}
              >
                <IconFolderOpen size={13} stroke={1.75} />
              </Button>
            )}
          </div>
          {!st.hasResult && (
            <Button type="button" variant="default" size="sm" onClick={goAnalysis}>
              {l("前往差异分析", "Go to DE analysis")}
            </Button>
          )}
        </div>
      </section>

      {/* ── 整体热图 ── */}
      {overallHeatmapEnabled && (
      <Collapse
        title={
          <>
            <IconPhoto size={15} stroke={1.75} className="rx-title-icon" />{" "}
            {l("整体热图", "Overall heatmap")}
          </>
        }
        subtitle={l(
          `基因来源:${cfg.overall_heatmap.gene_source === "variable" ? (cfg.overall_heatmap.top_n === "all" ? "全部表达基因(按方差排序)" : `方差前 ${cfg.overall_heatmap.top_n} 个`) : "差异基因并集"}`,
          `Source: ${cfg.overall_heatmap.gene_source === "variable" ? (cfg.overall_heatmap.top_n === "all" ? "all expressed genes" : `top ${cfg.overall_heatmap.top_n} by variance`) : "DEG union"}`,
        )}
        defaultOpen
      >
        <div className="card-body rx-param-grid">
          <SelectField
            label={l("基因来源", "Gene source")}
            value={cfg.overall_heatmap.gene_source}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.overall_heatmap.gene_source = v;
              })
            }
            options={[
              { value: "variable", label: l("高表达按方差", "variable") },
              {
                value: "deg",
                label: l("差异基因并集(需先跑 DE)", "DEG union (needs DE)"),
              },
            ]}
          />
          {cfg.overall_heatmap.gene_source === "variable" && (
            <>
              <TextField
                label={l(
                  "取前多少个基因(all = 全部)",
                  'top N genes ("all" = everything)',
                )}
                value={String(cfg.overall_heatmap.top_n)}
                onChange={(v) =>
                  st.updateConfig((d) => {
                    const s = v.trim();
                    d.overall_heatmap.top_n =
                      !s || s.toLowerCase() === "all"
                        ? "all"
                        : Math.max(1, Number(s) || 1);
                  })
                }
                placeholder="all"
              />
              <SwitchField
                label={l("先过滤低表达基因", "Filter low expression first")}
                checked={cfg.overall_heatmap.expressed_only}
                onChange={(v) =>
                  st.updateConfig((d) => {
                    d.overall_heatmap.expressed_only = v;
                  })
                }
              />
            </>
          )}
          {cfg.overall_heatmap.gene_source === "deg" && (
            <>
              <NumField
                label={l("最多画多少个基因", "max genes")}
                value={cfg.overall_heatmap.max_genes}
                step={100}
                min={1}
                onChange={(v) =>
                  st.updateConfig((d) => {
                    if (v !== undefined) d.overall_heatmap.max_genes = v;
                  })
                }
              />
              <div className="rx-field rx-field--wide">
                <span className="rx-field-label">
                  {l("纳入哪些比较（空 = 全部）", "Comparisons to include (empty = all)")}
                </span>
                <CheckChips
                  options={comparisonNames}
                  selected={cfg.overall_heatmap.comparisons ?? []}
                  onToggle={(name) =>
                    st.updateConfig((d) => {
                      const current = d.overall_heatmap.comparisons ?? [];
                      const next = current.includes(name)
                        ? current.filter((item) => item !== name)
                        : [...current, name];
                      d.overall_heatmap.comparisons = next.length ? next : null;
                    })
                  }
                  emptyTip={l(
                    "先在实验设计中添加比较。",
                    "Add comparisons in Design first.",
                  )}
                />
              </div>
            </>
          )}
          <NumField
            label={l("基因聚成几簇(0 = 不分簇)", "n_clusters (0 = none)")}
            value={cfg.overall_heatmap.n_clusters ?? 0}
            step={1}
            min={0}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.overall_heatmap.n_clusters = !v || v < 2 ? null : Math.round(v);
              })
            }
          />
          <SwitchField
            label={l("同时输出样本相关性热图", "Sample correlation heatmap")}
            checked={cfg.overall_heatmap.sample_correlation}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.overall_heatmap.sample_correlation = v;
              })
            }
          />
          <SelectField
            label={l("相关性热图色板", "Correlation palette")}
            value={cfg.overall_heatmap.correlation_palette}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.overall_heatmap.correlation_palette = v;
              })
            }
            options={HEAT_PALETTES.map((p) => ({ value: p, label: p }))}
          />
          <div className="rx-field rx-field--wide">
            <span className="rx-field-label">
              {l(
                "标记基因(整体热图左侧标出;每行一个)",
                "Marker genes (labelled on the left; one per line)",
              )}
            </span>
            <textarea
              className="rx-genes-textarea"
              rows={5}
              value={cfg.overall_heatmap.marker_genes.join("\n")}
              onChange={(e) =>
                st.updateConfig((d) => {
                  d.overall_heatmap.marker_genes = cleanGeneList(
                    e.target.value.split(/[\n,]/),
                  );
                })
              }
            />
            <span className="rx-field-hint">
              {l(
                "不在所选基因里的标记基因会自动加入热图",
                "Missing markers are added to the plotted set automatically",
              )}
            </span>
          </div>
        </div>
      </Collapse>
      )}

      {/* ── 选定基因热图 ── */}
      {selectedHeatmapsEnabled && (
      <Collapse
        title={
          <>
            <IconLayersIntersect size={15} stroke={1.75} className="rx-title-icon" />{" "}
            {l("选定基因热图(基因簇)", "Selected-gene heatmap (clusters)")}
          </>
        }
        subtitle={l(
          `${Object.keys(cfg.gene_clusters).length} 个簇 / ${Object.values(cfg.gene_clusters).flat().length} 个基因`,
          `${Object.keys(cfg.gene_clusters).length} clusters / ${Object.values(cfg.gene_clusters).flat().length} genes`,
        )}
        right={
          <button
            type="button"
            className="btn"
            onClick={() =>
              st.updateConfig((d) => {
                const i = d.selected_heatmaps.length + 1;
                d.selected_heatmaps.push({
                  name: `gene_set_${i}`,
                  title: l(`基因集 ${i}`, `Gene set ${i}`),
                  gene_groups: null,
                  samples: null,
                  n_clusters: null,
                  options: {
                    cluster_rows: false,
                    cluster_columns: false,
                    show_row_dend: true,
                    show_column_dend: true,
                    border: false,
                    show_row_title: false,
                    width: 4.5,
                  },
                });
              })
            }
          >
            <IconPlus size={13} stroke={1.75} /> {l("添加图", "Add figure")}
          </button>
        }
        defaultOpen
      >
        <div className="card-body">
          <GeneClustersEditor />
          {cfg.selected_heatmaps.map((job, ji) => (
            <div key={ji} className="rx-param-grid" style={{ marginTop: 10 }}>
              <TextField
                label={l("输出名称", "Output name")}
                value={job.name}
                onChange={(v) =>
                  st.updateConfig((d) => {
                    d.selected_heatmaps[ji].name =
                      v.replace(/[^A-Za-z0-9_.-]+/g, "_") || `gene_set_${ji + 1}`;
                  })
                }
                hint={l(
                  "只用于文件名，建议使用字母、数字、下划线或短横线。",
                  "Used for the file name; use letters, numbers, underscore or hyphen.",
                )}
              />
              <TextField
                label={l("图标题", "Title")}
                value={job.title}
                onChange={(v) =>
                  st.updateConfig((d) => {
                    d.selected_heatmaps[ji].title = v;
                  })
                }
              />
              <SwitchField
                label={l("启用此图", "Enabled")}
                checked={job.enabled !== false}
                onChange={(v) =>
                  st.updateConfig((d) => {
                    d.selected_heatmaps[ji].enabled = v;
                  })
                }
              />
              {cfg.selected_heatmaps.length > 1 && (
                <div className="rx-field" style={{ alignSelf: "end" }}>
                  <button
                    type="button"
                    className="btn rx-cancel-btn"
                    onClick={() =>
                      st.updateConfig((d) => {
                        d.selected_heatmaps.splice(ji, 1);
                      })
                    }
                  >
                    <IconTrash size={13} stroke={1.75} /> {l("删除此图", "Remove figure")}
                  </button>
                </div>
              )}
              <NumField
                label={l("画布宽度(英寸)", "Width (in)")}
                value={job.options.width ?? undefined}
                step={0.5}
                min={2}
                onChange={(v) =>
                  st.updateConfig((d) => {
                    d.selected_heatmaps[ji].options.width = v ?? null;
                  })
                }
              />
              <SwitchField
                label={l("簇内基因聚类", "Cluster rows within clusters")}
                checked={job.options.cluster_rows ?? false}
                onChange={(v) =>
                  st.updateConfig((d) => {
                    d.selected_heatmaps[ji].options.cluster_rows = v;
                  })
                }
              />
              <SwitchField
                label={l("样本列聚类", "Cluster columns")}
                checked={job.options.cluster_columns ?? false}
                onChange={(v) =>
                  st.updateConfig((d) => {
                    d.selected_heatmaps[ji].options.cluster_columns = v;
                  })
                }
              />
              <SwitchField
                label={l("显示聚类树线条", "Show dendrograms")}
                checked={job.options.show_row_dend ?? true}
                onChange={(v) =>
                  st.updateConfig((d) => {
                    d.selected_heatmaps[ji].options.show_row_dend = v;
                    d.selected_heatmaps[ji].options.show_column_dend = v;
                  })
                }
              />
              <SwitchField
                label={l("显示左侧簇名", "Show cluster names")}
                checked={job.options.show_row_title ?? true}
                onChange={(v) =>
                  st.updateConfig((d) => {
                    d.selected_heatmaps[ji].options.show_row_title = v;
                  })
                }
              />
              <div className="rx-field rx-field--wide">
                <span className="rx-field-label">
                  {l("画哪些组/样本(空 = 全部)", "Groups/samples to plot (empty = all)")}
                </span>
                <CheckChips
                  options={[...groupNames]}
                  selected={job.samples ?? []}
                  onToggle={(g) =>
                    st.updateConfig((d) => {
                      const cur = d.selected_heatmaps[ji].samples ?? [];
                      const next = cur.includes(g)
                        ? cur.filter((x) => x !== g)
                        : [...cur, g];
                      d.selected_heatmaps[ji].samples = next.length ? next : null;
                    })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </Collapse>
      )}

      {/* ── 热图样式 ── */}
      {anyHeatmapEnabled && (
      <Collapse
        title={
          <>
            <IconPalette size={15} stroke={1.75} className="rx-title-icon" />{" "}
            {l("热图样式", "Heatmap style")}
          </>
        }
        subtitle={l(
          `${cfg.heatmap.transform.toUpperCase()} · ${cfg.heatmap.scale === "row" ? "行 Z-score" : "原始值"} · ${cfg.heatmap.palette}`,
          `${cfg.heatmap.transform.toUpperCase()} · ${cfg.heatmap.scale === "row" ? "row Z-score" : "raw"} · ${cfg.heatmap.palette}`,
        )}
      >
        <div className="card-body rx-param-grid">
          <SelectField
            label={l("表达量变换", "Transform")}
            value={cfg.heatmap.transform}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.heatmap.transform = v;
              })
            }
            options={[
              { value: "vst", label: "VST (DESeq2)" },
              { value: "logcpm", label: "log-CPM (edgeR)" },
            ]}
          />
          <SelectField
            label={l("数据缩放", "Scale")}
            value={cfg.heatmap.scale}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.heatmap.scale = v;
              })
            }
            options={[
              { value: "row", label: l("按行 Z-score", "row Z-score") },
              { value: "none", label: l("不缩放", "none") },
            ]}
          />
          <SelectField
            label={l("连续色板", "Palette")}
            value={cfg.heatmap.palette}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.heatmap.palette = v;
              })
            }
            options={HEAT_PALETTES.map((p) => ({ value: p, label: p }))}
          />
          <SwitchField
            label={l("翻转色板(红=高表达)", "Reverse palette (red = high)")}
            checked={cfg.heatmap.reverse_palette}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.heatmap.reverse_palette = v;
              })
            }
          />
          <NumField
            label={l("Z-score 色阶范围 ±", "Z-score limits ±")}
            value={cfg.heatmap.zlim}
            step={0.5}
            min={0.5}
            onChange={(v) =>
              st.updateConfig((d) => {
                if (v !== undefined) d.heatmap.zlim = v;
              })
            }
          />
          <SelectField
            label={l("分组色板", "Group palette")}
            value={cfg.heatmap.group_palette}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.heatmap.group_palette = v;
              })
            }
            options={DISCRETE_PALETTES.map((p) => ({ value: p, label: p }))}
          />
          <SelectField
            label={l("基因簇色板", "Cluster palette")}
            value={cfg.heatmap.gene_group_palette}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.heatmap.gene_group_palette = v;
              })
            }
            options={DISCRETE_PALETTES.map((p) => ({ value: p, label: p }))}
          />
          <SelectField
            label={l("聚类方法", "Clustering method")}
            value={cfg.heatmap.cluster_method}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.heatmap.cluster_method = v;
              })
            }
            options={["ward.D2", "ward.D", "complete", "average", "single"].map((m) => ({
              value: m,
              label: m,
            }))}
          />
          <SelectField
            label={l("行距离", "Row distance")}
            value={cfg.heatmap.row_distance}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.heatmap.row_distance = v;
              })
            }
            options={["pearson", "spearman", "euclidean", "maximum", "manhattan"].map(
              (m) => ({ value: m, label: m }),
            )}
          />
          <SelectField
            label={l("列距离", "Column distance")}
            value={cfg.heatmap.column_distance}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.heatmap.column_distance = v;
              })
            }
            options={["euclidean", "pearson", "spearman", "maximum", "manhattan"].map(
              (m) => ({ value: m, label: m }),
            )}
          />
          <SwitchField
            label={l("聚类基因行", "Cluster gene rows")}
            checked={cfg.heatmap.cluster_rows}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.heatmap.cluster_rows = v;
              })
            }
          />
          <SwitchField
            label={l("聚类样本列", "Cluster sample columns")}
            checked={cfg.heatmap.cluster_columns}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.heatmap.cluster_columns = v;
              })
            }
          />
          <NumField
            label={l("样本名旋转角度", "Column names rotation")}
            value={cfg.heatmap.column_names_rot}
            step={45}
            min={0}
            max={90}
            onChange={(v) =>
              st.updateConfig((d) => {
                if (v !== undefined) d.heatmap.column_names_rot = v;
              })
            }
          />
          <SelectField
            label={l("样本名位置", "Column names side")}
            value={cfg.heatmap.column_names_side}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.heatmap.column_names_side = v;
              })
            }
            options={[
              { value: "top", label: l("顶部", "top") },
              { value: "bottom", label: l("底部", "bottom") },
            ]}
          />
          <NumField
            label={l("字号 (pt)", "Font size (pt)")}
            value={cfg.heatmap.font_size}
            step={1}
            min={4}
            onChange={(v) =>
              st.updateConfig((d) => {
                if (v !== undefined) d.heatmap.font_size = v;
              })
            }
          />
          <SwitchField
            label={l("基因名斜体", "Italic gene names")}
            checked={cfg.heatmap.row_names_italic}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.heatmap.row_names_italic = v;
              })
            }
          />
          <SwitchField
            label={l("显示基因行名", "Show gene names")}
            checked={cfg.heatmap.show_row_names !== false}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.heatmap.show_row_names = v;
              })
            }
          />
          <SwitchField
            label={l("显示样本列名", "Show sample names")}
            checked={cfg.heatmap.show_column_names}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.heatmap.show_column_names = v;
              })
            }
          />
          <SwitchField
            label={l("显示分组/批次名称", "Show annotation names")}
            checked={cfg.heatmap.show_annotation_name}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.heatmap.show_annotation_name = v;
              })
            }
          />
          <SwitchField
            label={l("显示批次注释条", "Show batch annotation")}
            checked={cfg.heatmap.show_batch}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.heatmap.show_batch = v;
              })
            }
          />
          <NumField
            label={l("热图 DPI", "Heatmap DPI")}
            value={cfg.heatmap.dpi}
            step={50}
            min={72}
            onChange={(v) =>
              st.updateConfig((d) => {
                if (v !== undefined) d.heatmap.dpi = v;
              })
            }
          />
        </div>
      </Collapse>
      )}

      {/* ── PCA ── */}
      {pcaEnabled && (
      <Collapse
        title={
          <>
            <IconChartDots size={15} stroke={1.75} className="rx-title-icon" />{" "}
            {l("PCA", "PCA")}
          </>
        }
        subtitle={l(
          `ntop=${cfg.plots.pca[0]?.ntop ?? 500} · PC${cfg.plots.pca[0]?.pcs?.[0] ?? 1}/PC${cfg.plots.pca[0]?.pcs?.[1] ?? 2}`,
          `ntop=${cfg.plots.pca[0]?.ntop ?? 500} · PC${cfg.plots.pca[0]?.pcs?.[0] ?? 1}/PC${cfg.plots.pca[0]?.pcs?.[1] ?? 2}`,
        )}
      >
        <div className="card-body rx-param-grid">
          <NumField
            label={l("方差最大的前 N 个基因", "Top N variable genes")}
            value={cfg.plots.pca[0]?.ntop ?? 500}
            step={50}
            min={10}
            onChange={(v) =>
              st.updateConfig((d) => {
                if (v !== undefined && d.plots.pca[0])
                  d.plots.pca[0].ntop = Math.round(v);
              })
            }
          />
          <NumField
            label={l("PC x 轴", "PC x-axis")}
            value={cfg.plots.pca[0]?.pcs?.[0] ?? 1}
            step={1}
            min={1}
            onChange={(v) =>
              st.updateConfig((d) => {
                if (v !== undefined && d.plots.pca[0])
                  d.plots.pca[0].pcs = [Math.round(v), d.plots.pca[0].pcs[1]];
              })
            }
          />
          <NumField
            label={l("PC y 轴", "PC y-axis")}
            value={cfg.plots.pca[0]?.pcs?.[1] ?? 2}
            step={1}
            min={1}
            onChange={(v) =>
              st.updateConfig((d) => {
                if (v !== undefined && d.plots.pca[0])
                  d.plots.pca[0].pcs = [d.plots.pca[0].pcs[0], Math.round(v)];
              })
            }
          />
          <SwitchField
            label={l("样本名标签", "Label samples")}
            checked={cfg.plots.pca[0]?.label_samples ?? true}
            onChange={(v) =>
              st.updateConfig((d) => {
                if (d.plots.pca[0]) d.plots.pca[0].label_samples = v;
              })
            }
          />
          <SwitchField
            label={l(
              "95% 置信椭圆(组内 ≥4 样本)",
              "95% ellipses (groups with ≥4 samples)",
            )}
            checked={cfg.plots.pca[0]?.ellipse ?? false}
            onChange={(v) =>
              st.updateConfig((d) => {
                if (d.plots.pca[0]) d.plots.pca[0].ellipse = v;
              })
            }
          />
          <SelectField
            label={l("图例位置", "Legend position")}
            value={cfg.plots.pca[0]?.legend_pos ?? "right"}
            onChange={(v) =>
              st.updateConfig((d) => {
                if (d.plots.pca[0]) d.plots.pca[0].legend_pos = v;
              })
            }
            options={[
              { value: "right", label: l("右侧", "right") },
              { value: "bottom", label: l("底部", "bottom") },
              { value: "top", label: l("顶部", "top") },
              { value: "none", label: l("隐藏", "none") },
            ]}
          />
          <NumField
            label={l("宽 (mm)", "Width (mm)")}
            value={cfg.plots.pca[0]?.width_mm ?? 76}
            step={5}
            min={40}
            onChange={(v) =>
              st.updateConfig((d) => {
                if (v !== undefined && d.plots.pca[0]) d.plots.pca[0].width_mm = v;
              })
            }
          />
          <NumField
            label={l("高 (mm)", "Height (mm)")}
            value={cfg.plots.pca[0]?.height_mm ?? 62}
            step={5}
            min={40}
            onChange={(v) =>
              st.updateConfig((d) => {
                if (v !== undefined && d.plots.pca[0]) d.plots.pca[0].height_mm = v;
              })
            }
          />
        </div>
      </Collapse>
      )}

      {/* ── 火山图 ── */}
      {volcanoEnabled && (
      <Collapse
        title={
          <>
            <IconChartHistogram size={15} stroke={1.75} className="rx-title-icon" />{" "}
            {l("火山图", "Volcano")}
          </>
        }
        subtitle={l(
          `标注最显著 ${cfg.plots.volcano.label_top} 个基因 · 阈值 padj<${cfg.de.padj}, |log2FC|≥${cfg.de.log2fc}`,
          `label top ${cfg.plots.volcano.label_top} genes · padj<${cfg.de.padj}, |log2FC|≥${cfg.de.log2fc}`,
        )}
      >
        <div className="card-body rx-param-grid">
          <NumField
            label={l("标注最显著的 N 个基因(0 = 不标)", "Label top N genes (0 = none)")}
            value={cfg.plots.volcano.label_top}
            step={1}
            min={0}
            onChange={(v) =>
              st.updateConfig((d) => {
                if (v !== undefined) d.plots.volcano.label_top = Math.round(v);
              })
            }
          />
          <NumField
            label={l("点大小", "Point size")}
            value={cfg.plots.volcano.point_size}
            step={0.1}
            min={0.1}
            onChange={(v) =>
              st.updateConfig((d) => {
                if (v !== undefined) d.plots.volcano.point_size = v;
              })
            }
          />
          <NumField
            label={l("宽 (mm)", "Width (mm)")}
            value={cfg.plots.volcano.width_mm}
            step={5}
            min={40}
            onChange={(v) =>
              st.updateConfig((d) => {
                if (v !== undefined) d.plots.volcano.width_mm = v;
              })
            }
          />
          <NumField
            label={l("高 (mm)", "Height (mm)")}
            value={cfg.plots.volcano.height_mm}
            step={5}
            min={40}
            onChange={(v) =>
              st.updateConfig((d) => {
                if (v !== undefined) d.plots.volcano.height_mm = v;
              })
            }
          />
          <SelectField
            label={l("图例位置", "Legend position")}
            value={cfg.plots.volcano.legend_pos}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.plots.volcano.legend_pos = v;
              })
            }
            options={[
              { value: "right", label: l("右侧", "right") },
              { value: "top", label: l("顶部", "top") },
              { value: "bottom", label: l("底部", "bottom") },
              { value: "none", label: l("隐藏", "none") },
            ]}
          />
          <SwitchField
            label={l("显示副标题(方法与阈值)", "Show subtitle (method & thresholds)")}
            checked={cfg.plots.volcano.show_subtitle}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.plots.volcano.show_subtitle = v;
              })
            }
          />
          <span className="rx-field-hint" style={{ alignSelf: "end" }}>
            {l(
              "Up/Down/NS 颜色使用 NPG 配色(红/蓝/灰),与参考脚本一致",
              "Up/Down/NS use NPG colors (red/blue/grey), matching the reference script",
            )}
          </span>
        </div>
      </Collapse>
      )}

      {/* ── 出版级导出与 QC ── */}
      <Collapse
        title={
          <>
            <IconChartHistogram size={15} stroke={1.75} className="rx-title-icon" />{" "}
            {l("导出与质量控制", "Export & quality control")}
          </>
        }
        subtitle={l(
          `${cfg.plots.formats.join(" + ").toUpperCase()} · ${cfg.plots.dpi} dpi · ${cfg.plots.additional.enabled ? "QC 开启" : "QC 关闭"}`,
          `${cfg.plots.formats.join(" + ").toUpperCase()} · ${cfg.plots.dpi} dpi · ${cfg.plots.additional.enabled ? "QC on" : "QC off"}`,
        )}
      >
        <div className="card-body rx-param-grid">
          <div className="rx-field rx-field--wide">
            <span className="rx-field-label">{l("导出格式", "Export formats")}</span>
            <CheckChips
              options={EXPORT_FORMATS}
              selected={cfg.plots.formats}
              onToggle={(format) =>
                st.updateConfig((d) => {
                  const current = d.plots.formats ?? ["png"];
                  const next = current.includes(format)
                    ? current.filter((item) => item !== format)
                    : [...current, format];
                  d.plots.formats = next.length ? next : ["png"];
                  d.heatmap.formats = [...d.plots.formats];
                })
              }
            />
            <span className="rx-field-hint">
              {l(
                "PNG 适合预览，PDF 适合矢量排版；至少保留一种格式。",
                "PNG is convenient for preview; PDF preserves vectors. Keep at least one format.",
              )}
            </span>
          </div>
          <NumField
            label={l("位图分辨率 (dpi)", "Raster resolution (dpi)")}
            value={cfg.plots.dpi}
            step={50}
            min={150}
            max={1200}
            onChange={(v) =>
              st.updateConfig((d) => {
                if (v !== undefined) d.plots.dpi = Math.round(v);
              })
            }
          />
          <TextField
            label={l("字体", "Font family")}
            value={cfg.plots.font_family}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.plots.font_family = v || "Arial";
              })
            }
            placeholder="Arial"
            hint={l(
              "出版图统一字体；需已安装在系统中。",
              "Font used by exported figures; it must be installed on the system.",
            )}
          />
          <NumField
            label={l("基础字号 (pt)", "Base font size (pt)")}
            value={cfg.plots.base_size}
            step={0.5}
            min={5}
            max={18}
            onChange={(v) =>
              st.updateConfig((d) => {
                if (v !== undefined) d.plots.base_size = v;
              })
            }
          />
          <SelectField
            label={l("分组配色", "Group palette")}
            value={cfg.plots.group_palette}
            onChange={(v) =>
              st.updateConfig((d) => {
                d.plots.group_palette = v;
              })
            }
            options={DISCRETE_PALETTES.map((p) => ({ value: p, label: p }))}
          />
          {cfg.plots.additional.enabled && (
            <>
              {ADDITIONAL_BOOLEAN_KEYS.map((key) => {
                const labels: Record<(typeof ADDITIONAL_BOOLEAN_KEYS)[number], string> = {
                  library_size: l("文库大小", "Library size"),
                  expression_distribution: l("表达分布", "Expression distribution"),
                  sample_distance: l("样本距离", "Sample distance"),
                  mds: "MDS",
                  ma: "MA",
                  deg_summary: l("DEG 汇总", "DEG summary"),
                  deg_dotplot: l("DEG 点图", "DEG dot plot"),
                  deg_matrix: l("比较矩阵", "DEG comparison matrix"),
                  upset: "UpSet",
                  gene_expression: l("目标基因表达", "Target gene expression"),
                };
                return (
                  <SwitchField
                    key={key}
                    label={labels[key]}
                    checked={Boolean(cfg.plots.additional[key])}
                    onChange={(v) =>
                      st.updateConfig((d) => {
                        d.plots.additional[key] = v;
                      })
                    }
                  />
                );
              })}
              <NumField
                label={l("DEG/点图前 N 个", "Top N genes for DEG plots")}
                value={cfg.plots.additional.top_n}
                step={1}
                min={1}
                onChange={(v) =>
                  st.updateConfig((d) => {
                    if (v !== undefined) d.plots.additional.top_n = Math.round(v);
                  })
                }
              />
              <NumField
                label={l("QC 图宽 (mm)", "QC width (mm)")}
                value={cfg.plots.additional.width_mm}
                step={5}
                min={50}
                onChange={(v) =>
                  st.updateConfig((d) => {
                    if (v !== undefined) d.plots.additional.width_mm = v;
                  })
                }
              />
              <NumField
                label={l("QC 图高 (mm)", "QC height (mm)")}
                value={cfg.plots.additional.height_mm}
                step={5}
                min={40}
                onChange={(v) =>
                  st.updateConfig((d) => {
                    if (v !== undefined) d.plots.additional.height_mm = v;
                  })
                }
              />
              <div className="rx-field rx-field--wide">
                <span className="rx-field-label">
                  {l("目标基因（每行一个）", "Target genes (one per line)")}
                </span>
                <textarea
                  className="rx-genes-textarea"
                  rows={3}
                  value={cfg.plots.additional.genes.join("\n")}
                  onChange={(e) =>
                    st.updateConfig((d) => {
                      d.plots.additional.genes = cleanGeneList(
                        e.target.value.split(/[\n,]/),
                      );
                    })
                  }
                />
              </div>
            </>
          )}
        </div>
      </Collapse>

      {/* ── 运行 ── */}
      <section className="card">
        <div className="card-body">
          <div className="rx-run-bar">
            <div className="rx-run-left">
              <button
                type="button"
                className="btn btn-primary rx-run-btn"
                disabled={running || selectedFigureCount === 0}
                onClick={() => void runSelected()}
              >
                <IconPlayerPlay size={14} stroke={1.75} />
                {l(
                  `生成已选图形（${selectedFigureCount} 类）`,
                  `Generate selected figures (${selectedFigureCount})`,
                )}
              </button>
              <button
                type="button"
                className="btn rx-run-btn"
                disabled={running || !anyHeatmapEnabled}
                onClick={() => void runHeatmaps()}
              >
                {l("仅生成热图", "Heatmaps only")}
              </button>
              <button
                type="button"
                className="btn rx-run-btn"
                disabled={running || (!pcaEnabled && !volcanoEnabled && !cfg.plots.additional.enabled)}
                onClick={() => void runPlots()}
              >
                {l("仅生成样本/差异图", "Sample / DE plots only")}
              </button>
              {running && (
                <button
                  type="button"
                  className="btn rx-cancel-btn"
                  onClick={() => void st.cancelRun()}
                >
                  <IconPlayerStop size={14} stroke={1.75} /> {l("取消", "Cancel")}
                </button>
              )}
              <span
                className={`rx-tag${running ? " rx-tag--run" : st.runStatus === "done" ? " rx-tag--ok" : st.runStatus === "failed" ? " rx-tag--err" : ""}`}
              >
                {running
                  ? l("生成中", "Running")
                  : st.runStatus === "done"
                    ? l("完成", "Done")
                    : st.runStatus === "failed"
                      ? l("失败", "Failed")
                      : l("待生成", "Idle")}
              </span>
              {running && <span className="rx-elapsed">{st.elapsedSec}s</span>}
            </div>
          </div>
        </div>
      </section>

      {/* ── 结果画廊 ── */}
      {st.resultImages.length > 0 && (
        <section className="card">
          <div className="card-title">
            <IconPhoto size={15} stroke={1.75} />
            <span>{l("输出图形", "Output figures")}</span>
            <span className="rx-title-actions">
              <span className="rx-tag">
                {st.resultImages.length} {l("个文件", "files")}
              </span>
            </span>
          </div>
          <div className="card-body">
            <Gallery />
          </div>
        </section>
      )}
    </div>
  );
}

/** 基因簇编辑器:簇名 = 基因列表 */
function GeneClustersEditor() {
  const { language } = useLanguage();
  const l = (zh: string, en: string) => (language === "en" ? en : zh);
  const st = useRnaSeq();
  const clusters = st.config.gene_clusters;
  const entries = Object.entries(clusters);

  const setClusters = (next: Record<string, string[]>) => {
    st.updateConfig((d) => {
      d.gene_clusters = next;
    });
  };

  return (
    <div className="rx-gene-clusters">
      {entries.map(([name, genes], i) => (
        <div key={name} className="rx-cluster-row">
          <input
            className="rx-cluster-name"
            value={name}
            onChange={(e) => {
              const nextName = e.target.value.trim();
              if (!nextName || entries.some(([k]) => k === nextName)) return;
              const next: Record<string, string[]> = {};
              for (const [k, v] of entries) next[k === name ? nextName : k] = v;
              setClusters(next);
            }}
          />
          <textarea
            className="rx-cluster-genes"
            rows={Math.min(4, Math.max(1, Math.ceil(genes.length / 6)))}
            value={genes.join(", ")}
            placeholder="RPE65, MITF, …"
            onChange={(e) => {
              const list = cleanGeneList(e.target.value.split(/[\n,]/));
              setClusters({ ...clusters, [name]: list });
            }}
          />
          <span className="rx-tag">{genes.length}</span>
          <button
            type="button"
            className="rx-icon-btn rx-icon-btn--danger"
            onClick={() => {
              const next = { ...clusters };
              delete next[name];
              setClusters(next);
            }}
          >
            <IconX size={12} stroke={2} />
          </button>
          {i === entries.length - 1 && null}
        </div>
      ))}
      <div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            let i = entries.length + 1;
            while (clusters[`Cluster${i}`]) i++;
            setClusters({ ...clusters, [`Cluster${i}`]: [] });
          }}
        >
          + {l("添加基因簇", "Add cluster")}
        </button>
      </div>
    </div>
  );
}

/** 图画廊:缩略图 + 点击放大 */
function Gallery() {
  const { language } = useLanguage();
  const l = (zh: string, en: string) => (language === "en" ? en : zh);
  const st = useRnaSeq();
  const [zoom, setZoom] = useState<{ subdir: string; name: string } | null>(null);

  return (
    <>
      <div className="rx-gallery-grid">
        {st.resultImages.map((f) => (
          <GalleryItem
            key={`${f.subdir}/${f.name}`}
            runDir={st.resultDir}
            subdir={f.subdir}
            name={f.name}
            onZoom={() => setZoom({ subdir: f.subdir, name: f.name })}
          />
        ))}
      </div>
      {zoom && (
        <Modal open onClose={() => setZoom(null)} wide title={zoom.name}>
          <div style={{ textAlign: "center" }}>
            <ZoomImage runDir={st.resultDir} subdir={zoom.subdir} name={zoom.name} />
          </div>
        </Modal>
      )}
      {st.resultDir && (
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn"
            onClick={() => void openInShell(st.resultDir)}
          >
            <IconFolderOpen size={13} stroke={1.75} />{" "}
            {l("打开输出目录", "Open output folder")}
          </button>
        </div>
      )}
    </>
  );
}

function GalleryItem({
  runDir,
  subdir,
  name,
  onZoom,
}: {
  runDir: string;
  subdir: string;
  name: string;
  onZoom: () => void;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true;
    if (!runDir) return;
    readImageDataURL(runDir, subdir, name)
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => {
        if (alive) setUrl("");
      });
    return () => {
      alive = false;
    };
  }, [runDir, subdir, name]);
  const isPng = name.toLowerCase().endsWith(".png");
  const isSvg = name.toLowerCase().endsWith(".svg");
  return (
    <figure className="rx-gallery-item">
      <div className="rx-gallery-thumb" role="button" onClick={onZoom} title={name}>
        {url && (isPng || isSvg) ? (
          <img src={url} alt={name} loading="lazy" />
        ) : (
          <span className="rx-thumb-pdf">{name.split(".").pop()?.toUpperCase()}</span>
        )}
        <span className="rx-thumb-zoom">
          <IconZoomIn size={16} stroke={1.75} />
        </span>
      </div>
      <figcaption className="rx-gallery-meta">
        <strong>{name}</strong>
        <small>{subdir}</small>
      </figcaption>
    </figure>
  );
}

function ZoomImage({
  runDir,
  subdir,
  name,
}: {
  runDir: string;
  subdir: string;
  name: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true;
    if (!runDir) return;
    readImageDataURL(runDir, subdir, name)
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => {
        if (alive) setUrl("");
      });
    return () => {
      alive = false;
    };
  }, [runDir, subdir, name]);
  if (!url) return <div className="rx-loading">…</div>;
  return <img src={url} alt={name} style={{ maxWidth: "100%", height: "auto" }} />;
}
