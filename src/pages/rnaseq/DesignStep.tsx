/**
 * 步骤 2:实验设计与差异分析 — 分组/比较/DE 参数,运行 R 引擎。
 * 方法论完全由 r/rnaseq_engine.R(参考脚本)决定:
 *   任一组 <2 样本 → edgeR exactTest + 固定 BCV(无重复路径);
 *   两组各 ≥2 样本 → DESeq2 / edgeR QLF(有重复路径)。
 * 样本分组的拖拽用 PointerEvent 实现 —— Tauri 会拦截 HTML5 DragEvent,
 * 仓库内列顺序拖拽(PlotParams 先例)同样采用此方案。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  IconFlask,
  IconPlus,
  IconTrash,
  IconX,
  IconPlayerPlay,
  IconPlayerStop,
  IconCopy,
  IconFolderOpen,
  IconChartDots,
  IconLayersIntersect,
} from "@tabler/icons-react";
import { showToast } from "@/components/Toast";
import { useRnaSeq } from "./store";
import {
  NumField,
  SelectField,
  Collapse,
} from "./fields";
import { checkRDependencies, installRDependencies } from "@/lib/rnaseq/runner";
import { openInShell } from "@/lib/rnaseq/io";
import { sanitizeComparisonName } from "@/lib/rnaseq/defaults";
import { validComparisonsOf } from "@/features/rnaseq/model/validation";
import type { Comparison } from "@/lib/rnaseq/types";
import { useLanguage } from "@/lib/i18n";

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

function autoName(c: Pick<Comparison, "case" | "control">): string {
  return sanitizeComparisonName(`${c.case}_vs_${c.control}`);
}

/** 拖拽结束后的一小段时间窗内视为「刚拖完」:此时忽略破坏性按钮的 click,
 *  落点恰好压在删除键上、或自动化工具在释放后补发 click 时都不会误删分组 */
function justDragged(lastDragEndRef: React.MutableRefObject<number>): boolean {
  return Date.now() - lastDragEndRef.current < 400;
}

export default function DesignStep({ goPlots }: { goPlots: () => void }) {
  const { language } = useLanguage();
  const l = (zh: string, en: string) => (language === "en" ? en : zh);
  const st = useRnaSeq();
  const cfg = st.config;
  const updateConfig = st.updateConfig; // 引用稳定,供一次性绑定的事件处理器使用

  // ── 样本池:导入的样本列;页面重载后从分组反推 ──
  const allSamples = useMemo(() => {
    const fromImport = st.importData?.sample_cols;
    if (fromImport?.length) return fromImport;
    return Object.values(cfg.groups).flat();
  }, [st.importData, cfg.groups]);

  const assigned = useMemo(
    () => new Set(Object.values(cfg.groups).flat()),
    [cfg.groups],
  );
  const pool = allSamples.filter((s) => !assigned.has(s));

  const validComps = validComparisonsOf(cfg);
  const minGroupN = Math.min(
    ...Object.values(cfg.groups).filter((g) => g.length > 0).map((g) => g.length),
  );
  const hasSingleton = Number.isFinite(minGroupN) && minGroupN < 2;

  const importReady = !!cfg.data_file && cfg.data_file === st.successfulImportPath;
  const designReady = Object.keys(cfg.groups).length >= 2 && validComps.length >= 1;

  // ── 分组编辑 ──
  const [pickedGroup, setPickedGroup] = useState("");
  // 显式选择的组不存在(被删除/改名)时回落到第一个组
  const selectedGroup = cfg.groups[pickedGroup] ? pickedGroup : (Object.keys(cfg.groups)[0] ?? "");
  const setSelectedGroup = setPickedGroup;

  const addGroup = () => {
    updateConfig((d) => {
      let i = Object.keys(d.groups).length + 1;
      while (d.groups[`Group${i}`]) i++;
      d.groups[`Group${i}`] = [];
    });
  };

  const renameGroup = (oldName: string, next: string) => {
    const name = next.trim();
    if (!name || name === oldName) return;
    if (cfg.groups[name]) {
      showToast(l("组名已存在", "Group name already exists"), "error");
      return;
    }
    updateConfig((d) => {
      const entries = Object.entries(d.groups).map(([g, samples]) =>
        g === oldName ? [name, samples] : [g, samples],
      );
      d.groups = Object.fromEntries(entries);
      // 同步比较引用
      d.comparisons = d.comparisons.map((c) => ({
        ...c,
        case: c.case === oldName ? name : c.case,
        control: c.control === oldName ? name : c.control,
      }));
      d.sample_labels = { ...d.sample_labels };
    });
    setSelectedGroup(name);
  };

  const removeGroup = async (name: string) => {
    if (justDragged(lastDragEndRef)) return; // 拖拽落点误压删除键
    const related = cfg.comparisons.filter((c) => c.case === name || c.control === name).length;
    const msg = related
      ? l(
          `删除分组「${name}」将同时移除 ${related} 个相关比较,确定?`,
          `Deleting group "${name}" also removes ${related} comparison(s). Continue?`,
        )
      : l(`删除分组「${name}」?`, `Delete group "${name}"?`);
    const ok = await ask(msg, { title: l("删除分组", "Delete group"), kind: "warning" });
    if (!ok) return;
    updateConfig((d) => {
      delete d.groups[name];
      d.comparisons = d.comparisons.filter(
        (c) => c.case !== name && c.control !== name,
      );
    });
  };

  const assignSample = (sample: string) => {
    const target = selectedGroup || Object.keys(cfg.groups)[0];
    if (!target) {
      showToast(l("请先添加分组", "Add a group first"), "info");
      return;
    }
    updateConfig((d) => {
      d.groups[target] = [...(d.groups[target] ?? []), sample];
    });
  };

  const unassignSample = (group: string, sample: string) => {
    updateConfig((d) => {
      d.groups[group] = (d.groups[group] ?? []).filter((s) => s !== sample);
    });
  };

  // ── 指针拖拽分配(Tauri 拦截 HTML5 DragEvent,改用 PointerEvent)──
  const dragRef = useRef<{
    sample: string;
    from: string | null;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  // 拖拽结束后的一小段时间窗内忽略破坏性按钮的 click(见 justDragged)
  const lastDragEndRef = useRef(0);
  const [dragGhost, setDragGhost] = useState<{ sample: string; x: number; y: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | "pool" | null>(null);

  const onChipPointerDown = (e: React.PointerEvent, sample: string, from: string | null) => {
    if (e.button !== 0) return;
    dragRef.current = { sample, from, startX: e.clientX, startY: e.clientY, active: false };
  };

  useEffect(() => {
    const locate = (x: number, y: number): string | "pool" | null => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const card = el?.closest<HTMLElement>("[data-group-name]");
      if (card) return card.dataset.groupName ?? null;
      if (el?.closest("[data-sample-pool]")) return "pool";
      return null;
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.active) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;
        d.active = true;
      }
      setDragGhost({ sample: d.sample, x: e.clientX, y: e.clientY });
      setDropTarget(locate(e.clientX, e.clientY));
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (d?.active) {
        lastDragEndRef.current = Date.now();
        const target = locate(e.clientX, e.clientY);
        if (target === "pool") {
          if (d.from)
            updateConfig((draft) => {
              draft.groups[d.from as string] = (draft.groups[d.from as string] ?? []).filter(
                (s) => s !== d.sample,
              );
            });
        } else if (target && target !== d.from) {
          updateConfig((draft) => {
            if (d.from)
              draft.groups[d.from] = (draft.groups[d.from] ?? []).filter((s) => s !== d.sample);
            draft.groups[target] = [...(draft.groups[target] ?? []), d.sample];
          });
        }
      }
      setDragGhost(null);
      setDropTarget(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [updateConfig]);

  // ── 比较编辑 ──
  const addComparison = () => {
    updateConfig((d) => {
      d.comparisons.push({ name: "", case: "", control: "" });
    });
  };

  const updateComparison = (idx: number, patch: Partial<Comparison>) => {
    updateConfig((d) => {
      const c = d.comparisons[idx];
      if (!c) return;
      const prev = { ...c };
      Object.assign(c, patch);
      // case/control 变化时,若名字是旧的自动名(或为空)则同步重新生成
      if (patch.case !== undefined || patch.control !== undefined) {
        if (!c.name || c.name === autoName(prev)) c.name = autoName(c);
      }
    });
  };

  // ── 运行 ──
  const ensureR = async (): Promise<boolean> => {
    const deps = await checkRDependencies();
    if (!deps.missing.length) return true;
    const consent = await ask(
      l(
        `缺少 R 包:${deps.missing.join(", ")}。是否现在安装?`,
        `Missing R packages: ${deps.missing.join(", ")}. Install now?`,
      ),
      { title: l("安装 R 依赖", "Install R packages"), kind: "info" },
    );
    if (!consent) return false;
    showToast(l("正在安装 R 包,可能需要几分钟…", "Installing R packages…"), "info");
    const r = await installRDependencies();
    if (!r.ok) {
      showToast(r.error || l("R 包安装未完成", "Install failed"), "error");
      return false;
    }
    showToast(l("R 包安装完成", "R packages installed"), "success");
    return true;
  };

  const run = async (steps: string[]) => {
    if (!(await ensureR())) return;
    await st.startRun(steps);
  };

  const running = st.runStatus === "running";
  const done = st.runStatus === "done";
  const failed = st.runStatus === "failed";
  const cancelled = st.runStatus === "cancelled";

  const lastError = [...st.runLogs].reverse().find((x) => x.level === "error")?.msg ?? "";

  return (
    <div className="rx-step">
      {/* ── 就绪状态 ── */}
      <section className={`rx-readiness${designReady ? " rx-readiness--ready" : ""}`}>
        <div className="rx-readiness-main">
          <span className="rx-readiness-kicker">
            {l("步骤 2 · 实验设计", "Step 2 · Design")}
          </span>
          <strong>
            {!importReady
              ? l("请先在「数据导入」选择 Counts 文件", "Import a counts file first")
              : !designReady
                ? l("完成分组并配置至少一个比较", "Finish grouping and add a comparison")
                : l(
                    `已就绪:${Object.keys(cfg.groups).length} 组 / ${Object.values(cfg.groups).flat().length} 样本 / ${validComps.length} 个比较`,
                    `Ready: ${Object.keys(cfg.groups).length} groups / ${Object.values(cfg.groups).flat().length} samples / ${validComps.length} comparisons`,
                  )}
          </strong>
        </div>
        <div className="rx-readiness-checks">
          <span className={importReady ? "done" : ""}>{l("数据", "Data")}</span>
          <span className={Object.keys(cfg.groups).length >= 2 ? "done" : ""}>
            {l("分组", "Groups")}
          </span>
          <span className={validComps.length >= 1 ? "done" : ""}>
            {l("比较", "Comparisons")}
          </span>
        </div>
        {hasSingleton && (
          <span className="rx-readiness-warning">
            {l(
              "存在只有 1 个样本的分组:将走无重复路径(edgeR exactTest + 固定 BCV),P 值仅用于探索性排序",
              "A group has 1 sample: the no-replicate path (edgeR exactTest, fixed BCV) will be used; P values are exploratory",
            )}
          </span>
        )}
      </section>

      {/* ── 分组 ── */}
      <section className="card">
        <div className="card-title">
          <IconLayersIntersect size={15} stroke={1.75} />
          <span>{l("实验分组", "Groups")}</span>
          <span className="rx-title-actions">
            <span style={{ fontSize: 12, color: "var(--text-3, #888)" }}>
              {l("拖拽样本到分组,或点击样本加入所选分组", "Drag samples into a group, or click to add to the selected group")}
            </span>
            <button type="button" className="btn" onClick={addGroup}>
              <IconPlus size={13} stroke={1.75} /> {l("添加分组", "Add group")}
            </button>
          </span>
        </div>
        <div className="card-body">
          <div className="rx-group-layout">
            <div
              className={`rx-pool-box${dropTarget === "pool" && dragGhost ? " drag-over" : ""}`}
              data-sample-pool
            >
              <div className="rx-box-header">
                {l("未分组样本", "Unassigned samples")}
                <span className="rx-assign-count">{pool.length}</span>
              </div>
              <div className="rx-assign-bar">
                <span className="rx-assign-count">
                  {l("点击样本加入:", "Click sample to add to:")}
                </span>
                <select
                  className="rx-assign-target"
                  value={selectedGroup}
                  onChange={(e) => setSelectedGroup(e.target.value)}
                >
                  {Object.keys(cfg.groups).map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rx-sample-pool">
                {pool.length === 0 ? (
                  <div className="rx-empty-tip">
                    {allSamples.length === 0
                      ? l("导入数据后此处显示样本", "Samples appear after import")
                      : l("全部样本已分组", "All samples assigned")}
                  </div>
                ) : (
                  pool.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="rx-sample-chip rx-sample-chip--pick"
                      onPointerDown={(e) => onChipPointerDown(e, s, null)}
                      onClick={() => {
                        if (!justDragged(lastDragEndRef)) assignSample(s);
                      }}
                    >
                      {s}
                    </button>
                  ))
                )}
              </div>
            </div>
            <div className="rx-groups-box">
              {Object.keys(cfg.groups).length === 0 && (
                <div className="rx-empty-hero rx-empty-hero--slim">
                  <IconLayersIntersect size={20} stroke={1.5} />
                  <strong>{l("还没有分组", "No groups yet")}</strong>
                  <span>{l("添加分组后,拖拽或点击左侧样本完成分配", "Add groups, then drag or click samples on the left")}</span>
                </div>
              )}
              {Object.entries(cfg.groups).map(([name, samples], i) => (
                <div
                  key={name}
                  data-group-name={name}
                  className={`rx-group-card${selectedGroup === name ? " selected" : ""}${
                    dragGhost && dropTarget === name ? " drag-over" : ""
                  }`}
                  style={{ ["--group-color" as string]: GROUP_COLORS[i % GROUP_COLORS.length] }}
                  onClick={() => setSelectedGroup(name)}
                >
                  <div className="rx-group-header">
                    <input
                      className="rx-group-name"
                      value={name}
                      onChange={(e) => renameGroup(name, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span
                      className={`rx-tag${samples.length >= 2 ? " rx-tag--ok" : " rx-tag--warn"}`}
                      title={samples.length >= 2 ? l("有重复", "replicated") : l("单样本(无重复路径)", "single sample (no-replicate path)")}
                    >
                      n={samples.length}
                    </span>
                    <button
                      type="button"
                      className="rx-icon-btn rx-icon-btn--danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeGroup(name);
                      }}
                    >
                      <IconTrash size={13} stroke={1.75} />
                    </button>
                  </div>
                  <div className="rx-group-dropzone">
                    {samples.length === 0 ? (
                      <span className="rx-empty-tip">{l("拖拽或点击左侧样本加入", "Drag or click samples on the left")}</span>
                    ) : (
                      samples.map((s) => (
                        <span
                          key={s}
                          className="rx-sample-chip rx-sample-chip--group"
                          onPointerDown={(e) => onChipPointerDown(e, s, name)}
                        >
                          {s}
                          <button
                            type="button"
                            className="rx-remove-x"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (justDragged(lastDragEndRef)) return; // 拖拽落点压到移除键时忽略
                              unassignSample(name, s);
                            }}
                          >
                            <IconX size={10} stroke={2} />
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── 比较 ── */}
      <section className="card">
        <div className="card-title">
          <IconFlask size={15} stroke={1.75} />
          <span>{l("差异比较", "Comparisons")}</span>
          <span className="rx-title-actions">
            <button type="button" className="btn" onClick={addComparison}>
              <IconPlus size={13} stroke={1.75} /> {l("添加比较", "Add comparison")}
            </button>
          </span>
        </div>
        <div className="card-body">
          <p className="rx-comp-tip">
            {l(
              "log2FC 按 case 相对 control 计算;比较名将用作输出文件名。",
              "log2FC = case vs control; the name is used for output files.",
            )}
          </p>
          {cfg.comparisons.length === 0 ? (
            <div className="rx-empty-tip">{l("还没有比较,点击「添加比较」", "No comparisons yet")}</div>
          ) : (
            <div className="rx-table-wrap">
              <table className="rx-table rx-table--comps">
                <thead>
                  <tr>
                    <th>{l("名称", "Name")}</th>
                    <th>{l("Case", "Case")}</th>
                    <th />
                    <th>{l("Control", "Control")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {cfg.comparisons.map((c, i) => {
                    const invalid =
                      !c.case || !c.control || c.case === c.control;
                    return (
                      <tr key={i} className={invalid ? "rx-invalid-row" : ""}>
                        <td>
                          <input
                            type="text"
                            value={c.name}
                            placeholder={autoName(c)}
                            onChange={(e) => updateComparison(i, { name: e.target.value })}
                          />
                        </td>
                        <td>
                          <select
                            value={c.case}
                            onChange={(e) => updateComparison(i, { case: e.target.value })}
                          >
                            <option value="">—</option>
                            {Object.keys(cfg.groups).map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="rx-versus">vs</td>
                        <td>
                          <select
                            value={c.control}
                            onChange={(e) => updateComparison(i, { control: e.target.value })}
                          >
                            <option value="">—</option>
                            {Object.keys(cfg.groups).map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="rx-icon-btn rx-icon-btn--danger"
                            onClick={() =>
                              updateConfig((d) => {
                                d.comparisons.splice(i, 1);
                              })
                            }
                          >
                            <IconTrash size={13} stroke={1.75} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ── 分析参数 ── */}
      <Collapse
        title={l("分析参数", "Analysis parameters")}
        subtitle={l(
          "阈值与统计引擎;默认值即参考脚本默认配置",
          "Thresholds & engine; defaults follow the reference script",
        )}
      >
        <div className="card-body rx-param-grid">
          <SelectField
            label={l("有重复路径的引擎", "Replicate-path engine")}
            value={cfg.de.method}
            onChange={(v) =>
              updateConfig((d) => {
                d.de.method = v;
              })
            }
            options={[
              { value: "deseq2", label: l("DESeq2(Wald 检验)", "DESeq2 (Wald)") },
              { value: "edger", label: l("edgeR(QL F 检验)", "edgeR (QL F-test)") },
            ]}
            hint={l(
              "两组都 ≥2 个样本时使用;任一组只有 1 个样本时固定走 edgeR exactTest + BCV",
              "Used when both groups have ≥2 samples; singleton groups always use edgeR exactTest + BCV",
            )}
          />
          <NumField
            label={l("显著性阈值 padj", "Significance padj")}
            value={cfg.de.padj}
            step={0.01}
            min={0}
            max={1}
            onChange={(v) =>
              updateConfig((d) => {
                if (v !== undefined) d.de.padj = v;
              })
            }
          />
          <NumField
            label={l("|log2FC| 阈值", "|log2FC| cutoff")}
            value={cfg.de.log2fc}
            step={0.1}
            min={0}
            onChange={(v) =>
              updateConfig((d) => {
                if (v !== undefined) d.de.log2fc = v;
              })
            }
          />
          <NumField
            label={l("BCV(无重复路径)", "BCV (no-replicate path)")}
            value={cfg.de.bcv}
            step={0.05}
            min={0}
            onChange={(v) =>
              updateConfig((d) => {
                if (v !== undefined) d.de.bcv = v;
              })
            }
            hint={l("人 0.4 | 同基因型模式生物 0.1 | 技术重复 0.01", "human 0.4 | isogenic 0.1 | technical 0.01")}
          />
          <SelectField
            label={l("log2FC 收缩(DESeq2)", "LFC shrinkage (DESeq2)")}
            value={cfg.de.shrink}
            onChange={(v) =>
              updateConfig((d) => {
                d.de.shrink = v;
              })
            }
            options={[
              { value: "none", label: l("不收缩", "none") },
              { value: "apeglm", label: "apeglm" },
              { value: "ashr", label: "ashr" },
            ]}
          />
          <SelectField
            label={l("低表达过滤", "Low-expression filter")}
            value={cfg.de.filter.method}
            onChange={(v) =>
              updateConfig((d) => {
                d.de.filter.method = v;
              })
            }
            options={[
              { value: "filterByExpr", label: "filterByExpr(edgeR)" },
              { value: "min_count", label: l("最小计数", "min count") },
              { value: "none", label: l("不过滤", "none") },
            ]}
          />
          {cfg.de.filter.method !== "none" && (
            <>
              <NumField
                label={l("最小计数 min.count", "min.count")}
                value={cfg.de.filter.min_count}
                step={1}
                min={0}
                onChange={(v) =>
                  updateConfig((d) => {
                    if (v !== undefined) d.de.filter.min_count = v;
                  })
                }
              />
              {cfg.de.filter.method === "filterByExpr" && (
                <NumField
                  label={l("最小总和 min.total.count", "min.total.count")}
                  value={cfg.de.filter.min_total_count}
                  step={1}
                  min={0}
                  onChange={(v) =>
                    updateConfig((d) => {
                      if (v !== undefined) d.de.filter.min_total_count = v;
                    })
                  }
                />
              )}
              {cfg.de.filter.method === "min_count" && (
                <NumField
                  label={l("达标样本数 min.samples", "min.samples")}
                  value={cfg.de.filter.min_samples}
                  step={1}
                  min={1}
                  onChange={(v) =>
                    updateConfig((d) => {
                      if (v !== undefined) d.de.filter.min_samples = v;
                    })
                  }
                />
              )}
            </>
          )}
        </div>
      </Collapse>

      {/* ── 运行中心 ── */}
      <section className="card">
        <div className="card-body">
          <div className="rx-summary-row">
            <div className="rx-summary-items">
              <div className="rx-summary-item">
                <strong>{Object.keys(cfg.groups).length}</strong>
                <span>{l("分组", "groups")}</span>
              </div>
              <div className="rx-summary-item">
                <strong>{Object.values(cfg.groups).flat().length}</strong>
                <span>{l("样本", "samples")}</span>
              </div>
              <div className="rx-summary-item">
                <strong>{validComps.length}</strong>
                <span>{l("比较", "comparisons")}</span>
              </div>
              <div className="rx-summary-item rx-summary-item--wide">
                <strong>{hasSingleton ? l("无重复路径", "no-replicate") : l("有重复路径", "replicate")}</strong>
                <span>
                  {hasSingleton
                    ? `edgeR exactTest · BCV=${cfg.de.bcv}`
                    : cfg.de.method === "deseq2"
                      ? "DESeq2 Wald"
                      : "edgeR QLF"}
                </span>
              </div>
            </div>
          </div>
          <div className="rx-run-bar">
            <div className="rx-run-left">
              <button
                type="button"
                className="btn btn-primary rx-run-btn"
                disabled={running || !importReady || !designReady}
                onClick={() => void run(["de"])}
              >
                <IconPlayerPlay size={14} stroke={1.75} />
                {l("运行差异分析", "Run DE analysis")}
              </button>
              <button
                type="button"
                className="btn rx-run-btn"
                disabled={running || !importReady || !designReady}
                onClick={() => void run(["de", "heatmap", "plots"])}
                title={l("差异分析 + 全部图形一次完成", "DE + all figures in one go")}
              >
                {l("全部运行", "Run all")}
              </button>
              {running && (
                <button type="button" className="btn rx-cancel-btn" onClick={() => void st.cancelRun()}>
                  <IconPlayerStop size={14} stroke={1.75} /> {l("取消", "Cancel")}
                </button>
              )}
              <span
                className={`rx-tag${
                  running ? " rx-tag--run" : done ? " rx-tag--ok" : failed ? " rx-tag--err" : ""
                }`}
              >
                {running
                  ? l("运行中", "Running")
                  : done
                    ? l("完成", "Done")
                    : failed
                      ? l("失败", "Failed")
                      : cancelled
                        ? l("已取消", "Cancelled")
                        : l("待运行", "Idle")}
              </span>
              {running && <span className="rx-elapsed">{st.elapsedSec}s</span>}
            </div>
          </div>

          {(st.runLogs.length > 0 || running) && <LogArea />}

          {done && (
            <div className="rx-done-panel">
              <div className="rx-done-head">
                {l("差异分析完成", "DE analysis finished")}
              </div>
              {st.deSummary && <DeSummaryTable />}
              <div className="rx-done-actions">
                <button type="button" className="btn btn-primary" onClick={goPlots}>
                  <IconChartDots size={14} stroke={1.75} /> {l("前往绘图导出", "Go to plots")}
                </button>
                {st.resultDir && (
                  <button type="button" className="btn" onClick={() => void openInShell(st.resultDir)}>
                    <IconFolderOpen size={13} stroke={1.75} /> {l("打开结果目录", "Open results")}
                  </button>
                )}
              </div>
            </div>
          )}
          {failed && (
            <div className="rx-failed-panel">
              <div className="rx-done-head rx-done-head--err">{l("运行失败", "Run failed")}</div>
              {lastError && <code className="rx-last-error">{lastError}</code>}
            </div>
          )}
          {cancelled && (
            <div className="rx-cancelled-panel">
              <div className="rx-done-head rx-done-head--warn">{l("已取消(已生成的文件保留)", "Cancelled (files kept)")}</div>
            </div>
          )}
        </div>
      </section>

      {/* 拖拽跟随幽灵标签 */}
      {dragGhost &&
        createPortal(
          <div className="rx-drag-ghost" style={{ left: dragGhost.x, top: dragGhost.y }}>
            {dragGhost.sample}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** DE_summary 表格 */
function DeSummaryTable() {
  const { language } = useLanguage();
  const l = (zh: string, en: string) => (language === "en" ? en : zh);
  const st = useRnaSeq();
  if (!st.deSummary) return null;
  return (
    <div className="rx-table-wrap">
      <table className="rx-table">
        <thead>
          <tr>
            <th>{l("比较", "Comparison")}</th>
            <th>{l("路径", "Path")}</th>
            <th>{l("方法", "Method")}</th>
            <th>{l("基因数", "Tested")}</th>
            <th style={{ color: "#c0392b" }}>Up</th>
            <th style={{ color: "#2471a3" }}>Down</th>
          </tr>
        </thead>
        <tbody>
          {st.deSummary.map((r) => (
            <tr key={r.comparison}>
              <td>{r.comparison}</td>
              <td>
                <span className={`rx-tag${r.path === "noreplicate" ? " rx-tag--warn" : " rx-tag--ok"}`}>
                  {r.path === "noreplicate" ? l("无重复", "no-replicate") : l("有重复", "replicate")}
                </span>
              </td>
              <td style={{ fontSize: 12 }}>{r.method}</td>
              <td>{r.genes_tested.toLocaleString()}</td>
              <td>{r.Up}</td>
              <td>{r.Down}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 运行日志区(自动滚动 + 复制) */
function LogArea() {
  const st = useRnaSeq();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [st.runLogs]);
  return (
    <div className="rx-log-section">
      <div className="rx-log-head">
        <span>{st.runLogs.length} 条日志</span>
        <button
          type="button"
          className="rx-icon-btn"
          title="复制日志"
          onClick={() => {
            void navigator.clipboard.writeText(st.runLogs.map((x) => x.msg).join("\n"));
            showToast("日志已复制", "success");
          }}
        >
          <IconCopy size={13} stroke={1.75} />
        </button>
      </div>
      <div className="rx-log-area" ref={ref} role="log">
        {st.runLogs.map((x, i) => (
          <div key={i} className={`rx-log-line ${x.level}`}>
            {x.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
