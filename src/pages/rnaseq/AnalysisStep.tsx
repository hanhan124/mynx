/**
 * 步骤 2:差异分析 — 实验设计(拖拽分组)、差异比较、批次设置(可选)、
 * 分析参数、运行中心(实时日志/取消/历史记录)。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ask, open } from "@tauri-apps/plugin-dialog";
import {
  IconX,
  IconPlus,
  IconWand,
  IconGitCompare,
  IconTrash,
  IconStack2,
  IconPlayerPlay,
  IconFolderOpen,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconFileSpreadsheet,
  IconPhoto,
  IconRefresh,
  IconHistory,
  IconCopy,
  IconPalette,
  IconPlayerStop,
  IconSearch,
} from "@tabler/icons-react";
import { showToast } from "@/components/Toast";
import { batchConfounded, useRnaSeq, validComparisonsOf } from "./store";
import { Collapse, NumField, SelectField } from "./fields";
import { listRuns } from "@/lib/rnaseq/runs";
import { joinPath, openInShell } from "@/lib/rnaseq/io";
import type { RunItem } from "@/lib/rnaseq/types";

// 分组色相(按组序轮转,macOS 系统色)
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

export default function AnalysisStep({ goPlots }: { goPlots: () => void }) {
  const st = useRnaSeq();
  const {
    config,
    updateConfig,
    importData,
    successfulImportPath,
    rscriptFound,
    recheckRscript,
    runStatus,
    runLogs,
    stepsDone,
    stepsTotal,
    runOutputDir,
    elapsedSec,
    startRun,
    cancelRun,
    remapGroup,
    removeGroupRefs,
    loadFromPath,
    hasResult,
    checkResult,
  } = st;

  const [search, setSearch] = useState("");
  const [editingNames, setEditingNames] = useState<Record<string, string>>({});
  const [dragData, setDragData] = useState<{
    sample: string;
    fromGroup: string | null;
  } | null>(null);
  const [dragOverZone, setDragOverZone] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const logAreaRef = useRef<HTMLDivElement>(null);

  const allSamples = importData?.sample_cols ?? [];

  const groupList = useMemo(() => {
    const all = [...new Set([...config.group_order, ...Object.keys(config.groups)])];
    return all
      .filter((n) => config.groups[n] !== undefined)
      .map((name) => ({
        name,
        display: config.group_display[name] || name,
        samples: config.groups[name] || [],
        selected: config.selected_groups.includes(name),
      }));
  }, [config.group_order, config.groups, config.group_display, config.selected_groups]);

  const stats = useMemo(() => {
    const selected = groupList.filter((g) => g.selected);
    const singleCount = selected.filter((g) => g.samples.length === 1).length;
    const emptyCount = selected.filter((g) => g.samples.length === 0).length;
    const engine = config.params.engine || "auto";
    const mode =
      singleCount > 0
        ? "edgeR(单重复·TREAT)"
        : engine === "edger_qlf"
          ? "edgeR(QL F-test)"
          : "DESeq2(Wald)";
    return {
      total: groupList.length,
      selected: selected.length,
      singleCount,
      emptyCount,
      mode,
      comparisons: config.comparisons.length,
    };
  }, [groupList, config.params.engine, config.comparisons.length]);

  const validComps = useMemo(() => validComparisonsOf(config), [config]);
  const invalidCompCount = config.comparisons.length - validComps.length;

  // ── 拖拽 ──
  const moveSample = useCallback(
    (sample: string, fromGroup: string | null, toGroup: string | null) => {
      if (fromGroup === toGroup) return;
      updateConfig((c) => {
        if (fromGroup && c.groups[fromGroup]) {
          c.groups[fromGroup] = c.groups[fromGroup].filter((s) => s !== sample);
        }
        if (toGroup) {
          if (!c.groups[toGroup]) c.groups[toGroup] = [];
          if (!c.groups[toGroup].includes(sample)) c.groups[toGroup].push(sample);
        }
      });
    },
    [updateConfig],
  );

  // ── 分组管理 ──
  const autoGroupByPrefix = useCallback(async () => {
    const used = new Set(groupList.flatMap((g) => g.samples));
    const unassigned = allSamples.filter((s) => !used.has(s));
    if (unassigned.length === 0) {
      showToast("所有样本都已分组", "info");
      return;
    }
    const prefixOf = (s: string) => {
      const m = s.match(/^(.+?)[_\-.\s]/);
      if (m && m[1]) return m[1];
      const d = s.match(/^([^0-9]+)/);
      return d && d[1] ? d[1] : s;
    };
    const groups = new Map<string, string[]>();
    for (const s of unassigned) {
      const p = prefixOf(s);
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p)!.push(s);
    }
    const preview = [...groups.entries()]
      .map(([p, ss]) => `${p}:${ss.length} 样本`)
      .join(" · ");
    const ok = await ask(
      `将按样本名前缀自动创建 ${groups.size} 个组:\n${preview}\n\n已有分组与比较保持不变,继续?`,
      { title: "自动分组", kind: "info" },
    );
    if (!ok) return;
    updateConfig((c) => {
      for (const [p, ss] of groups.entries()) {
        let name = p;
        let n = 1;
        while (c.groups[name]) name = `${p}_${++n}`;
        c.groups[name] = ss;
        c.group_display[name] = p;
        c.group_order.push(name);
        c.selected_groups.push(name);
      }
    });
    showToast(`已创建 ${groups.size} 个组,请核对后勾选纳入`, "success");
  }, [groupList, allSamples, updateConfig]);

  const addGroup = () => {
    updateConfig((c) => {
      let n = Object.keys(c.groups).length + 1;
      let name = `Group_${n}`;
      while (c.groups[name]) name = `Group_${++n}`;
      c.groups[name] = [];
      c.group_display[name] = name;
      c.group_order.push(name);
      c.selected_groups.push(name);
    });
  };

  const delGroup = async (name: string) => {
    const ok = await ask(
      `删除组「${name}」?样本将回到样本池,引用它的比较与绘图设置也会被清理。`,
      { title: "确认删除", kind: "warning" },
    );
    if (!ok) return;
    updateConfig((c) => {
      delete c.groups[name];
      delete c.group_display[name];
      c.group_order = c.group_order.filter((g) => g !== name);
      c.selected_groups = c.selected_groups.filter((g) => g !== name);
      c.comparisons = c.comparisons.filter(([t, ctrl]) => t !== name && ctrl !== name);
    });
    removeGroupRefs(name);
    showToast(`已删除组「${name}」`, "success");
  };

  const onNameChange = async (oldName: string, rawNew: string) => {
    setEditingNames((prev) => {
      const next = { ...prev };
      delete next[oldName];
      return next;
    });
    const trimmed = rawNew.trim();
    if (!trimmed || trimmed === oldName) return;
    if (config.groups[trimmed]) {
      const ok = await ask(`组名「${trimmed}」已存在,合并样本?`, {
        title: "合并分组",
        kind: "warning",
      });
      if (!ok) return;
      updateConfig((c) => {
        c.groups[trimmed] = [...new Set([...c.groups[trimmed], ...c.groups[oldName]])];
        delete c.groups[oldName];
        c.group_order = c.group_order.filter((g) => g !== oldName);
        if (c.selected_groups.includes(oldName) && !c.selected_groups.includes(trimmed)) {
          c.selected_groups.push(trimmed);
        }
        c.selected_groups = c.selected_groups.filter((g) => g !== oldName);
        if (!c.group_display[trimmed])
          c.group_display[trimmed] = c.group_display[oldName];
        delete c.group_display[oldName];
        const remap = (x: string) => (x === oldName ? trimmed : x);
        c.comparisons = c.comparisons.map(
          ([t, ctrl]) => [remap(t), remap(ctrl)] as [string, string],
        );
      });
      remapGroup(oldName, trimmed);
      showToast(`已合并到「${trimmed}」`, "success");
      return;
    }
    updateConfig((c) => {
      c.groups[trimmed] = c.groups[oldName];
      delete c.groups[oldName];
      c.group_display[trimmed] = c.group_display[oldName];
      delete c.group_display[oldName];
      c.group_order = c.group_order.map((g) => (g === oldName ? trimmed : g));
      c.selected_groups = c.selected_groups.map((g) => (g === oldName ? trimmed : g));
      const remap = (x: string) => (x === oldName ? trimmed : x);
      c.comparisons = c.comparisons.map(
        ([t, ctrl]) => [remap(t), remap(ctrl)] as [string, string],
      );
    });
    remapGroup(oldName, trimmed);
  };

  // ── 比较管理 ──
  const autoGenerate = () => {
    const groups = config.selected_groups;
    if (groups.length < 2) {
      showToast("至少需要 2 个选定的组", "info");
      return;
    }
    const comps: [string, string][] = [];
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        comps.push([groups[j], groups[i]]); // 后者为 Treatment(分子)
      }
    }
    updateConfig((c) => {
      c.comparisons = comps;
    });
    showToast(
      `已生成 ${comps.length} 个两两比较(左 Control 分母 / 右 Treatment 分子)`,
      "success",
    );
  };

  // ── 批次 ──
  const batchList = useMemo(
    () => Object.entries(config.batches).map(([name, samples]) => ({ name, samples })),
    [config.batches],
  );
  const unbatchedSamples = useMemo(() => {
    const used = new Set(Object.values(config.batches).flat());
    return allSamples.filter((s) => !used.has(s));
  }, [config.batches, allSamples]);
  const [batchDrag, setBatchDrag] = useState<string | null>(null);

  const batchDrop = (name: string) => {
    const s = batchDrag;
    setBatchDrag(null);
    if (!s) return;
    updateConfig((c) => {
      for (const b of Object.keys(c.batches)) {
        c.batches[b] = c.batches[b].filter((x) => x !== s);
      }
      if (name && !c.batches[name].includes(s)) c.batches[name].push(s);
    });
  };

  // ── 运行 ──
  const statusText = {
    idle: "空闲",
    running: "运行中",
    done: "完成",
    failed: "失败",
    cancelled: "已取消",
  }[runStatus];
  const statusCls = {
    idle: "",
    running: "rx-tag--run",
    done: "rx-tag--ok",
    failed: "rx-tag--err",
    cancelled: "rx-tag--warn",
  }[runStatus];
  const elapsedText =
    elapsedSec >= 60
      ? `${Math.floor(elapsedSec / 60)} 分 ${elapsedSec % 60} 秒`
      : `${elapsedSec} 秒`;

  useEffect(() => {
    if (logAreaRef.current)
      logAreaRef.current.scrollTop = logAreaRef.current.scrollHeight;
  }, [runLogs.length]);

  const startRunChecked = async () => {
    const c = config;
    if (!c.data_file) {
      showToast("请先在「数据导入」中选择并导入数据", "info");
      return;
    }
    if (!importData || c.data_file !== successfulImportPath) {
      showToast("数据文件尚未成功导入,请回到「数据导入」重新导入", "info");
      return;
    }
    if (rscriptFound === false) {
      const ok = await recheckRscript();
      if (!ok) {
        showToast("未检测到 Rscript,无法运行分析。请安装 R 后点击重新检测", "error");
        return;
      }
    }
    if (c.selected_groups.length < 2) {
      showToast("至少需要 2 个「纳入」的组(上方实验设计)", "info");
      return;
    }
    const emptySelected = groupList.filter((g) => g.selected && g.samples.length === 0);
    if (emptySelected.length > 0) {
      showToast(
        `组「${emptySelected.map((g) => g.name).join("、")}」没有样本,请先分配样本或取消纳入`,
        "info",
      );
      return;
    }
    if (c.comparisons.length === 0) {
      showToast("至少需要 1 个比较(上方差异比较)", "info");
      return;
    }
    if (invalidCompCount > 0) {
      showToast(
        `有 ${invalidCompCount} 行比较无效(空行/自比/引用了未纳入的组),请先修正`,
        "info",
      );
      return;
    }
    const nBatches = Object.keys(c.batches || {}).length;
    if (nBatches > 0) {
      const assigned = new Set(Object.values(c.batches).flat());
      const selSamples = groupList.filter((g) => g.selected).flatMap((g) => g.samples);
      const noBatch = selSamples.filter((s) => !assigned.has(s));
      if (noBatch.length > 0) {
        showToast(`样本 ${noBatch.join("、")} 已纳入分析但未分配批次`, "info");
        return;
      }
      if (batchConfounded(c)) {
        showToast(
          "批次与分组完全混淆,无法同时估计批次与分组效应;请调整或清空批次",
          "info",
        );
        return;
      }
    }
    await startRun();
    showToast("差异分析已启动,日志见下方;完成后到「绘图导出」生成图表", "success");
  };

  const doCancelRun = async () => {
    if (runStatus !== "running") return;
    const ok = await ask("确定取消当前分析?R 进程会被终止,已生成的文件保留在输出目录。", {
      title: "取消运行",
      kind: "warning",
    });
    if (!ok) return;
    setCancelling(true);
    await cancelRun();
    setCancelling(false);
  };

  const copyLogs = async () => {
    const text = runLogs.map((l) => l.msg).join("\n");
    if (!text) {
      showToast("暂无日志可复制", "info");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast(`已复制 ${runLogs.length} 行日志`, "success");
    } catch {
      showToast("复制失败,请手动选择日志文本", "error");
    }
  };

  const lastError = useMemo(() => {
    const errs = runLogs.filter((l) => l.level === "error");
    return errs[errs.length - 1]?.msg ?? "";
  }, [runLogs]);

  // ── 历史记录 ──
  const loadRunsList = useCallback(async () => {
    try {
      const r = await listRuns(config.output_dir);
      setRuns(r);
    } catch {
      setRuns([]);
    }
  }, [config.output_dir]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRunsList();
  }, [loadRunsList]);
  useEffect(() => {
    if (runStatus === "done" || runStatus === "failed" || runStatus === "cancelled") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadRunsList();
    }
  }, [runStatus, loadRunsList]);

  const applyRunForPlots = async (run: RunItem) => {
    const root = joinPath(run.base_dir || config.output_dir || "", run.name);
    if (!root) {
      showToast("未找到该运行的输出目录", "error");
      return;
    }
    const ok = await loadFromPath(root, { mergeParams: true });
    if (ok) goPlots();
    else showToast("该目录未找到 DEG 结果 Excel,无法用于绘图", "info");
  };

  const browseResultForPlots = async () => {
    const picked = await open({
      directory: true,
      multiple: false,
      title: "选择差异分析结果目录(含 RNAseq_Analysis_Results.xlsx)",
      defaultPath: config.output_dir || undefined,
    });
    if (!picked) return;
    const p = Array.isArray(picked) ? picked[0] : picked;
    const ok = await loadFromPath(p, { mergeParams: true });
    if (ok) goPlots();
  };

  const poolSamples = useMemo(() => {
    const used = new Set(groupList.flatMap((g) => g.samples));
    let samples = allSamples.filter((s) => !used.has(s));
    if (search)
      samples = samples.filter((s) => s.toLowerCase().includes(search.toLowerCase()));
    return samples;
  }, [groupList, allSamples, search]);

  const progressIndeterminate = runStatus === "running" && stepsTotal <= 1;

  return (
    <div className="rx-step">
      {/* ① 实验设计 */}
      <div className="card">
        <div className="card-title">
          <span className="step-num">1</span>
          <span>实验设计</span>
          <span className="rx-title-actions">
            <button
              className="btn"
              onClick={autoGroupByPrefix}
              title="按样本名前缀自动建组"
            >
              <IconStack2 size={13} stroke={1.75} /> 自动分组
            </button>
            <button className="btn" onClick={addGroup}>
              <IconPlus size={13} stroke={1.75} /> 新建组
            </button>
          </span>
        </div>
        <div className="card-body">
          <div className="rx-group-layout">
            <div className="rx-pool-box">
              <div className="rx-box-header">
                <span>样本池</span>
                <div className="rx-search-box rx-search-box--sm">
                  <IconSearch size={12} stroke={1.75} />
                  <input
                    type="text"
                    placeholder="搜索"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div
                className={`rx-sample-pool${dragOverZone === "__pool__" ? " rx-drag-over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverZone("__pool__");
                }}
                onDragLeave={() => setDragOverZone(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragData) moveSample(dragData.sample, dragData.fromGroup, null);
                  setDragData(null);
                  setDragOverZone(null);
                }}
              >
                {poolSamples.map((s) => (
                  <span
                    key={s}
                    className="rx-sample-chip"
                    draggable
                    onDragStart={() => setDragData({ sample: s, fromGroup: null })}
                    onDragEnd={() => {
                      setDragData(null);
                      setDragOverZone(null);
                    }}
                  >
                    {s}
                  </span>
                ))}
                {allSamples.length === 0 && (
                  <span className="rx-empty-tip">
                    请先在「数据导入」页导入 Counts 文件,样本会出现在这里
                  </span>
                )}
                {allSamples.length > 0 && poolSamples.length === 0 && (
                  <span className="rx-empty-tip">无未分组样本</span>
                )}
              </div>
            </div>

            <div className="rx-groups-box">
              {groupList.map((g) => {
                const colorIdx = Math.max(0, config.group_order.indexOf(g.name));
                const color = GROUP_COLORS[colorIdx % GROUP_COLORS.length];
                return (
                  <div
                    key={g.name}
                    className="rx-group-card"
                    style={{ "--group-color": color } as React.CSSProperties}
                  >
                    <div className="rx-group-header">
                      <input
                        className="rx-group-name"
                        type="text"
                        value={editingNames[g.name] ?? g.name}
                        placeholder="组名"
                        onChange={(e) =>
                          setEditingNames((prev) => ({
                            ...prev,
                            [g.name]: e.target.value,
                          }))
                        }
                        onBlur={(e) => void onNameChange(g.name, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                      />
                      <span
                        className={`rx-tag ${
                          g.samples.length === 0
                            ? "rx-tag--err"
                            : g.samples.length < 2
                              ? "rx-tag--warn"
                              : "rx-tag--ok"
                        }`}
                      >
                        {g.samples.length === 0
                          ? "空组"
                          : g.samples.length < 2
                            ? "单重复"
                            : `${g.samples.length} 重复`}
                      </span>
                      <label className="rx-include-check">
                        <input
                          type="checkbox"
                          checked={g.selected}
                          onChange={() =>
                            updateConfig((c) => {
                              c.selected_groups = g.selected
                                ? c.selected_groups.filter((n) => n !== g.name)
                                : [...c.selected_groups, g.name];
                            })
                          }
                        />
                        纳入
                      </label>
                      <button
                        className="rx-icon-btn rx-icon-btn--danger"
                        title={`删除组 ${g.name}`}
                        onClick={() => void delGroup(g.name)}
                      >
                        <IconTrash size={13} stroke={1.75} />
                      </button>
                    </div>
                    <div
                      className={`rx-group-dropzone${dragOverZone === g.name ? " rx-drag-over" : ""}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverZone(g.name);
                      }}
                      onDragLeave={() => setDragOverZone(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragData)
                          moveSample(dragData.sample, dragData.fromGroup, g.name);
                        setDragData(null);
                        setDragOverZone(null);
                      }}
                    >
                      {g.samples.map((s) => (
                        <span
                          key={s}
                          className="rx-sample-chip rx-sample-chip--group"
                          draggable
                          onDragStart={() =>
                            setDragData({ sample: s, fromGroup: g.name })
                          }
                          onDragEnd={() => {
                            setDragData(null);
                            setDragOverZone(null);
                          }}
                        >
                          {s}
                          <button
                            className="rx-remove-x"
                            type="button"
                            aria-label={`从${g.name}移除${s}`}
                            onClick={() => moveSample(s, g.name, null)}
                          >
                            <IconX size={11} stroke={2.2} />
                          </button>
                        </span>
                      ))}
                      {g.samples.length === 0 && (
                        <span className="rx-empty-tip">拖拽样本到此处</span>
                      )}
                    </div>
                  </div>
                );
              })}
              {groupList.length === 0 && (
                <div className="rx-empty-hero rx-empty-hero--slim">
                  <IconStack2 size={22} stroke={1.5} />
                  <strong>{allSamples.length === 0 ? "先导入数据" : "还没有分组"}</strong>
                  <span>
                    {allSamples.length === 0
                      ? "到「数据导入」选择 Counts 文件,导入后即可在这里分组。"
                      : "点击「自动分组」按样本名前缀建组,或「新建组」手动拖拽。"}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="rx-stats-bar">
            共 {stats.total} 组 · 选定 {stats.selected} 组 · {stats.comparisons} 个比较 ·
            分析模式:
            <b>{stats.mode}</b>
            {stats.singleCount > 0 && (
              <span className="rx-warn-text">
                ({stats.singleCount} 组为单样本,将走 edgeR 单重复流程)
              </span>
            )}
            {stats.emptyCount > 0 && (
              <span className="rx-warn-text">
                ({stats.emptyCount} 个空组被纳入,需先分配样本)
              </span>
            )}
          </div>

          {/* 差异比较 */}
          <div className="rx-comp-block">
            <div className="rx-comp-head">
              <div>
                <h4>差异比较</h4>
                <p>每个比较输出一套 DEG 结果,Treatment 为分子、Control 为分母</p>
              </div>
              <div className="rx-title-actions">
                <button className="btn" onClick={autoGenerate}>
                  <IconWand size={13} stroke={1.75} /> 自动生成全两两
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    updateConfig((c) => {
                      c.comparisons.push(["", ""]);
                    })
                  }
                >
                  <IconPlus size={13} stroke={1.75} /> 添加比较
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    updateConfig((c) => {
                      c.comparisons = [];
                    })
                  }
                >
                  清空
                </button>
              </div>
            </div>
            {config.comparisons.length === 0 ? (
              <div className="rx-empty-hero rx-empty-hero--slim">
                <IconGitCompare size={22} stroke={1.5} />
                <strong>还没有比较设置</strong>
                <span>添加一行,或自动生成所有选定分组之间的两两比较。</span>
              </div>
            ) : (
              <div className="rx-table-wrap">
                <table className="rx-table rx-table--comps">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>#</th>
                      <th>Treatment(分子)</th>
                      <th style={{ width: 44 }}></th>
                      <th>Control(分母)</th>
                      <th style={{ width: 56 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {config.comparisons.map((row, i) => {
                      const invalid =
                        !row[0] ||
                        !row[1] ||
                        row[0] === row[1] ||
                        !config.selected_groups.includes(row[0]) ||
                        !config.selected_groups.includes(row[1]);
                      return (
                        <tr key={i} className={invalid ? "rx-invalid-row" : ""}>
                          <td>{i + 1}</td>
                          <td>
                            <select
                              value={row[0]}
                              onChange={(e) =>
                                updateConfig((c) => {
                                  c.comparisons[i][0] = e.target.value;
                                })
                              }
                            >
                              <option value="">选择处理组</option>
                              {config.selected_groups.map((g) => (
                                <option key={g} value={g}>
                                  {g}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="rx-versus">vs</td>
                          <td>
                            <select
                              value={row[1]}
                              onChange={(e) =>
                                updateConfig((c) => {
                                  c.comparisons[i][1] = e.target.value;
                                })
                              }
                            >
                              <option value="">选择对照组</option>
                              {config.selected_groups.map((g) => (
                                <option key={g} value={g}>
                                  {g}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <button
                              className="rx-icon-btn rx-icon-btn--danger"
                              aria-label={`删除第 ${i + 1} 行比较`}
                              onClick={() =>
                                updateConfig((c) => {
                                  c.comparisons.splice(i, 1);
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
            <p className="rx-comp-tip">
              提示:比较只使用勾选了「纳入」的组;删除组会同步清理引用;
              {invalidCompCount > 0
                ? `当前有 ${invalidCompCount} 行无效(红色),运行前需修正。`
                : "当前所有比较行有效。"}
            </p>
          </div>
        </div>
      </div>

      {/* ② 批次设置 */}
      <Collapse
        title={
          <span>
            <span className="step-num">2</span> 批次设置(可选)
          </span>
        }
        subtitle={
          Object.keys(config.batches).length > 0
            ? `${Object.keys(config.batches).length} 个批次 · 设计 ~ batch + condition`
            : "未启用(~ condition 单因素);多批次/多平台数据建议设置"
        }
      >
        <div className="card-body" style={{ paddingTop: 0 }}>
          <div className="rx-title-actions" style={{ marginBottom: 10 }}>
            <button
              className="btn"
              onClick={() =>
                updateConfig((c) => {
                  let n = Object.keys(c.batches).length + 1;
                  let name = `Batch_${n}`;
                  while (c.batches[name]) name = `Batch_${++n}`;
                  c.batches[name] = [];
                })
              }
            >
              <IconPlus size={13} stroke={1.75} /> 新建批次
            </button>
            {Object.keys(config.batches).length > 0 && (
              <button
                className="btn"
                onClick={() =>
                  updateConfig((c) => {
                    c.batches = {};
                  })
                }
              >
                清空
              </button>
            )}
          </div>
          <div className="rx-group-layout">
            <div className="rx-pool-box">
              <div className="rx-box-header">
                <span>未分配样本</span>
              </div>
              <div
                className={`rx-sample-pool rx-sample-pool--batch${dragOverZone === "__batchpool__" ? " rx-drag-over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverZone("__batchpool__");
                }}
                onDragLeave={() => setDragOverZone(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  batchDrop("");
                  setDragOverZone(null);
                }}
              >
                {unbatchedSamples.map((s) => (
                  <span
                    key={s}
                    className="rx-sample-chip"
                    draggable
                    onDragStart={() => setBatchDrag(s)}
                    onDragEnd={() => setBatchDrag(null)}
                  >
                    {s}
                  </span>
                ))}
                {unbatchedSamples.length === 0 && (
                  <span className="rx-empty-tip">全部样本已分配</span>
                )}
              </div>
            </div>
            <div className="rx-groups-box">
              {batchList.map((b) => (
                <div key={b.name} className="rx-group-card rx-group-card--batch">
                  <div className="rx-group-header">
                    <strong className="rx-batch-name">{b.name}</strong>
                    <span
                      className={`rx-tag ${b.samples.length === 0 ? "rx-tag--err" : "rx-tag--ok"}`}
                    >
                      {b.samples.length} 样本
                    </span>
                    <button
                      className="rx-icon-btn rx-icon-btn--danger"
                      onClick={() =>
                        updateConfig((c) => {
                          delete c.batches[b.name];
                        })
                      }
                    >
                      <IconTrash size={13} stroke={1.75} />
                    </button>
                  </div>
                  <div
                    className={`rx-group-dropzone${dragOverZone === `batch:${b.name}` ? " rx-drag-over" : ""}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverZone(`batch:${b.name}`);
                    }}
                    onDragLeave={() => setDragOverZone(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      batchDrop(b.name);
                      setDragOverZone(null);
                    }}
                  >
                    {b.samples.map((s) => (
                      <span
                        key={s}
                        className="rx-sample-chip rx-sample-chip--group"
                        draggable
                        onDragStart={() => setBatchDrag(s)}
                        onDragEnd={() => setBatchDrag(null)}
                      >
                        {s}
                        <button
                          className="rx-remove-x"
                          type="button"
                          onClick={() =>
                            updateConfig((c) => {
                              c.batches[b.name] = c.batches[b.name].filter(
                                (x) => x !== s,
                              );
                            })
                          }
                        >
                          <IconX size={11} stroke={2.2} />
                        </button>
                      </span>
                    ))}
                    {b.samples.length === 0 && (
                      <span className="rx-empty-tip">拖拽样本到此批次</span>
                    )}
                  </div>
                </div>
              ))}
              {batchList.length === 0 && (
                <div className="rx-empty-hero rx-empty-hero--slim">
                  <IconStack2 size={22} stroke={1.5} />
                  <strong>未设置批次</strong>
                  <span>
                    不设置则按单因素 ~ condition
                    分析;多批次/多平台数据建议按测序批次分配样本。
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </Collapse>

      {/* ③ 分析参数 */}
      <Collapse
        title={
          <span>
            <span className="step-num">3</span> 分析参数
          </span>
        }
        subtitle={`DEG 阈值(log2FC ${config.params.log2fc_th} · FDR ${config.params.fdr_th} · baseMean ${config.params.basemean_th})`}
        right={
          <span
            className={`rx-tag ${stats.singleCount > 0 ? "rx-tag--warn" : "rx-tag--ok"}`}
          >
            {stats.mode}
          </span>
        }
      >
        <div className="card-body rx-param-grid" style={{ paddingTop: 0 }}>
          <NumField
            label="log2FC 阈值"
            value={config.params.log2fc_th}
            step={0.1}
            min={0}
            hint="|log2FC| 超过即视为差异;发表常用 1.0–1.5"
            onChange={(v) =>
              updateConfig((c) => {
                c.params.log2fc_th = v ?? 1;
              })
            }
          />
          <NumField
            label="FDR 阈值"
            value={config.params.fdr_th}
            step={0.01}
            min={0}
            max={1}
            hint="调整后 p 值上限"
            onChange={(v) =>
              updateConfig((c) => {
                c.params.fdr_th = v ?? 0.05;
              })
            }
          />
          <NumField
            label="baseMean 过滤"
            value={config.params.basemean_th}
            step={1}
            min={0}
            hint="低表达基因过滤下限(DESeq2 归一化计数均值 / edgeR 平均 CPM)"
            onChange={(v) =>
              updateConfig((c) => {
                c.params.basemean_th = v ?? 5;
              })
            }
          />
          <SelectField
            label="分析引擎"
            value={config.params.engine ?? "auto"}
            options={[
              { value: "auto", label: "auto(推荐)" },
              { value: "deseq2", label: "DESeq2(Wald)" },
              { value: "edger_qlf", label: "edgeR(QL F-test)" },
            ]}
            hint="auto:单重复→edgeR 固定 BCV,多重复→DESeq2"
            onChange={(v) =>
              updateConfig((c) => {
                c.params.engine = v;
              })
            }
          />
          <NumField
            label="BCV(edgeR 单重复)"
            value={config.params.bcv}
            step={0.05}
            min={0.01}
            hint="仅单重复模式生效(0.4=人源;0.1=同基因型;0.01=技术重复)"
            onChange={(v) =>
              updateConfig((c) => {
                c.params.bcv = v ?? 0.4;
              })
            }
          />
          <NumField
            label="edgeR 过滤 min.count"
            value={config.params.filter_min_count}
            step={1}
            min={0}
            hint="filterByExpr 低表达过滤阈值"
            onChange={(v) =>
              updateConfig((c) => {
                c.params.filter_min_count = v ?? 5;
              })
            }
          />
          <NumField
            label="DESeq2 过滤 rowSums"
            value={config.params.filter_rowsum}
            step={1}
            min={0}
            hint="rowSums(counts) 保留下限"
            onChange={(v) =>
              updateConfig((c) => {
                c.params.filter_rowsum = v ?? 10;
              })
            }
          />
          <NumField
            label="火山图标注 top N"
            value={config.params.top_n_label}
            step={1}
            min={1}
            hint="每个比较标注最显著基因数"
            onChange={(v) =>
              updateConfig((c) => {
                c.params.top_n_label = v ?? 20;
              })
            }
          />
          <NumField
            label="p 值下限"
            value={config.params.pvalue_cap}
            step={1e-51}
            min={0}
            hint="极小 p 值截断,避免坐标爆炸"
            onChange={(v) =>
              updateConfig((c) => {
                c.params.pvalue_cap = v ?? 1e-50;
              })
            }
          />
        </div>
        {stats.singleCount > 0 && (
          <div className="rx-alert rx-alert--warn" style={{ margin: "0 12px 12px" }}>
            单重复模式采用 edgeR 固定 BCV + TREAT 检验(H0:|log2FC| ≤ 阈值):p
            值为近似值,且检验语义与 DESeq2 Wald / edgeR QLF
            不同,两种模式的结果不可直接对比;发表前需以 qPCR 或生物学重复验证(≥3 重复)。
          </div>
        )}
      </Collapse>

      {/* ④ 运行 */}
      <div className="card">
        <div className="card-title">
          <span className="step-num">4</span>
          <span>运行差异分析</span>
          <span className="rx-tag">单任务模式</span>
        </div>
        <div className="card-body">
          {config.data_file && (
            <div className="rx-summary-row">
              {runStatus === "running" && (
                <div className="rx-alert rx-alert--warn">
                  <IconClock size={13} stroke={1.75} />{" "}
                  正在运行,以下为启动时的配置(本次修改不影响当前任务)
                </div>
              )}
              <div className="rx-summary-items">
                <div
                  className="rx-summary-item"
                  style={{ "--tile": "#0a84ff" } as React.CSSProperties}
                >
                  <b>{importData?.sample_cols.length ?? 0}</b>
                  <span>样本</span>
                </div>
                <div
                  className="rx-summary-item"
                  style={{ "--tile": "#af52de" } as React.CSSProperties}
                >
                  <b>{groupList.filter((g) => g.selected).length}</b>
                  <span>纳入组</span>
                </div>
                <div
                  className="rx-summary-item"
                  style={{ "--tile": "#ff9f0a" } as React.CSSProperties}
                >
                  <b>{config.comparisons.length}</b>
                  <span>比较</span>
                  {invalidCompCount > 0 && (
                    <span className="rx-warn-text">{invalidCompCount} 行无效</span>
                  )}
                </div>
                <div
                  className="rx-summary-item"
                  style={{ "--tile": "#30d158" } as React.CSSProperties}
                >
                  <b>{validComps.length}</b>
                  <span>有效比较</span>
                </div>
                <div
                  className="rx-summary-item"
                  style={{ "--tile": "#ff375f" } as React.CSSProperties}
                >
                  <b>1</b>
                  <span>任务(DEG)</span>
                </div>
                <div className="rx-summary-item rx-summary-item--wide">
                  {joinPath(
                    config.output_dir || "家目录/Mynx/rnaseq_runs",
                    config.run_name || "RNA_seq_时间戳",
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="rx-run-bar">
            <div className="rx-run-left">
              <button
                className="btn btn-primary rx-run-btn"
                onClick={startRunChecked}
                disabled={runStatus === "running"}
              >
                <IconPlayerPlay size={15} stroke={1.75} />
                {runStatus === "running" ? "运行中..." : "运行 DEG 分析"}
              </button>
              {runStatus === "running" && (
                <button
                  className="btn rx-cancel-btn"
                  onClick={doCancelRun}
                  disabled={cancelling}
                >
                  <IconPlayerStop size={14} stroke={1.75} />{" "}
                  {cancelling ? "正在取消…" : "取消"}
                </button>
              )}
              <span className={`rx-tag ${statusCls}`}>{statusText}</span>
              {runStatus === "running" && (
                <span className="rx-elapsed">
                  <IconClock size={12} stroke={1.75} /> 已运行 {elapsedText}
                </span>
              )}
            </div>
            <button
              className="btn"
              disabled={runStatus === "running"}
              onClick={browseResultForPlots}
            >
              <IconFolderOpen size={13} stroke={1.75} /> 加载已有结果…
            </button>
          </div>

          <div className="rx-log-section">
            <div className="rx-log-head">
              <strong>运行日志</strong>
              <small>R 实时输出 · 错误行会标红</small>
              <button className="btn" onClick={copyLogs} disabled={runLogs.length === 0}>
                <IconCopy size={12} stroke={1.75} /> 复制
              </button>
            </div>
            {runStatus !== "idle" && (
              <div className="rx-progress-row">
                {progressIndeterminate ? (
                  <span className="rx-progress-track">
                    <span className="rx-progress-indeterminate" />
                  </span>
                ) : (
                  <span className="rx-progress-track">
                    <span
                      className="rx-progress-fill"
                      style={{
                        width: `${stepsTotal > 0 ? Math.min(100, (stepsDone / stepsTotal) * 100) : 0}%`,
                        background:
                          runStatus === "failed"
                            ? "var(--red)"
                            : runStatus === "done"
                              ? "var(--green)"
                              : undefined,
                      }}
                    />
                  </span>
                )}
                <span className="rx-progress-text">
                  {progressIndeterminate
                    ? "分析中,请留意日志进度"
                    : `${Math.min(stepsDone, stepsTotal)} / ${stepsTotal}`}
                </span>
              </div>
            )}
            <div ref={logAreaRef} className="rx-log-area" role="log" aria-live="polite">
              {runLogs.map((entry, i) => (
                <div key={i} className={`rx-log-line ${entry.level}`}>
                  {entry.msg}
                </div>
              ))}
              {runLogs.length === 0 && (
                <div className="rx-empty-tip">
                  点击「运行 DEG 分析」后,此处实时显示 R
                  日志。也可「加载已有结果」跳过分析直接绘图。
                </div>
              )}
            </div>
          </div>

          {runStatus === "done" && (
            <div className="rx-done-panel">
              <div className="rx-done-head">
                <IconCircleCheck size={16} stroke={1.75} /> 分析完成
              </div>
              <div className="rx-done-meta">
                {runOutputDir && (
                  <span>
                    <IconFolderOpen size={12} stroke={1.75} /> {runOutputDir}
                  </span>
                )}
                {hasResult && (
                  <span className="rx-ok-text">
                    <IconFileSpreadsheet size={12} stroke={1.75} /> DEG 结果 Excel 已生成
                  </span>
                )}
              </div>
              <div className="rx-done-actions">
                {runOutputDir && (
                  <button className="btn" onClick={() => void openInShell(runOutputDir)}>
                    <IconFolderOpen size={13} stroke={1.75} /> 打开输出目录
                  </button>
                )}
                <button className="btn" onClick={() => void checkResult()}>
                  <IconCircleCheck size={13} stroke={1.75} /> 检测结果缓存
                </button>
                <button className="btn btn-primary" onClick={goPlots}>
                  <IconPalette size={13} stroke={1.75} /> 去绘图导出
                </button>
              </div>
            </div>
          )}
          {runStatus === "failed" && (
            <div className="rx-failed-panel">
              <div className="rx-done-head rx-done-head--err">
                <IconCircleX size={16} stroke={1.75} /> 分析失败
              </div>
              {lastError && (
                <p className="rx-last-error">
                  <IconCircleX size={12} stroke={1.75} /> {lastError}
                </p>
              )}
              <div className="rx-done-actions">
                <button
                  className="btn"
                  disabled={!lastError}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(lastError);
                      showToast("已复制错误信息", "success");
                    } catch {
                      showToast("复制失败", "error");
                    }
                  }}
                >
                  <IconCopy size={12} stroke={1.75} /> 复制错误信息
                </button>
              </div>
              <p>
                常见原因:R
                包缺失、数据格式问题。修正后可重新运行;完整日志见上方(红色行为错误)。
              </p>
            </div>
          )}
          {runStatus === "cancelled" && (
            <div className="rx-cancelled-panel">
              <div className="rx-done-head rx-done-head--warn">
                <IconPlayerStop size={16} stroke={1.75} /> 已取消
              </div>
              <p>R 进程已终止,已生成的文件保留在输出目录;调整配置后可重新运行。</p>
            </div>
          )}
        </div>
      </div>

      {/* 最近运行 */}
      <div className="card">
        <div className="card-title">
          <IconHistory size={14} stroke={1.75} />
          <span>最近运行记录</span>
          <span className="rx-title-actions">
            <button className="btn" onClick={browseResultForPlots}>
              <IconFolderOpen size={13} stroke={1.75} /> 浏览外部结果
            </button>
            <button className="btn" onClick={() => void loadRunsList()}>
              <IconRefresh size={13} stroke={1.75} /> 刷新
            </button>
          </span>
        </div>
        <div className="card-body">
          {runs.length === 0 ? (
            <div className="rx-empty-hero rx-empty-hero--slim">
              <IconHistory size={22} stroke={1.5} />
              <strong>暂无运行记录</strong>
              <span>
                运行完成后会出现在这里;也可「浏览外部结果」选择任意历史分析目录。
              </span>
            </div>
          ) : (
            <div className="rx-runs-list">
              {runs.map((r) => (
                <div key={r.name} className="rx-run-row">
                  <div className="rx-run-info">
                    <strong>{r.name}</strong>
                    <span className="rx-run-meta">
                      {r.mtime}
                      {r.has_excel ? (
                        <span className="rx-tag rx-tag--ok">
                          <IconFileSpreadsheet size={10} /> Excel
                        </span>
                      ) : (
                        <span className="rx-tag">无 DEG 缓存</span>
                      )}
                      <span className="rx-plot-count">
                        <IconPhoto size={10} /> {r.n_plots} 图
                      </span>
                    </span>
                  </div>
                  <div className="rx-run-actions">
                    <button
                      className="btn"
                      disabled={!r.has_excel}
                      onClick={() => void applyRunForPlots(r)}
                    >
                      <IconPalette size={12} stroke={1.75} /> 用于绘图
                    </button>
                    <button
                      className="btn"
                      onClick={() =>
                        void openInShell(
                          joinPath(r.base_dir || config.output_dir || "", r.name),
                        )
                      }
                    >
                      <IconFolderOpen size={12} stroke={1.75} /> 打开
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
