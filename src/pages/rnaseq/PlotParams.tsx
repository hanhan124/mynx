/**
 * 绘图参数面板 — 「使用范围」「本图专属」「ggplot 主题」「尺寸」「图例/标题/坐标轴」「theme() 调节」。
 * 基因设置(标记基因/功能簇/排除基因)是全局字段,编辑入口放在使用它的图面板内。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { IconGripVertical, IconRotate, IconPlus, IconBan } from "@tabler/icons-react";
import { showToast } from "@/components/Toast";
import { useRnaSeq } from "./store";
import { useLanguage } from "@/lib/i18n";
import {
  CheckChips,
  ColorField,
  NumField,
  SectionLabel,
  SelectField,
  SwitchField,
  TextField,
  localizeFieldText,
} from "./fields";
import {
  ALL_DBS,
  ALL_ONT,
  CLUSTER_PALETTES,
  GG_THEMES,
  HEAT_PALETTES,
  PALETTES,
} from "./plotDefs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Opt = Record<string, any>;

/** 获取当前图的可变参数对象(updateConfig 内通过 draft.plot_options[id] 修改) */
function usePlotOpt(plotId: string): Opt {
  const { config } = useRnaSeq();
  const o = (config.plot_options as Record<string, Opt>)[plotId];
  return o ?? {};
}

// ── 使用范围(组/比较子集) ──
export function ScopeSection({
  plotId,
  dim,
}: {
  plotId: string;
  dim: "group" | "comparison" | "both";
}) {
  const { language } = useLanguage();
  const l = (zh: string, en: string) => (language === "en" ? en : zh);
  const { config, updateConfig } = useRnaSeq();
  const vennBySample =
    plotId === "venn" && (config.plot_options.venn ?? {}).by === "sample";
  const vennByComp =
    plotId === "venn" && (config.plot_options.venn ?? {}).by !== "sample";

  const showGroups = dim === "group" || vennBySample;
  const showComps = dim === "comparison" || vennByComp;

  const compKey = (c: [string, string]) => `${c[0]}||${c[1]}`;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const o = usePlotOpt(plotId);

  return (
    <div className="rx-subset">
      {showGroups && (
        <div className="rx-subset-box">
          <label className="rx-subset-label">
            {l("使用哪些组", "Groups to use")}
            <small>{l("空 = 全部选定组", "empty = all selected groups")}</small>
          </label>
          <CheckChips
            options={config.selected_groups}
            selected={(o.groups ?? []) as string[]}
            onToggle={(g) =>
              updateConfig((c) => {
                const po = (c.plot_options as Record<string, Opt>)[plotId];
                po.groups = (po.groups ?? []).includes(g)
                  ? po.groups.filter((x: string) => x !== g)
                  : [...(po.groups ?? []), g];
              })
            }
            emptyTip={l(
              "先在「差异分析」页选择纳入分析的组。",
              "Select groups to include in Differential analysis first.",
            )}
          />
        </div>
      )}
      {showComps && (
        <div className="rx-subset-box">
          <label className="rx-subset-label">
            {l("使用哪些比较", "Comparisons to use")}
            <small>{l("空 = 全部比较", "empty = all comparisons")}</small>
          </label>
          <CheckChips
            options={config.comparisons.map(compKey)}
            selected={((o.comparisons ?? []) as [string, string][]).map(compKey)}
            onToggle={(key) =>
              updateConfig((c) => {
                const po = (c.plot_options as Record<string, Opt>)[plotId];
                const cur = ((po.comparisons ?? []) as [string, string][]).map(compKey);
                const next = cur.includes(key)
                  ? cur.filter((k: string) => k !== key)
                  : [...cur, key];
                po.comparisons = next.map(
                  (k: string) => k.split("||") as [string, string],
                );
              })
            }
            renderLabel={(key) => {
              const [t, ctrl] = key.split("||");
              return `${t} vs ${ctrl}`;
            }}
            emptyTip={l(
              "先在「差异分析」页设置比较。",
              "Set comparisons in Differential analysis first.",
            )}
          />
        </div>
      )}
      {dim === "both" && (
        <p className="rx-subset-note">
          {l(
            "依据「统计依据」自动切换组/比较选择。",
            "The statistics basis automatically selects group or comparison scope.",
          )}
        </p>
      )}
    </div>
  );
}

// ── 基因设置(全局字段,多处编辑同一份数据) ──
export function MarkerGenesField({ hint }: { hint: string }) {
  const { language } = useLanguage();
  const l = (zh: string, en: string) => (language === "en" ? en : zh);
  const { config, updateConfig } = useRnaSeq();
  const [text, setText] = useState(config.marker_genes.join(", "));
  useEffect(() => {
    const s = config.marker_genes.join(", ");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (s !== text) setText(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.marker_genes]);
  return (
    <div className="rx-field rx-field--wide">
      <label>
        {l("标记基因", "Marker genes")}
        <small>{localizeFieldText(hint, language)}</small>
      </label>
      <div className="rx-gene-row">
        <textarea
          rows={2}
          placeholder={l(
            "逗号/空格分隔,如:RPE65, MITF, BEST1",
            "Comma/space separated, e.g. RPE65, MITF, BEST1",
          )}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            updateConfig((c) => {
              c.marker_genes = e.target.value
                .split(/[,;\s]+/)
                .map((s) => s.trim())
                .filter(Boolean);
            });
          }}
        />
        <button
          className="btn"
          onClick={() => {
            updateConfig((c) => {
              c.marker_genes = [
                "RPE65",
                "MITF",
                "BEST1",
                "NANOG",
                "SOX2",
                "POU5F1",
                "PAX6",
                "PMEL",
                "RAX",
                "TYR",
                "OTX2",
                "TYRP1",
                "MERTK",
                "TJP1",
                "LHX2",
                "VSX2",
                "DCT",
                "RLBP1",
              ];
            });
            showToast(
              l(
                "已恢复默认标记基因(视网膜常用)",
                "Default marker genes restored (retina panel)",
              ),
              "success",
            );
          }}
        >
          <IconRotate size={12} stroke={1.75} /> {l("默认值", "Defaults")}
        </button>
      </div>
    </div>
  );
}

export function ExcludedGenesField({ hint }: { hint: string }) {
  const { language } = useLanguage();
  const l = (zh: string, en: string) => (language === "en" ? en : zh);
  const { config, updateConfig } = useRnaSeq();
  const [text, setText] = useState(config.excluded_genes.join("\n"));
  useEffect(() => {
    const s = config.excluded_genes.join("\n");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (s !== text) setText(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.excluded_genes]);
  return (
    <div className="rx-field rx-field--wide">
      <label>
        {l("排除基因", "Excluded genes")}
        <small>{localizeFieldText(hint, language)}</small>
      </label>
      <textarea
        rows={2}
        placeholder={l("一行一个或逗号分隔", "One per line or comma separated")}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          updateConfig((c) => {
            c.excluded_genes = e.target.value
              .split(/[,;\s\n]+/)
              .map((s) => s.trim())
              .filter(Boolean);
          });
        }}
      />
      {config.excluded_genes.length > 0 && (
        <small className="rx-field-hint">
          <IconBan size={10} /> {l("已排除", "Excluded")} {config.excluded_genes.length}{" "}
          {l("个基因", "genes")}
        </small>
      )}
    </div>
  );
}

// ── 热图列顺序(组顺序拖拽) ──
export function ColumnOrderField({ plotId }: { plotId: string }) {
  const { language } = useLanguage();
  const l = (zh: string, en: string) => (language === "en" ? en : zh);
  const { config, updateConfig } = useRnaSeq();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const o = (config.plot_options as Record<string, Opt>)[plotId] ?? {};
  const order = useMemo(() => {
    const active = ((o.groups?.length ? o.groups : config.selected_groups) ??
      []) as string[];
    const saved = (o.column_group_order ?? []) as string[];
    return [
      ...saved.filter((g) => active.includes(g)),
      ...active.filter((g) => !saved.includes(g)),
    ];
  }, [config.selected_groups, o.column_group_order, o.groups]);

  const moveGroup = useCallback((from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length)
      return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    updateConfig((c) => {
      ((c.plot_options as Record<string, Opt>)[plotId] ??= {}).column_group_order = next;
    });
  }, [order, plotId, updateConfig]);

  // Tauri 的原生窗口拖放会接管 HTML5 DragEvent；组芯片改用 PointerEvent，
  // 让鼠标和触屏的排序都留在 WebView 内，不与文件拖放竞争。
  useEffect(() => {
    if (dragFrom === null) return;

    const findChipIndex = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null;
      const value = target.closest<HTMLElement>("[data-column-group-index]")?.dataset
        .columnGroupIndex;
      const index = value === undefined ? Number.NaN : Number(value);
      return Number.isInteger(index) ? index : null;
    };
    const onPointerMove = (event: PointerEvent) => {
      const index = findChipIndex(document.elementFromPoint(event.clientX, event.clientY));
      if (index !== null) setDragOver(index);
    };
    const finishDrag = (event: PointerEvent) => {
      const index = findChipIndex(document.elementFromPoint(event.clientX, event.clientY));
      if (index !== null) moveGroup(dragFrom, index);
      setDragFrom(null);
      setDragOver(null);
    };
    const cancelDrag = () => {
      setDragFrom(null);
      setDragOver(null);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finishDrag, { once: true });
    window.addEventListener("pointercancel", cancelDrag, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", cancelDrag);
    };
  }, [dragFrom, moveGroup]);

  const GROUP_COLORS = [
    "#0a84ff",
    "#af52de",
    "#ff375f",
    "#ff9f0a",
    "#30d158",
    "#64d2ff",
    "#bf5af2",
    "#ffd60a",
  ];

  return (
    <div className="rx-field rx-field--wide">
      <label>
        {l("列顺序(组顺序)", "Column order (group order)")}
        <small>
          {l("拖拽调整 · 左→右绘制", "Drag to reorder · drawn left to right")}
        </small>
      </label>
      <div className="rx-col-order" role="list">
        {order.map((g, i) => {
          const gi = config.group_order.indexOf(g);
          const color =
            gi >= 0 ? GROUP_COLORS[gi % GROUP_COLORS.length] : "var(--accent)";
          return (
            <span
              key={g}
              className={`rx-col-chip${dragFrom === i ? " dragging" : ""}${dragOver === i ? " over" : ""}`}
              style={{ "--chip-color": color } as React.CSSProperties}
              data-column-group-index={i}
              role="listitem"
              tabIndex={0}
              aria-label={l(
                `${g}，第 ${i + 1} 列组，可拖动调整顺序`,
                `${g}, column group ${i + 1}, draggable`,
              )}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                setDragFrom(i);
                setDragOver(i);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  moveGroup(i, i - 1);
                } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  moveGroup(i, i + 1);
                }
              }}
            >
              <IconGripVertical size={12} stroke={1.75} className="rx-col-grip" />
              <span className="rx-col-idx">{i + 1}</span>
              {g}
            </span>
          );
        })}
        <button
          className="btn"
          onClick={() =>
            updateConfig((c) => {
              ((c.plot_options as Record<string, Opt>)[plotId] ??=
                {}).column_group_order = [];
            })
          }
        >
          <IconRotate size={12} stroke={1.75} /> {l("重置", "Reset")}
        </button>
      </div>
      <small className="rx-field-hint">
        {l(
          "拖动组芯片调整热图列顺序;绘制时按此顺序排列样本列",
          "Drag group chips to reorder heatmap columns; samples are drawn in this order",
        )}
      </small>
    </div>
  );
}

// ── 基因功能簇编辑(select_heatmap) ──
function GeneClustersEditor() {
  const { language } = useLanguage();
  const l = (zh: string, en: string) => (language === "en" ? en : zh);
  const { config, updateConfig } = useRnaSeq();
  const entries = Object.entries(config.gene_clusters);
  return (
    <div className="rx-gene-clusters">
      <div className="rx-gene-clusters-head">
        <label>
          {l("基因功能簇", "Gene function clusters")}
          <small>
            {l("本图按簇分块展示;每簇一行", "Grouped by cluster; one row per cluster")}
          </small>
        </label>
        <div className="rx-title-actions">
          <button
            className="btn"
            onClick={() =>
              updateConfig((c) => {
                const name = `NewCluster_${Object.keys(c.gene_clusters).length + 1}`;
                c.gene_clusters[name] = [];
              })
            }
          >
            <IconPlus size={12} stroke={1.75} /> {l("添加簇", "Add cluster")}
          </button>
          <button
            className="btn"
            onClick={() =>
              updateConfig((c) => {
                c.gene_clusters = JSON.parse(
                  JSON.stringify({
                    Transcription: ["MITF", "OTX2", "PAX6", "RAX", "LHX2"],
                    Melanogenesis: ["TYR", "TYRP1", "PMEL", "MLANA", "DCT"],
                    Visual_Cycle: ["RPE65", "RDH5", "RLBP1"],
                    Phagocytosis: ["MERTK", "ITGAV"],
                    Ion_Transport: ["BEST1", "ATP1A1"],
                    Tight_Junctions: ["TJP1", "AQP1"],
                    Cytoskeleton: ["EZR"],
                    Secreted: ["SERPINF1", "VEGFA"],
                  }),
                );
              })
            }
          >
            <IconRotate size={12} stroke={1.75} /> {l("默认值", "Defaults")}
          </button>
        </div>
      </div>
      {entries.length === 0 && (
        <div className="rx-empty-tip">
          {l(
            "点击「添加簇」创建,或加载默认值(视网膜等常用簇)。",
            "Click Add cluster or load the defaults (common retina clusters).",
          )}
        </div>
      )}
      {entries.map(([name, genes]) => (
        <div key={name} className="rx-cluster-row">
          <input
            className="rx-cluster-name"
            type="text"
            defaultValue={name}
            placeholder={l("簇名", "Cluster name")}
            onBlur={(e) => {
              const newName = e.target.value.trim();
              if (!newName || newName === name) return;
              if (config.gene_clusters[newName]) {
                showToast(
                  l(
                    `簇名「${newName}」已存在,改名被拒绝`,
                    `Cluster name “${newName}” already exists`,
                  ),
                  "info",
                );
                e.target.value = name;
                return;
              }
              updateConfig((c) => {
                const g = c.gene_clusters[name];
                delete c.gene_clusters[name];
                c.gene_clusters[newName] = g;
              });
            }}
          />
          <input
            className="rx-cluster-genes"
            type="text"
            defaultValue={genes.join(", ")}
            placeholder={l("基因列表(逗号分隔)", "Gene list (comma separated)")}
            onBlur={(e) =>
              updateConfig((c) => {
                c.gene_clusters[name] = e.target.value.split(/[,;\s]+/).filter(Boolean);
              })
            }
          />
          <span className="rx-tag">{genes.length}</span>
          <button
            className="rx-icon-btn rx-icon-btn--danger"
            onClick={() =>
              updateConfig((c) => {
                delete c.gene_clusters[name];
              })
            }
          >
            {l("删除", "Delete")}
          </button>
        </div>
      ))}
    </div>
  );
}

// ── 每类图专属参数 ──
export function SpecificParams({ plotId }: { plotId: string }) {
  const { language } = useLanguage();
  const l = (zh: string, en: string) => (language === "en" ? en : zh);
  const { config, updateConfig } = useRnaSeq();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const o = usePlotOpt(plotId);
  const set = (key: string, value: unknown) =>
    updateConfig((c) => {
      ((c.plot_options as Record<string, Opt>)[plotId] ??= {})[key] = value;
    });

  switch (plotId) {
    case "pca":
    case "mds":
      return (
        <>
          <SectionLabel>
            {plotId === "pca"
              ? l("PCA 设置", "PCA settings")
              : l("MDS 设置", "MDS settings")}
          </SectionLabel>
          <div className="rx-param-row">
            <SwitchField
              label="正方形"
              checked={o.square}
              onChange={(v) => set("square", v)}
            />
            <SwitchField
              label="十字辅助线"
              checked={o.show_crosshair}
              onChange={(v) => set("show_crosshair", v)}
            />
            <SwitchField
              label="标签吸附"
              checked={o.label_repel}
              onChange={(v) => set("label_repel", v)}
            />
            <SelectField
              label="标签内容"
              value={o.label_text ?? "group"}
              options={[
                { value: "group", label: "分组" },
                { value: "sample", label: "样本" },
                { value: "none", label: "无" },
              ]}
              onChange={(v) => set("label_text", v)}
            />
            {plotId === "pca" && (
              <>
                <NumField
                  label="PCA 高变基因数"
                  value={o.top_var_genes}
                  step={100}
                  min={0}
                  placeholder={l("全部", "All")}
                  onChange={(v) => set("top_var_genes", v ?? 0)}
                />
                <SwitchField
                  label="逐基因 Z 标准化"
                  checked={o.scale_genes ?? false}
                  hint="VST/log2-CPM 后默认关闭；开启会让每个基因对 PCA 的权重相同，适合作为敏感性分析"
                  onChange={(v) => set("scale_genes", v)}
                />
              </>
            )}
            <NumField
              label="点大小"
              value={o.point_size}
              step={0.5}
              onChange={(v) => set("point_size", v)}
            />
            <NumField
              label="点透明度"
              value={o.point_alpha}
              step={0.1}
              min={0}
              max={1}
              onChange={(v) => set("point_alpha", v)}
            />
            <NumField
              label="点形状"
              value={o.point_shape}
              step={1}
              min={0}
              max={25}
              onChange={(v) => set("point_shape", v)}
            />
            <NumField
              label="X 轴范围(min)"
              value={(o.xlim ?? [])[0]}
              step={1}
              placeholder={l("自动", "Auto")}
              onChange={(v) => set("xlim", [v ?? null, (o.xlim ?? [])[1] ?? null])}
            />
            <NumField
              label="X 轴范围(max)"
              value={(o.xlim ?? [])[1]}
              step={1}
              placeholder={l("自动", "Auto")}
              onChange={(v) => set("xlim", [(o.xlim ?? [])[0] ?? null, v ?? null])}
            />
            <NumField
              label="Y 轴范围(min)"
              value={(o.ylim ?? [])[0]}
              step={1}
              placeholder={l("自动", "Auto")}
              onChange={(v) => set("ylim", [v ?? null, (o.ylim ?? [])[1] ?? null])}
            />
            <NumField
              label="Y 轴范围(max)"
              value={(o.ylim ?? [])[1]}
              step={1}
              placeholder={l("自动", "Auto")}
              onChange={(v) => set("ylim", [(o.ylim ?? [])[0] ?? null, v ?? null])}
            />
            <ExcludedGenesField hint="绘制前从表达矩阵剔除(如线粒体/低质量基因);也作用于整体热图" />
          </div>
        </>
      );
    case "heatmap":
      return (
        <>
          <SectionLabel>{l("热图设置", "Heatmap settings")}</SectionLabel>
          <div className="rx-param-row">
            <SwitchField
              label="显示所有基因"
              checked={o.use_all_genes}
              hint="不过滤，显示全部基因。超过 5,000 个基因时，请明确选择 K-means 或不聚类；SVG/PDF 可保持矢量热图"
              onChange={(v) => set("use_all_genes", v)}
            />
            <NumField
              label="最多基因数"
              value={o.max_genes}
              step={100}
              min={0}
              placeholder={l("不限制", "Unlimited")}
              onChange={(v) => set("max_genes", v ?? 0)}
            />
            <SelectField
              label="行聚类方法"
              value={o.row_clustering_method ?? "hierarchical"}
              options={[
                { value: "hierarchical", label: l("层次聚类（Euclidean + Ward.D2）", "Hierarchical (Euclidean + Ward.D2)") },
                { value: "kmeans", label: l("K-means 分簇（大矩阵可用）", "K-means clustering (large matrices)") },
                { value: "none", label: l("不聚类", "No clustering") },
              ]}
              onChange={(v) => set("row_clustering_method", v)}
            />
            <SelectField
              label="行排序"
              value={o.row_order ?? "cluster_first_column_desc"}
              options={(o.row_clustering_method ?? "hierarchical") === "none"
                ? [
                    { value: "input", label: l("保留输入顺序", "Keep input order") },
                    { value: "first_column_desc", label: l("首列高到低", "First column high→low") },
                    { value: "first_column_asc", label: l("首列低到高", "First column low→high") },
                  ]
                : [
                    { value: "cluster_first_column_desc", label: l("簇优先·首列高到低", "Clusters, first column high→low") },
                    { value: "cluster", label: l("仅按聚类顺序", "Cluster order only") },
                    { value: "first_column_desc", label: l("首列高到低", "First column high→low") },
                    { value: "first_column_asc", label: l("首列低到高", "First column low→high") },
                  ]}
              onChange={(v) => set("row_order", v)}
            />
            <SwitchField
              label="栅格化热图"
              checked={o.use_raster}
              onChange={(v) => set("use_raster", v)}
            />
            {(o.row_clustering_method ?? "hierarchical") !== "none" && (
              <NumField
                label={(o.row_clustering_method ?? "hierarchical") === "kmeans" ? "K-means 簇数 k" : "树切分簇数 k"}
                value={o.k_clusters}
                step={1}
                min={1}
                hint={(o.row_clustering_method ?? "hierarchical") === "kmeans"
                  ? "K-means 的聚类中心数；固定随机种子以保证可复现"
                  : "将层次聚类树切分为 k 个展示簇，不代表统计显著性"}
                onChange={(v) => set("k_clusters", v)}
              />
            )}
            <SwitchField
              label="标记基因标签"
              checked={o.show_marker_labels}
              onChange={(v) => set("show_marker_labels", v)}
            />
            <SwitchField
              label="列名(分组)"
              checked={o.show_column_names}
              onChange={(v) => set("show_column_names", v)}
            />
            <NumField
              label="列名旋转角"
              value={o.column_names_rot}
              step={15}
              onChange={(v) => set("column_names_rot", v)}
            />
            <SwitchField
              label="行名(基因名)"
              checked={o.show_row_names}
              onChange={(v) => set("show_row_names", v)}
            />
            <NumField
              label="基因名字号"
              value={o.row_names_size}
              step={1}
              min={1}
              onChange={(v) => set("row_names_size", v)}
            />
            <NumField
              label="分组名字号"
              value={o.column_names_size}
              step={1}
              min={1}
              onChange={(v) => set("column_names_size", v)}
            />
            <NumField
              label="标记基因字号"
              value={o.marker_label_size}
              step={1}
              min={1}
              onChange={(v) => set("marker_label_size", v)}
            />
            <NumField
              label="图例标题字号"
              value={o.legend_title_size}
              step={1}
              min={1}
              onChange={(v) => set("legend_title_size", v)}
            />
            <NumField
              label="图例文字字号"
              value={o.legend_text_size}
              step={1}
              min={1}
              onChange={(v) => set("legend_text_size", v)}
            />
            <SelectField
              label="热图配色"
              value={o.heatmap_palette ?? "Blue-Red 2"}
              options={HEAT_PALETTES.map((p) => ({ value: p.id, label: p.label }))}
              onChange={(v) => set("heatmap_palette", v)}
            />
            <NumField
              label="Z-score 下限"
              value={o.zscore_min}
              step={0.5}
              onChange={(v) => set("zscore_min", v)}
            />
            <NumField
              label="Z-score 上限"
              value={o.zscore_max}
              step={0.5}
              onChange={(v) => set("zscore_max", v)}
            />
            <NumField
              label="颜色中心 Z 值"
              value={o.zscore_center}
              step={0.1}
              hint="调色板中点（通常为白色）对应的 Z 值；需位于上下限之间"
              onChange={(v) => set("zscore_center", v)}
            />
            {(o.row_clustering_method ?? "hierarchical") !== "none" && <>
              <SwitchField
                label="Cluster 注释"
                checked={o.show_cluster_annotation}
                onChange={(v) => set("show_cluster_annotation", v)}
              />
              <SwitchField
                label="显示簇名称图例"
                checked={o.show_cluster_legend ?? false}
                hint="显示右侧 Cluster 图例中的簇名称，不影响注释色条"
                onChange={(v) => set("show_cluster_legend", v)}
              />
            </>}
            {(o.row_clustering_method ?? "hierarchical") !== "none" && o.show_cluster_annotation && (
              <SelectField
                label="Cluster 配色"
                value={o.cluster_palette ?? "Catppuccin Mocha"}
                options={CLUSTER_PALETTES.map((p) => ({ value: p.id, label: p.label }))}
                onChange={(v) => set("cluster_palette", v)}
              />
            )}
            <ColumnOrderField plotId={plotId} />
            <MarkerGenesField hint="热图行标注;也用于火山图标注与小提琴图默认基因" />
            <ExcludedGenesField hint="绘制前从表达矩阵剔除;也作用于 PCA" />
          </div>
        </>
      );
    case "qc":
      return (
        <>
          <SectionLabel>{l("样本 QC 设置", "Sample QC settings")}</SectionLabel>
          <div className="rx-param-row">
            <SwitchField
              label="文库深度"
              checked={o.show_library_size}
              onChange={(v) => set("show_library_size", v)}
            />
            <SwitchField
              label="检测基因数"
              checked={o.show_detected_genes}
              onChange={(v) => set("show_detected_genes", v)}
            />
            <SwitchField
              label="表达分布"
              checked={o.show_expression_distribution}
              onChange={(v) => set("show_expression_distribution", v)}
            />
            <SwitchField
              label="相关性热图"
              checked={o.show_correlation}
              onChange={(v) => set("show_correlation", v)}
            />
            <SwitchField
              label="距离热图"
              checked={o.show_distance}
              onChange={(v) => set("show_distance", v)}
            />
            <SelectField
              label="分组配色"
              value={o.color_palette ?? "reference"}
              options={PALETTES.map((p) => ({ value: p.id, label: p.label }))}
              onChange={(v) => set("color_palette", v)}
            />
            <NumField
              label="柱图宽度"
              value={o.qc_width}
              step={0.5}
              min={1}
              onChange={(v) => set("qc_width", v)}
            />
            <NumField
              label="柱图最小高度"
              value={o.qc_height_min}
              step={0.5}
              min={1}
              onChange={(v) => set("qc_height_min", v)}
            />
            <NumField
              label="每样本高度"
              value={o.qc_height_per_sample}
              step={0.05}
              min={0}
              onChange={(v) => set("qc_height_per_sample", v)}
            />
            <NumField
              label="相关性图宽度"
              value={o.correlation_width}
              step={0.5}
              min={1}
              onChange={(v) => set("correlation_width", v)}
            />
            <NumField
              label="相关性图高度"
              value={o.correlation_height}
              step={0.5}
              min={1}
              onChange={(v) => set("correlation_height", v)}
            />
            <NumField
              label="距离图宽度"
              value={o.distance_width}
              step={0.5}
              min={1}
              onChange={(v) => set("distance_width", v)}
            />
            <NumField
              label="距离图高度"
              value={o.distance_height}
              step={0.5}
              min={1}
              onChange={(v) => set("distance_height", v)}
            />
          </div>
        </>
      );
    case "select_heatmap":
      return (
        <>
          <SectionLabel>
            {l("基因热图设置", "Selected-gene heatmap settings")}
          </SectionLabel>
          <div className="rx-param-row">
            <SwitchField
              label="显示基因名"
              checked={o.show_gene_names}
              onChange={(v) => set("show_gene_names", v)}
            />
            <SwitchField
              label="显示分组名"
              checked={o.show_group_names}
              onChange={(v) => set("show_group_names", v)}
            />
            <SwitchField
              label="显示 counts 数值"
              checked={o.show_cell_text ?? false}
              hint="按附件参考，在单元格中叠加显示原始 counts"
              onChange={(v) => set("show_cell_text", v)}
            />
            <NumField
              label="counts 字号"
              value={o.cell_text_size}
              step={0.5}
              min={0.5}
              onChange={(v) => set("cell_text_size", v)}
            />
            <NumField
              label="基因名旋转角"
              value={o.gene_label_rot}
              step={15}
              onChange={(v) => set("gene_label_rot", v)}
            />
            <NumField
              label="基因名字号"
              value={o.gene_names_size}
              step={1}
              min={1}
              onChange={(v) => set("gene_names_size", v)}
            />
            <NumField
              label="分组名字号"
              value={o.group_names_size}
              step={1}
              min={1}
              onChange={(v) => set("group_names_size", v)}
            />
            <NumField
              label="图例标题字号"
              value={o.legend_title_size}
              step={1}
              min={1}
              onChange={(v) => set("legend_title_size", v)}
            />
            <NumField
              label="图例文字字号"
              value={o.legend_text_size}
              step={1}
              min={1}
              onChange={(v) => set("legend_text_size", v)}
            />
            <SelectField
              label="热图配色"
              value={o.heatmap_palette ?? "Blue-Red 2"}
              options={HEAT_PALETTES.map((p) => ({ value: p.id, label: p.label }))}
              onChange={(v) => set("heatmap_palette", v)}
            />
            <NumField
              label="Z-score 下限"
              value={o.zscore_min}
              step={0.5}
              onChange={(v) => set("zscore_min", v)}
            />
            <NumField
              label="Z-score 上限"
              value={o.zscore_max}
              step={0.5}
              onChange={(v) => set("zscore_max", v)}
            />
            <NumField
              label="颜色中心 Z 值"
              value={o.zscore_center}
              step={0.1}
              hint="调色板中点（通常为白色）对应的 Z 值；需位于上下限之间"
              onChange={(v) => set("zscore_center", v)}
            />
            <SwitchField
              label="Cluster 注释"
              checked={o.show_cluster_annotation}
              onChange={(v) => set("show_cluster_annotation", v)}
            />
            <SwitchField
              label="显示簇名称图例"
              checked={o.show_cluster_legend ?? true}
              hint="显示右侧 Cluster 图例中的簇名称，不影响左侧簇色条"
              onChange={(v) => set("show_cluster_legend", v)}
            />
            <SwitchField
              label="栅格化热图"
              checked={o.use_raster ?? true}
              hint="按附件参考默认开启；关闭后便于矢量编辑"
              onChange={(v) => set("use_raster", v)}
            />
            {o.show_cluster_annotation && (
              <SelectField
                label="Cluster 配色"
                value={o.cluster_palette ?? "npg"}
                options={CLUSTER_PALETTES.map((p) => ({ value: p.id, label: p.label }))}
                onChange={(v) => set("cluster_palette", v)}
              />
            )}
            <ColumnOrderField plotId={plotId} />
            <GeneClustersEditor />
          </div>
        </>
      );
    case "volcano":
      return (
        <>
          <SectionLabel>{l("火山图设置", "Volcano settings")}</SectionLabel>
          <div className="rx-param-row">
            <NumField
              label="标注 top N"
              value={o.top_n}
              step={1}
              min={0}
              onChange={(v) => set("top_n", v)}
            />
            <NumField
              label="标签大小"
              value={o.label_size}
              step={0.5}
              onChange={(v) => set("label_size", v)}
            />
            <SwitchField
              label="阈值线"
              checked={o.show_threshold_lines}
              onChange={(v) => set("show_threshold_lines", v)}
            />
            <SwitchField
              label="副标题"
              checked={o.show_subtitle}
              onChange={(v) => set("show_subtitle", v)}
            />
            <NumField
              label="点大小"
              value={o.point_size}
              step={0.1}
              onChange={(v) => set("point_size", v)}
            />
            <NumField
              label="点透明度"
              value={o.point_alpha}
              step={0.1}
              min={0}
              max={1}
              onChange={(v) => set("point_alpha", v)}
            />
            <NumField
              label="点形状"
              value={o.point_shape}
              step={1}
              min={0}
              max={25}
              onChange={(v) => set("point_shape", v)}
            />
            <SwitchField
              label="正方形"
              checked={o.square}
              onChange={(v) => set("square", v)}
            />
            <NumField
              label="Y 轴范围(max)"
              value={(o.ylim ?? [])[1]}
              step={1}
              placeholder={l("自动", "Auto")}
              onChange={(v) => set("ylim", [(o.ylim ?? [])[0] ?? null, v ?? null])}
            />
            <SelectField
              label="标注策略"
              value={o.label_strategy ?? "top_n"}
              options={[
                { value: "top_n", label: "显著 top-N" },
                { value: "marker", label: "仅标记基因" },
                { value: "both", label: "top-N + 标记基因" },
                { value: "none", label: "不标注" },
              ]}
              onChange={(v) => set("label_strategy", v)}
            />
            <SwitchField
              label="标上调"
              checked={o.label_up_only}
              onChange={(v) => set("label_up_only", v)}
            />
            <SwitchField
              label="标下调"
              checked={o.label_down_only}
              onChange={(v) => set("label_down_only", v)}
            />
            <NumField
              label="p 值上限"
              value={config.params.pvalue_cap}
              step={1e-51}
              min={0}
              hint="防极端值压扁图"
              onChange={(v) =>
                updateConfig((c) => {
                  c.params.pvalue_cap = v ?? 1e-50;
                })
              }
            />
            <MarkerGenesField hint="标注策略选「仅标记基因 / top-N + 标记基因」时使用;也用于整体热图与小提琴图" />
          </div>
        </>
      );
    case "venn":
      return (
        <>
          <SectionLabel>{l("Venn 设置", "Venn settings")}</SectionLabel>
          <div className="rx-param-row">
            <SelectField
              label="统计依据"
              value={o.by ?? "comparison"}
              options={[
                { value: "sample", label: "样本" },
                { value: "comparison", label: "比较" },
              ]}
              onChange={(v) => set("by", v)}
            />
            <NumField
              label="最大集合数"
              value={o.max_sets}
              step={1}
              min={2}
              max={6}
              onChange={(v) => set("max_sets", v)}
            />
            <NumField
              label="集合名字号"
              value={o.set_name_size}
              step={0.5}
              min={0.5}
              onChange={(v) => set("set_name_size", v)}
            />
            <NumField
              label="交集数字字号"
              value={o.text_size}
              step={0.5}
              min={0.5}
              onChange={(v) => set("text_size", v)}
            />
            <NumField
              label="标题字号"
              value={o.title_size}
              step={1}
              min={1}
              onChange={(v) => set("title_size", v)}
            />
          </div>
        </>
      );
    case "ma":
      return (
        <>
          <SectionLabel>{l("MA 图设置", "MA plot settings")}</SectionLabel>
          <div className="rx-param-row">
            <SwitchField
              label="阈值线"
              checked={o.show_threshold_line}
              onChange={(v) => set("show_threshold_line", v)}
            />
            <SwitchField
              label="LOESS 趋势线"
              checked={o.show_loess}
              hint="DESeq2 plotMA 标配"
              onChange={(v) => set("show_loess", v)}
            />
            <NumField
              label="点大小"
              value={o.point_size}
              step={0.1}
              onChange={(v) => set("point_size", v)}
            />
            <NumField
              label="点透明度"
              value={o.point_alpha}
              step={0.1}
              min={0}
              max={1}
              onChange={(v) => set("point_alpha", v)}
            />
            <NumField
              label="点形状"
              value={o.point_shape}
              step={1}
              min={0}
              max={25}
              onChange={(v) => set("point_shape", v)}
            />
          </div>
        </>
      );
    case "boxplot":
      return (
        <>
          <SectionLabel>{l("箱线图设置", "Box plot settings")}</SectionLabel>
          <div className="rx-param-row">
            <NumField
              label="X 轴文字旋转"
              value={o.x_text_angle}
              step={5}
              min={0}
              max={90}
              onChange={(v) => set("x_text_angle", v)}
            />
            <NumField
              label="异常值大小"
              value={o.outlier_size}
              step={0.1}
              onChange={(v) => set("outlier_size", v)}
            />
            <NumField
              label="箱线宽度"
              value={o.box_line_width}
              step={0.1}
              onChange={(v) => set("box_line_width", v)}
            />
            <NumField
              label="箱体透明度"
              value={o.box_alpha}
              step={0.1}
              min={0}
              max={1}
              onChange={(v) => set("box_alpha", v)}
            />
          </div>
        </>
      );
    case "deg_bar":
      return (
        <>
          <SectionLabel>{l("DEG 柱状图设置", "DEG bar chart settings")}</SectionLabel>
          <div className="rx-param-row">
            <SelectField
              label="柱子排列"
              value={o.bar_position ?? "stack"}
              options={[
                { value: "stack", label: "堆叠" },
                { value: "dodge", label: "并排" },
              ]}
              onChange={(v) => set("bar_position", v)}
            />
            <NumField
              label="柱子宽度"
              value={o.bar_width}
              step={0.1}
              min={0}
              max={1}
              onChange={(v) => set("bar_width", v)}
            />
            <SwitchField
              label="显示数值"
              checked={o.show_values}
              onChange={(v) => set("show_values", v)}
            />
            <NumField
              label="X 轴文字旋转"
              value={o.x_text_angle}
              step={5}
              min={0}
              max={90}
              onChange={(v) => set("x_text_angle", v)}
            />
          </div>
        </>
      );
    case "top_genes":
      return (
        <>
          <SectionLabel>{l("Top 基因图设置", "Top genes settings")}</SectionLabel>
          <div className="rx-param-row">
            <NumField
              label="显示前 N 个"
              value={o.n}
              step={1}
              min={1}
              onChange={(v) => set("n", v)}
            />
            <SwitchField
              label="基因名斜体"
              checked={o.gene_italic}
              onChange={(v) => set("gene_italic", v)}
            />
            <SwitchField
              label="阈值线"
              checked={o.show_threshold_line}
              onChange={(v) => set("show_threshold_line", v)}
            />
            <NumField
              label="柱子宽度"
              value={o.bar_width}
              step={0.1}
              min={0}
              max={1}
              onChange={(v) => set("bar_width", v)}
            />
          </div>
        </>
      );
    case "dendrogram":
      return (
        <>
          <SectionLabel>{l("树状图设置", "Dendrogram settings")}</SectionLabel>
          <div className="rx-param-row">
            <SelectField
              label="聚类方法"
              value={o.method ?? "ward.D2"}
              options={[
                { value: "ward.D2", label: "ward.D2" },
                { value: "complete", label: "complete" },
                { value: "average", label: "average" },
                { value: "single", label: "single" },
              ]}
              onChange={(v) => set("method", v)}
            />
            <NumField
              label="标签大小"
              value={o.label_cex}
              step={0.1}
              min={0}
              onChange={(v) => set("label_cex", v)}
            />
            <NumField
              label="悬挂高度"
              value={o.hang}
              step={0.5}
              onChange={(v) => set("hang", v)}
            />
            <NumField
              label="坐标轴字号"
              value={o.cex_axis}
              step={0.1}
              min={0}
              onChange={(v) => set("cex_axis", v)}
            />
            <NumField
              label="主标题字号"
              value={o.cex_main}
              step={0.1}
              min={0}
              onChange={(v) => set("cex_main", v)}
            />
            <NumField
              label="坐标轴标题字号"
              value={o.cex_lab}
              step={0.1}
              min={0}
              onChange={(v) => set("cex_lab", v)}
            />
          </div>
        </>
      );
    case "enrich":
      return (
        <>
          <SectionLabel>{l("富集分析设置", "Enrichment settings")}</SectionLabel>
          <div className="rx-param-row">
            <SelectField
              label="物种"
              value={o.organism ?? "human"}
              options={[
                { value: "human", label: "人类" },
                { value: "mouse", label: "小鼠" },
                { value: "rat", label: "大鼠" },
              ]}
              onChange={(v) => set("organism", v)}
            />
            <NumField
              label="p 值阈值"
              value={o.pvalue_cutoff}
              step={0.01}
              min={0}
              max={1}
              onChange={(v) => set("pvalue_cutoff", v)}
            />
            <NumField
              label="q 值阈值"
              value={o.qvalue_cutoff}
              step={0.01}
              min={0}
              max={1}
              onChange={(v) => set("qvalue_cutoff", v)}
            />
            <NumField
              label="显示前 N 条"
              value={o.top_n}
              step={1}
              min={1}
              onChange={(v) => set("top_n", v)}
            />
            <NumField
              label="柱子宽度"
              value={o.bar_width}
              step={0.1}
              min={0}
              max={1}
              onChange={(v) => set("bar_width", v)}
            />
            <SelectField
              label="着色依据"
              value={o.bar_color_by ?? "database"}
              options={[
                { value: "database", label: "按数据库" },
                { value: "ontology", label: "按 GO 本体" },
                { value: "neg_log10p", label: "按 -log10(padj)" },
              ]}
              onChange={(v) => set("bar_color_by", v)}
            />
            <SelectField
              label="X 轴"
              value={o.bar_x ?? "count"}
              options={[
                { value: "count", label: "基因数" },
                { value: "neg_log10p", label: "-log10(padj)" },
              ]}
              onChange={(v) => set("bar_x", v)}
            />
            <div className="rx-field rx-field--wide">
              <label>数据库</label>
              <CheckChips
                options={ALL_DBS}
                selected={(o.databases ?? []) as string[]}
                onToggle={(d) =>
                  set(
                    "databases",
                    (o.databases ?? []).includes(d)
                      ? (o.databases ?? []).filter((x: string) => x !== d)
                      : [...(o.databases ?? []), d],
                  )
                }
              />
            </div>
            <div className="rx-field rx-field--wide">
              <label>GO 本体</label>
              <CheckChips
                options={ALL_ONT}
                selected={(o.ontologies ?? []) as string[]}
                onToggle={(d) =>
                  set(
                    "ontologies",
                    (o.ontologies ?? []).includes(d)
                      ? (o.ontologies ?? []).filter((x: string) => x !== d)
                      : [...(o.ontologies ?? []), d],
                  )
                }
              />
            </div>
          </div>
        </>
      );
    case "gsea":
      return (
        <>
          <SectionLabel>{l("GSEA 设置", "GSEA settings")}</SectionLabel>
          <div className="rx-param-row">
            <SelectField
              label="物种"
              value={o.organism ?? "human"}
              options={[
                { value: "human", label: "人类" },
                { value: "mouse", label: "小鼠" },
                { value: "rat", label: "大鼠" },
              ]}
              onChange={(v) => set("organism", v)}
            />
            <NumField
              label="p 值阈值"
              value={o.pvalue_cutoff}
              step={0.01}
              min={0}
              max={1}
              onChange={(v) => set("pvalue_cutoff", v)}
            />
            <NumField
              label="显示前 N 条"
              value={o.top_n}
              step={1}
              min={1}
              onChange={(v) => set("top_n", v)}
            />
            <NumField
              label="点最小"
              value={o.point_size_min}
              step={0.5}
              min={0.5}
              onChange={(v) => set("point_size_min", v)}
            />
            <NumField
              label="点最大"
              value={o.point_size_max}
              step={0.5}
              min={1}
              onChange={(v) => set("point_size_max", v)}
            />
            <SelectField
              label="着色依据"
              value={o.color_by ?? "direction"}
              options={[
                { value: "direction", label: "上下调方向" },
                { value: "nes", label: "NES 连续着色" },
              ]}
              onChange={(v) => set("color_by", v)}
            />
            <NumField
              label="Running 图数"
              value={o.n_running_plots}
              step={1}
              min={0}
              hint="每比较每库额外的 running-score 图"
              onChange={(v) => set("n_running_plots", v)}
            />
            <div className="rx-field rx-field--wide">
              <label>数据库</label>
              <CheckChips
                options={ALL_DBS}
                selected={(o.databases ?? []) as string[]}
                onToggle={(d) =>
                  set(
                    "databases",
                    (o.databases ?? []).includes(d)
                      ? (o.databases ?? []).filter((x: string) => x !== d)
                      : [...(o.databases ?? []), d],
                  )
                }
              />
            </div>
          </div>
        </>
      );
    case "violin":
      return (
        <>
          <SectionLabel>{l("小提琴图设置", "Violin plot settings")}</SectionLabel>
          <div className="rx-param-row">
            <div className="rx-field rx-field--wide">
              <label>{l("目标基因(逗号分隔)", "Target genes (comma separated)")}</label>
              <input
                type="text"
                placeholder={l(
                  "如:RPE65,MITF,BEST1(空=用标记基因)",
                  "e.g. RPE65, MITF, BEST1 (empty = marker genes)",
                )}
                defaultValue={(o.genes ?? []).join(", ")}
                onBlur={(e) =>
                  set("genes", e.target.value.split(/[,;\s]+/).filter(Boolean))
                }
              />
            </div>
            <NumField
              label="透明度"
              value={o.violin_alpha}
              step={0.1}
              min={0}
              max={1}
              onChange={(v) => set("violin_alpha", v)}
            />
            <NumField
              label="列数"
              value={o.ncol}
              step={1}
              min={1}
              max={8}
              onChange={(v) => set("ncol", v)}
            />
            <MarkerGenesField hint="上方「目标基因」留空时按此列表绘制;也用于整体热图与火山图标注" />
          </div>
        </>
      );
    case "density":
      return (
        <>
          <SectionLabel>{l("密度图设置", "Density plot settings")}</SectionLabel>
          <div className="rx-param-row">
            <SelectField
              label="分组依据"
              value={o.by ?? "group"}
              options={[
                { value: "sample", label: "按样本" },
                { value: "group", label: "按分组" },
              ]}
              onChange={(v) => set("by", v)}
            />
            <NumField
              label="透明度"
              value={o.alpha}
              step={0.1}
              min={0}
              max={1}
              onChange={(v) => set("alpha", v)}
            />
          </div>
        </>
      );
    default:
      return null;
  }
}

// ── ggplot 主题段 ──
export function GgThemeSection({ plotId }: { plotId: string }) {
  const { updateConfig } = useRnaSeq();
  const o = usePlotOpt(plotId);
  const set = (key: string, value: unknown) =>
    updateConfig((c) => {
      ((c.plot_options as Record<string, Opt>)[plotId] ??= {})[key] = value;
    });
  return (
    <div className="rx-param-row">
      <SelectField
        label="theme_*"
        value={o.gg_theme ?? "bw"}
        options={GG_THEMES.map((t) => ({ value: t.id, label: t.label }))}
        hint="默认 theme_bw"
        onChange={(v) => set("gg_theme", v)}
      />
      <NumField
        label="base_size"
        value={o.base_size}
        step={1}
        min={6}
        max={24}
        hint="theme_*(base_size=)"
        onChange={(v) => set("base_size", v)}
      />
    </div>
  );
}

// ── 尺寸段 ──
export function SizeSection({ plotId }: { plotId: string }) {
  const { updateConfig } = useRnaSeq();
  const o = usePlotOpt(plotId);
  const set = (key: string, value: unknown) =>
    updateConfig((c) => {
      ((c.plot_options as Record<string, Opt>)[plotId] ??= {})[key] = value;
    });
  return (
    <div className="rx-param-row">
      <NumField
        label="宽度(inches)"
        value={o.width}
        step={0.5}
        onChange={(v) => set("width", v)}
      />
      <NumField
        label="高度(inches)"
        value={o.height}
        step={0.5}
        onChange={(v) => set("height", v)}
      />
    </div>
  );
}

// ── 图例 / 标题 / 坐标轴段 ──
export function LabelsSection({ plotId }: { plotId: string }) {
  const { language } = useLanguage();
  const l = (zh: string, en: string) => (language === "en" ? en : zh);
  const { updateConfig } = useRnaSeq();
  const o = usePlotOpt(plotId);
  const set = (key: string, value: unknown) =>
    updateConfig((c) => {
      ((c.plot_options as Record<string, Opt>)[plotId] ??= {})[key] = value;
    });
  const has = (key: string) => o[key] !== undefined;
  return (
    <>
      <SectionLabel>{l("图例", "Legend")}</SectionLabel>
      <div className="rx-param-row">
        <SwitchField
          label="显示"
          checked={o.show_legend}
          onChange={(v) => set("show_legend", v)}
        />
        <SelectField
          label="位置"
          value={o.legend_position ?? "right"}
          options={[
            { value: "right", label: "右" },
            { value: "left", label: "左" },
            { value: "top", label: "上" },
            { value: "bottom", label: "下" },
          ]}
          onChange={(v) => set("legend_position", v)}
        />
        <SelectField
          label="方向"
          value={o.legend_direction ?? "vertical"}
          options={[
            { value: "vertical", label: "垂直" },
            { value: "horizontal", label: "水平" },
          ]}
          onChange={(v) => set("legend_direction", v)}
        />
        <TextField
          label="图例标题"
          value={o.legend_title ?? ""}
          placeholder={l("空=自动", "Empty = auto")}
          onChange={(v) => set("legend_title", v)}
        />
        <NumField
          label="标题字号"
          value={o.legend_title_size}
          step={1}
          onChange={(v) => set("legend_title_size", v)}
        />
        <NumField
          label="文字字号"
          value={o.legend_text_size}
          step={1}
          onChange={(v) => set("legend_text_size", v)}
        />
      </div>
      {has("show_title") && (
        <>
          <SectionLabel>{l("标题", "Title")}</SectionLabel>
          <div className="rx-param-row">
            <SwitchField
              label="显示"
              checked={o.show_title}
              onChange={(v) => set("show_title", v)}
            />
            <TextField
              label="文本"
              value={o.title ?? ""}
              placeholder={l("空=自动", "Empty = auto")}
              onChange={(v) => set("title", v)}
            />
            <NumField
              label="字号"
              value={o.title_size}
              step={1}
              onChange={(v) => set("title_size", v)}
            />
            <SelectField
              label="对齐"
              value={o.title_hjust ?? 0.5}
              options={[
                { value: 0, label: "左对齐" },
                { value: 0.5, label: "居中" },
                { value: 1, label: "右对齐" },
              ]}
              onChange={(v) => set("title_hjust", v)}
            />
            <ColorField
              label="颜色"
              value={o.title_color}
              onChange={(v) => set("title_color", v)}
            />
          </div>
        </>
      )}
      <SectionLabel>{l("坐标轴", "Axes")}</SectionLabel>
      <div className="rx-param-row">
        {has("show_xlab") && (
          <SwitchField
            label="显示 X 轴"
            checked={o.show_xlab}
            onChange={(v) => set("show_xlab", v)}
          />
        )}
        {has("xlab") !== undefined && (
          <TextField
            label="X 轴文本"
            value={o.xlab ?? ""}
            onChange={(v) => set("xlab", v)}
          />
        )}
        {has("show_ylab") && (
          <SwitchField
            label="显示 Y 轴"
            checked={o.show_ylab}
            onChange={(v) => set("show_ylab", v)}
          />
        )}
        <TextField
          label="Y 轴文本"
          value={o.ylab ?? ""}
          onChange={(v) => set("ylab", v)}
        />
        <NumField
          label="刻度字号"
          value={o.axis_text_size}
          step={1}
          onChange={(v) => set("axis_text_size", v)}
        />
        <NumField
          label="标题字号"
          value={o.axis_title_size}
          step={1}
          onChange={(v) => set("axis_title_size", v)}
        />
        <ColorField
          label="刻度颜色"
          value={o.axis_text_color}
          onChange={(v) => set("axis_text_color", v)}
        />
        <ColorField
          label="轴标题颜色"
          value={o.axis_title_color}
          onChange={(v) => set("axis_title_color", v)}
        />
      </div>
    </>
  );
}

// ── theme() 调节段 ──
export function ThemeSection({ plotId }: { plotId: string }) {
  const { language } = useLanguage();
  const l = (zh: string, en: string) => (language === "en" ? en : zh);
  const { updateConfig } = useRnaSeq();
  const o = usePlotOpt(plotId);
  const set = (key: string, value: unknown) =>
    updateConfig((c) => {
      ((c.plot_options as Record<string, Opt>)[plotId] ??= {})[key] = value;
    });
  return (
    <div className="rx-param-row">
      <SwitchField
        label="panel.grid"
        checked={o.show_grid}
        onChange={(v) => set("show_grid", v)}
      />
      <SwitchField
        label="axis.ticks"
        checked={o.show_axis_ticks}
        onChange={(v) => set("show_axis_ticks", v)}
      />
      <SelectField
        label="panel.border"
        value={o.panel_border ?? "auto"}
        options={[
          { value: "auto", label: "auto(theme 自带)" },
          { value: "solid", label: "solid" },
          { value: "dashed", label: "dashed" },
          { value: "none", label: "none" },
        ]}
        onChange={(v) => set("panel_border", v)}
      />
      <SelectField
        label="color_palette"
        value={o.color_palette ?? "category10_d3"}
        options={PALETTES.map((p) => ({ value: p.id, label: p.label }))}
        onChange={(v) => set("color_palette", v)}
      />
      <ColorField
        label="panel.background"
        value={o.panel_fill}
        onChange={(v) => set("panel_fill", v)}
      />
      <ColorField
        label="plot.background"
        value={o.plot_background}
        onChange={(v) => set("plot_background", v)}
      />
      <TextField
        label="plot.margin (t,r,b,l)"
        value={
          Array.isArray(o.plot_margin) ? o.plot_margin.join(",") : (o.plot_margin ?? "")
        }
        placeholder={l("如:10,10,10,10 或留空", "e.g. 10,10,10,10 or leave empty")}
        hint={l("ggplot2::margin,单位 pt", "ggplot2::margin, in pt")}
        onChange={(v) =>
          set(
            "plot_margin",
            v.trim() === "" ? [] : v.split(",").map((x) => Number(x.trim()) || 0),
          )
        }
      />
      {(plotId === "volcano" ||
        plotId === "ma" ||
        plotId === "deg_bar" ||
        plotId === "top_genes" ||
        plotId === "gsea") && (
        <>
          <ColorField
            label="上调颜色"
            value={o.up_color}
            onChange={(v) => set("up_color", v)}
          />
          <ColorField
            label="下调颜色"
            value={o.down_color}
            onChange={(v) => set("down_color", v)}
          />
          {(plotId === "volcano" || plotId === "ma") && (
            <ColorField
              label="不显著颜色"
              value={o.ns_color}
              onChange={(v) => set("ns_color", v)}
            />
          )}
        </>
      )}
    </div>
  );
}
