/**
 * 步骤 2:差异分析 — 实验设计(勾选分配)、差异比较、批次设置(可选)、
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
  IconArrowRight,
  IconCheck,
} from "@tabler/icons-react";
import { showToast } from "@/components/Toast";
import { batchConfounded, useRnaSeq, validComparisonsOf } from "./store";
import { Collapse, NumField, SelectField } from "./fields";
import { listRuns } from "@/lib/rnaseq/runs";
import { joinPath, openInShell } from "@/lib/rnaseq/io";
import type { RunItem } from "@/lib/rnaseq/types";
import { useLanguage } from "@/lib/i18n";

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
  const { language } = useLanguage();
  const l = (zh: string, en: string) => language === "en" ? en : zh;
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
  // 勾选中的未分组样本(批量加入分组用)
  const [poolSelected, setPoolSelected] = useState<Set<string>>(new Set());
  // 当前目标组(批量加入)
  const [targetGroup, setTargetGroup] = useState("");
  // 勾选中的未分配批次样本
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  // 当前目标批次
  const [targetBatch, setTargetBatch] = useState("");
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

  // ── 加入/移除样本(替代拖拽:Tauri 原生拖放会拦截 HTML5 DnD,故改点击分配) ──
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
      // 已经分配出去的样本不再属于「未分组勾选」
      setPoolSelected((prev) => {
        if (!prev.has(sample)) return prev;
        const next = new Set(prev);
        next.delete(sample);
        return next;
      });
    },
    [updateConfig],
  );

  // ── 分组管理 ──
  const autoGroupByPrefix = useCallback(async () => {
    const used = new Set(groupList.flatMap((g) => g.samples));
    const unassigned = allSamples.filter((s) => !used.has(s));
    if (unassigned.length === 0) {
      showToast(l("所有样本都已分组", "All samples are already assigned to groups"), "info");
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
    showToast(l(`已创建 ${groups.size} 个组,请核对后勾选纳入`, `${groups.size} groups created; review and select the groups to include`), "success");
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
    showToast(l(`已删除组「${name}」`, `Group “${name}” deleted`), "success");
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
    showToast(l(`已合并到「${trimmed}」`, `Merged into “${trimmed}”`), "success");
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
      showToast(l("至少需要 2 个选定的组", "Select at least two groups"), "info");
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

  // 单个样本从批次移除回池
  const removeFromBatch = useCallback(
    (batchName: string, sample: string) => {
      updateConfig((c) => {
        if (c.batches[batchName])
          c.batches[batchName] = c.batches[batchName].filter((x) => x !== sample);
      });
    },
    [updateConfig],
  );

  // 目标组/目标批次:用户选定优先,无效则回落到第一个(渲染期派生,避免 effect 串渲染)
  const effectiveTargetGroup =
    groupList.length === 0
      ? ""
      : targetGroup && config.groups[targetGroup]
        ? targetGroup
        : groupList[0].name;
  const effectiveTargetBatch =
    batchList.length === 0
      ? ""
      : targetBatch && config.batches[targetBatch]
        ? targetBatch
        : batchList[0]?.name || "";

  // 批量把未分组样本加入目标组
  const assignSelectedToGroup = useCallback(() => {
    const tgt = effectiveTargetGroup;
    if (!tgt || poolSelected.size === 0) return;
    const samples = Array.from(poolSelected);
    updateConfig((c) => {
      if (!c.groups[tgt]) c.groups[tgt] = [];
      const arr = c.groups[tgt];
      for (const s of samples) {
        if (!arr.includes(s)) arr.push(s);
        // 样本此前可能在其他组里:从其他组剔除(单组归属)
        for (const gn of Object.keys(c.groups)) {
          if (gn !== tgt) c.groups[gn] = c.groups[gn].filter((x) => x !== s);
        }
      }
    });
    setPoolSelected(new Set());
    showToast(l(`已将 ${samples.length} 个样本加入「${config.group_display[tgt] || tgt}」`, `${samples.length} samples added to “${config.group_display[tgt] || tgt}”`), "success");
  }, [effectiveTargetGroup, poolSelected, updateConfig, config.group_display]);

  // 批量把未分配样本加入目标批次(从其他批次剔除)
  const assignSelectedToBatch = useCallback(() => {
    const tgt = effectiveTargetBatch;
    if (!tgt || batchSelected.size === 0) return;
    const samples = Array.from(batchSelected);
    updateConfig((c) => {
      if (!c.batches[tgt]) c.batches[tgt] = [];
      const arr = c.batches[tgt];
      for (const s of samples) {
        for (const bn of Object.keys(c.batches)) {
          if (bn !== tgt) c.batches[bn] = c.batches[bn].filter((x) => x !== s);
        }
        if (!arr.includes(s)) arr.push(s);
      }
    });
    setBatchSelected(new Set());
  }, [effectiveTargetBatch, batchSelected, updateConfig]);

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
      showToast(l("请先在「数据导入」中选择并导入数据", "Select and import data in Data import first"), "info");
      return;
    }
    if (!importData || c.data_file !== successfulImportPath) {
      showToast(l("数据文件尚未成功导入,请回到「数据导入」重新导入", "The data file has not been imported successfully; return to Data import and try again"), "info");
      return;
    }
    if (rscriptFound === false) {
      const ok = await recheckRscript();
      if (!ok) {
        showToast(l("未检测到 Rscript,无法运行分析。请安装 R 后点击重新检测", "Rscript was not found. Install R and check again"), "error");
        return;
      }
    }
    if (c.selected_groups.length < 2) {
      showToast(l("至少需要 2 个「纳入」的组(上方实验设计)", "Select at least two included groups in the experimental design above"), "info");
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
      showToast(l("至少需要 1 个比较(上方差异比较)", "Add at least one comparison in Differential comparisons above"), "info");
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
    showToast(l("差异分析已启动,日志见下方;完成后到「绘图导出」生成图表", "Differential analysis started. See the log below; export plots after it finishes"), "success");
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
      showToast(l("暂无日志可复制", "There are no logs to copy"), "info");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast(l(`已复制 ${runLogs.length} 行日志`, `${runLogs.length} log lines copied`), "success");
    } catch {
      showToast(l("复制失败,请手动选择日志文本", "Copy failed; select the log text manually"), "error");
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
      showToast(l("未找到该运行的输出目录", "The output directory for this run was not found"), "error");
      return;
    }
    const ok = await loadFromPath(root, { mergeParams: true });
    if (ok) goPlots();
    else showToast(l("该目录未找到 DEG 结果 Excel,无法用于绘图", "No DEG result workbook was found in this directory; it cannot be used for plotting"), "info");
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
          <span>{l("实验设计", "Experimental design")}</span>
          <span className="rx-title-actions">
            <button
              className="btn"
              onClick={autoGroupByPrefix}
              title={l("按样本名前缀自动建组", "Create groups from sample-name prefixes")}
            >
              <IconStack2 size={13} stroke={1.75} /> {l("自动分组", "Auto-group")}
            </button>
            <button className="btn" onClick={addGroup}>
              <IconPlus size={13} stroke={1.75} /> {l("新建组", "New group")}
            </button>
          </span>
        </div>
        <div className="card-body">
          <div className="rx-group-layout">
            <div className="rx-pool-box">
              <div className="rx-box-header">
                <span>{l("样本池", "Sample pool")}</span>
                <div className="rx-search-box rx-search-box--sm">
                  <IconSearch size={12} stroke={1.75} />
                  <input
                    type="text"
                    placeholder={l("搜索", "Search")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              {/* 批量加入工具条:替代拖拽——勾选未分组样本 → 选目标组 → 加入 */}
              {groupList.length > 0 && poolSamples.length > 0 && (
                <div className="rx-assign-bar">
                  <label className="rx-check-all">
                    <input
                      type="checkbox"
                      checked={poolSelected.size === poolSamples.length}
                      onChange={(e) =>
                        setPoolSelected(e.target.checked ? new Set(poolSamples) : new Set())
                      }
                    />
                    {l("全选", "Select all")}
                  </label>
                  <span className="rx-assign-count">
                    {l("已选", "Selected")} {poolSelected.size}/{poolSamples.length}
                  </span>
                  <select
                    className="rx-assign-target"
                    value={effectiveTargetGroup}
                    onChange={(e) => setTargetGroup(e.target.value)}
                  >
                    {groupList.map((g) => (
                      <option key={g.name} value={g.name}>
                        → {g.display}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-primary rx-assign-btn"
                    disabled={poolSelected.size === 0 || !effectiveTargetGroup}
                    onClick={assignSelectedToGroup}
                    title={l("把勾选的未分组样本一次性加入目标组", "Add selected ungrouped samples to the target group")}
                  >
                    <IconArrowRight size={13} stroke={1.9} /> {l("加入", "Add")}
                  </button>
                </div>
              )}
              <div className="rx-sample-pool">
                {poolSamples.map((s) => {
                  const checked = poolSelected.has(s);
                  return (
                    <label
                      key={s}
                      className={`rx-sample-chip rx-sample-chip--pick${checked ? " checked" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setPoolSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(s);
                            else next.delete(s);
                            return next;
                          })
                        }
                      />
                      <span className="rx-chip-check">
                        <IconCheck size={10} stroke={3} />
                      </span>
                      {s}
                    </label>
                  );
                })}
                {allSamples.length === 0 && (
                  <span className="rx-empty-tip">
                    {l("请先在「数据导入」页导入 Counts 文件,样本会出现在这里", "Import a counts file in Data import first; samples will appear here.")}
                  </span>
                )}
                {allSamples.length > 0 && poolSamples.length === 0 && (
                  <span className="rx-empty-tip">{l("无未分组样本", "No ungrouped samples")}</span>
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
                        placeholder={l("组名", "Group name")}
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
                          ? l("空组", "Empty group")
                          : g.samples.length < 2
                            ? l("单重复", "Single replicate")
                            : `${g.samples.length} ${l("重复", "replicates")}`}
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
                        {l("纳入", "Include")}
                      </label>
                      <button
                        className="rx-icon-btn rx-icon-btn--danger"
                        title={`${l("删除组", "Delete group ")} ${g.name}`}
                        onClick={() => void delGroup(g.name)}
                      >
                        <IconTrash size={13} stroke={1.75} />
                      </button>
                    </div>
                    <div className="rx-group-dropzone">
                      {g.samples.map((s) => (
                        <span
                          key={s}
                          className="rx-sample-chip rx-sample-chip--group"
                        >
                          {s}
                          <button
                            className="rx-remove-x"
                            type="button"
                            aria-label={`${l("从", "Remove ")}${s}${l("移除", " from ")}${g.name}`}
                            onClick={() => moveSample(s, g.name, null)}
                          >
                            <IconX size={11} stroke={2.2} />
                          </button>
                        </span>
                      ))}
                      {g.samples.length === 0 && (
                        <span className="rx-empty-tip">{l("从样本池勾选样本并加入此组", "Select samples from the pool and add them to this group")}</span>
                      )}
                    </div>
                  </div>
                );
              })}
              {groupList.length === 0 && (
                <div className="rx-empty-hero rx-empty-hero--slim">
                  <IconStack2 size={22} stroke={1.5} />
                  <strong>{allSamples.length === 0 ? l("先导入数据", "Import data first") : l("还没有分组", "No groups yet")}</strong>
                  <span>
                    {allSamples.length === 0
                      ? l("到「数据导入」选择 Counts 文件,导入后即可在这里分组。", "Choose a counts file in Data import, then create groups here.")
                      : l("点击「自动分组」按样本名前缀建组,或「新建组」后在样本池勾选样本并加入。", "Use Auto-group by sample prefix, or create a group and add samples from the pool.")}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="rx-stats-bar">
            {l("共", "Total ")} {stats.total} {l("组 · 选定", "groups · selected ")} {stats.selected} {l("组 ·", "groups ·")} {stats.comparisons} {l("个比较 · 分析模式:", "comparisons · analysis mode:")}
            <b>{stats.mode}</b>
            {stats.singleCount > 0 && (
              <span className="rx-warn-text">
                ({stats.singleCount} {l("组为单样本,将走 edgeR 单重复流程", "single-sample groups will use the edgeR single-replicate workflow")})
              </span>
            )}
            {stats.emptyCount > 0 && (
              <span className="rx-warn-text">
                ({stats.emptyCount} {l("个空组被纳入,需先分配样本", "included empty groups need samples assigned")})
              </span>
            )}
          </div>

          {/* 差异比较 */}
          <div className="rx-comp-block">
            <div className="rx-comp-head">
              <div>
                <h4>{l("差异比较", "Differential comparisons")}</h4>
                <p>{l("每个比较输出一套 DEG 结果,Treatment 为分子、Control 为分母", "Each comparison yields DEG results; Treatment is the numerator and Control the denominator.")}</p>
              </div>
              <div className="rx-title-actions">
                <button className="btn" onClick={autoGenerate}>
                  <IconWand size={13} stroke={1.75} /> {l("自动生成全两两", "Generate all pairs")}
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    updateConfig((c) => {
                      c.comparisons.push(["", ""]);
                    })
                  }
                >
                  <IconPlus size={13} stroke={1.75} /> {l("添加比较", "Add comparison")}
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    updateConfig((c) => {
                      c.comparisons = [];
                    })
                  }
                >
                  {l("清空", "Clear")}
                </button>
              </div>
            </div>
            {config.comparisons.length === 0 ? (
              <div className="rx-empty-hero rx-empty-hero--slim">
                <IconGitCompare size={22} stroke={1.5} />
                <strong>{l("还没有比较设置", "No comparisons yet")}</strong>
                <span>{l("添加一行,或自动生成所有选定分组之间的两两比较。", "Add a row or automatically generate every pair among selected groups.")}</span>
              </div>
            ) : (
              <div className="rx-table-wrap">
                <table className="rx-table rx-table--comps">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>#</th>
                      <th>{l("Treatment(分子)", "Treatment (numerator)")}</th>
                      <th style={{ width: 44 }}></th>
                      <th>{l("Control(分母)", "Control (denominator)")}</th>
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
                              <option value="">{l("选择处理组", "Choose treatment group")}</option>
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
                              <option value="">{l("选择对照组", "Choose control group")}</option>
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
                              aria-label={`${l("删除第", "Delete comparison row ")} ${i + 1}`}
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
              {l("提示:比较只使用勾选了「纳入」的组;删除组会同步清理引用;", "Tip: comparisons use only included groups; deleting a group clears its references. ")}
              {invalidCompCount > 0
                ? `${l("当前有", "There are ")} ${invalidCompCount} ${l("行无效(红色),运行前需修正。", "invalid (red) rows. Fix them before running.")}`
                : l("当前所有比较行有效。", "All comparison rows are valid.")}
            </p>
          </div>
        </div>
      </div>

      {/* ② 批次设置 */}
      <Collapse
        title={
          <span>
            <span className="step-num">2</span> {l("批次设置(可选)", "Batch settings (optional)")}
          </span>
        }
        subtitle={
          Object.keys(config.batches).length > 0
            ? `${Object.keys(config.batches).length} ${l("个批次 · 设计 ~ batch + condition", "batches · design ~ batch + condition")}`
            : l("未启用(~ condition 单因素);多批次/多平台数据建议设置", "Disabled (~ condition); set for multi-batch or multi-platform data")
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
              <IconPlus size={13} stroke={1.75} /> {l("新建批次", "New batch")}
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
                {l("清空", "Clear")}
              </button>
            )}
          </div>
          <div className="rx-group-layout">
            <div className="rx-pool-box">
              <div className="rx-box-header">
                <span>{l("未分配样本", "Unassigned samples")}</span>
              </div>
              {batchList.length > 0 && unbatchedSamples.length > 0 && (
                <div className="rx-assign-bar">
                  <label className="rx-check-all">
                    <input
                      type="checkbox"
                      checked={batchSelected.size === unbatchedSamples.length}
                      onChange={(e) =>
                        setBatchSelected(e.target.checked ? new Set(unbatchedSamples) : new Set())
                      }
                    />
                    {l("全选", "Select all")}
                  </label>
                  <span className="rx-assign-count">
                    {l("已选", "Selected")} {batchSelected.size}/{unbatchedSamples.length}
                  </span>
                  <select
                    className="rx-assign-target"
                    value={effectiveTargetBatch}
                    onChange={(e) => setTargetBatch(e.target.value)}
                  >
                    {batchList.map((b) => (
                      <option key={b.name} value={b.name}>
                        → {b.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-primary rx-assign-btn"
                    disabled={batchSelected.size === 0 || !effectiveTargetBatch}
                    onClick={assignSelectedToBatch}
                    title={l("把勾选的未分配样本一次性加入目标批次", "Add selected unassigned samples to the target batch")}
                  >
                    <IconArrowRight size={13} stroke={1.9} /> {l("加入", "Add")}
                  </button>
                </div>
              )}
              <div className="rx-sample-pool rx-sample-pool--batch">
                {unbatchedSamples.map((s) => {
                  const checked = batchSelected.has(s);
                  return (
                    <label
                      key={s}
                      className={`rx-sample-chip rx-sample-chip--pick${checked ? " checked" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setBatchSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(s);
                            else next.delete(s);
                            return next;
                          })
                        }
                      />
                      <span className="rx-chip-check">
                        <IconCheck size={10} stroke={3} />
                      </span>
                      {s}
                    </label>
                  );
                })}
                {unbatchedSamples.length === 0 && (
                  <span className="rx-empty-tip">{l("全部样本已分配", "All samples assigned")}</span>
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
                      {b.samples.length} {l("样本", "samples")}
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
                  <div className="rx-group-dropzone">
                    {b.samples.map((s) => (
                      <span
                        key={s}
                        className="rx-sample-chip rx-sample-chip--group"
                      >
                        {s}
                        <button
                          className="rx-remove-x"
                          type="button"
                          onClick={() => removeFromBatch(b.name, s)}
                        >
                          <IconX size={11} stroke={2.2} />
                        </button>
                      </span>
                    ))}
                    {b.samples.length === 0 && (
                      <span className="rx-empty-tip">{l("从左侧勾选样本并加入此批次", "Select samples on the left and add them to this batch")}</span>
                    )}
                  </div>
                </div>
              ))}
              {batchList.length === 0 && (
                <div className="rx-empty-hero rx-empty-hero--slim">
                  <IconStack2 size={22} stroke={1.5} />
                  <strong>{l("未设置批次", "No batches set")}</strong>
                  <span>
                    {l("不设置则按单因素 ~ condition 分析;多批次/多平台数据建议按测序批次分配样本。", "Without batches, analysis uses one factor (~ condition). For multi-batch or multi-platform data, assign samples by sequencing batch.")}
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
            <span className="step-num">3</span> {l("分析参数", "Analysis parameters")}
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
            label={l("log2FC 阈值", "log2FC threshold")}
            value={config.params.log2fc_th}
            step={0.1}
            min={0}
            hint={l("|log2FC| 超过即视为差异;发表常用 1.0–1.5", "Values above |log2FC| are differential; 1.0–1.5 is common for publication")}
            onChange={(v) =>
              updateConfig((c) => {
                c.params.log2fc_th = v ?? 1;
              })
            }
          />
          <NumField
            label={l("FDR 阈值", "FDR threshold")}
            value={config.params.fdr_th}
            step={0.01}
            min={0}
            max={1}
            hint={l("调整后 p 值上限", "Adjusted p-value cutoff")}
            onChange={(v) =>
              updateConfig((c) => {
                c.params.fdr_th = v ?? 0.05;
              })
            }
          />
          <NumField
            label={l("baseMean 过滤", "baseMean filter")}
            value={config.params.basemean_th}
            step={1}
            min={0}
            hint={l("低表达基因过滤下限(DESeq2 归一化计数均值 / edgeR 平均 CPM)", "Low-expression cutoff (DESeq2 normalized mean / edgeR mean CPM)")}
            onChange={(v) =>
              updateConfig((c) => {
                c.params.basemean_th = v ?? 5;
              })
            }
          />
          <SelectField
            label={l("分析引擎", "Analysis engine")}
            value={config.params.engine ?? "auto"}
            options={[
              { value: "auto", label: l("auto(推荐)", "auto (recommended)") },
              { value: "deseq2", label: "DESeq2(Wald)" },
              { value: "edger_qlf", label: "edgeR(QL F-test)" },
            ]}
            hint={l("auto:单重复→edgeR 固定 BCV,多重复→DESeq2", "auto: single replicate → edgeR fixed BCV; replicates → DESeq2")}
            onChange={(v) =>
              updateConfig((c) => {
                c.params.engine = v;
              })
            }
          />
          <NumField
            label={l("BCV(edgeR 单重复)", "BCV (edgeR single replicate)")}
            value={config.params.bcv}
            step={0.05}
            min={0.01}
            hint={l("仅单重复模式生效(0.4=人源;0.1=同基因型;0.01=技术重复)", "Only for single-replicate mode (0.4 human; 0.1 same genotype; 0.01 technical replicates)")}
            onChange={(v) =>
              updateConfig((c) => {
                c.params.bcv = v ?? 0.4;
              })
            }
          />
          <NumField
            label={l("edgeR 过滤 min.count", "edgeR min.count filter")}
            value={config.params.filter_min_count}
            step={1}
            min={0}
            hint={l("filterByExpr 低表达过滤阈值", "filterByExpr low-expression cutoff")}
            onChange={(v) =>
              updateConfig((c) => {
                c.params.filter_min_count = v ?? 5;
              })
            }
          />
          <NumField
            label={l("DESeq2 过滤 rowSums", "DESeq2 rowSums filter")}
            value={config.params.filter_rowsum}
            step={1}
            min={0}
            hint={l("rowSums(counts) 保留下限", "rowSums(counts) retention cutoff")}
            onChange={(v) =>
              updateConfig((c) => {
                c.params.filter_rowsum = v ?? 10;
              })
            }
          />
          <NumField
            label={l("火山图标注 top N", "Volcano plot top-N labels")}
            value={config.params.top_n_label}
            step={1}
            min={1}
            hint={l("每个比较标注最显著基因数", "Number of most significant genes labelled per comparison")}
            onChange={(v) =>
              updateConfig((c) => {
                c.params.top_n_label = v ?? 20;
              })
            }
          />
          <NumField
            label={l("p 值下限", "p-value floor")}
            value={config.params.pvalue_cap}
            step={1e-51}
            min={0}
            hint={l("极小 p 值截断,避免坐标爆炸", "Clamp extremely small p values to avoid exploding axes")}
            onChange={(v) =>
              updateConfig((c) => {
                c.params.pvalue_cap = v ?? 1e-50;
              })
            }
          />
        </div>
        {stats.singleCount > 0 && (
          <div className="rx-alert rx-alert--warn" style={{ margin: "0 12px 12px" }}>
            {l("单重复模式采用 edgeR 固定 BCV + TREAT 检验(H0:|log2FC| ≤ 阈值):p 值为近似值,且检验语义与 DESeq2 Wald / edgeR QLF 不同,两种模式的结果不可直接对比;发表前需以 qPCR 或生物学重复验证(≥3 重复)。", "Single-replicate mode uses edgeR fixed BCV + TREAT (H0: |log2FC| ≤ threshold). P values are approximate and have different semantics from DESeq2 Wald / edgeR QLF; do not directly compare the two modes. Validate with qPCR or biological replicates (≥3) before publication.")}
          </div>
        )}
      </Collapse>

      {/* ④ 运行 */}
      <div className="card">
        <div className="card-title">
          <span className="step-num">4</span>
          <span>{l("运行差异分析", "Run differential analysis")}</span>
          <span className="rx-tag">{l("单任务模式", "Single-task mode")}</span>
        </div>
        <div className="card-body">
          {config.data_file && (
            <div className="rx-summary-row">
              {runStatus === "running" && (
                <div className="rx-alert rx-alert--warn">
                  <IconClock size={13} stroke={1.75} />{" "}
                  {l("正在运行,以下为启动时的配置(本次修改不影响当前任务)", "Running. The settings below were captured at start; current edits do not affect this task.")}
                </div>
              )}
              <div className="rx-summary-items">
                <div
                  className="rx-summary-item"
                  style={{ "--tile": "#0a84ff" } as React.CSSProperties}
                >
                  <b>{importData?.sample_cols.length ?? 0}</b>
                  <span>{l("样本", "Samples")}</span>
                </div>
                <div
                  className="rx-summary-item"
                  style={{ "--tile": "#af52de" } as React.CSSProperties}
                >
                  <b>{groupList.filter((g) => g.selected).length}</b>
                  <span>{l("纳入组", "Included groups")}</span>
                </div>
                <div
                  className="rx-summary-item"
                  style={{ "--tile": "#ff9f0a" } as React.CSSProperties}
                >
                  <b>{config.comparisons.length}</b>
                  <span>{l("比较", "Comparisons")}</span>
                  {invalidCompCount > 0 && (
                    <span className="rx-warn-text">{invalidCompCount} {l("行无效", "invalid")}</span>
                  )}
                </div>
                <div
                  className="rx-summary-item"
                  style={{ "--tile": "#30d158" } as React.CSSProperties}
                >
                  <b>{validComps.length}</b>
                  <span>{l("有效比较", "Valid comparisons")}</span>
                </div>
                <div
                  className="rx-summary-item"
                  style={{ "--tile": "#ff375f" } as React.CSSProperties}
                >
                  <b>1</b>
                  <span>{l("任务(DEG)", "Task (DEG)")}</span>
                </div>
                <div className="rx-summary-item rx-summary-item--wide">
                  {joinPath(
                    config.output_dir || l("家目录/Mynx/rnaseq_runs", "home/Mynx/rnaseq_runs"),
                    config.run_name || l("RNA_seq_时间戳", "RNA_seq_timestamp"),
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
                {runStatus === "running" ? l("运行中...", "Running...") : l("运行 DEG 分析", "Run DEG analysis")}
              </button>
              {runStatus === "running" && (
                <button
                  className="btn rx-cancel-btn"
                  onClick={doCancelRun}
                  disabled={cancelling}
                >
                  <IconPlayerStop size={14} stroke={1.75} />{" "}
                  {cancelling ? l("正在取消…", "Cancelling…") : l("取消", "Cancel")}
                </button>
              )}
              <span className={`rx-tag ${statusCls}`}>{statusText}</span>
              {runStatus === "running" && (
                <span className="rx-elapsed">
                  <IconClock size={12} stroke={1.75} /> {l("已运行", "Elapsed")} {elapsedText}
                </span>
              )}
            </div>
            <button
              className="btn"
              disabled={runStatus === "running"}
              onClick={browseResultForPlots}
            >
              <IconFolderOpen size={13} stroke={1.75} /> {l("加载已有结果…", "Load existing results…")}
            </button>
          </div>

          <div className="rx-log-section">
            <div className="rx-log-head">
              <strong>{l("运行日志", "Run log")}</strong>
              <small>{l("R 实时输出 · 错误行会标红", "Live R output · error lines are red")}</small>
              <button className="btn" onClick={copyLogs} disabled={runLogs.length === 0}>
                <IconCopy size={12} stroke={1.75} /> {l("复制", "Copy")}
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
                    ? l("分析中,请留意日志进度", "Analyzing; follow progress in the log")
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
                  {l("点击「运行 DEG 分析」后,此处实时显示 R 日志。也可「加载已有结果」跳过分析直接绘图。", "After Run DEG analysis, live R logs appear here. You can also load existing results and plot directly.")}
                </div>
              )}
            </div>
          </div>

          {runStatus === "done" && (
            <div className="rx-done-panel">
              <div className="rx-done-head">
                <IconCircleCheck size={16} stroke={1.75} /> {l("分析完成", "Analysis complete")}
              </div>
              <div className="rx-done-meta">
                {runOutputDir && (
                  <span>
                    <IconFolderOpen size={12} stroke={1.75} /> {runOutputDir}
                  </span>
                )}
                {hasResult && (
                  <span className="rx-ok-text">
                    <IconFileSpreadsheet size={12} stroke={1.75} /> {l("DEG 结果 Excel 已生成", "DEG results Excel created")}
                  </span>
                )}
              </div>
              <div className="rx-done-actions">
                {runOutputDir && (
                  <button className="btn" onClick={() => void openInShell(runOutputDir)}>
                    <IconFolderOpen size={13} stroke={1.75} /> {l("打开输出目录", "Open output folder")}
                  </button>
                )}
                <button className="btn" onClick={() => void checkResult()}>
                  <IconCircleCheck size={13} stroke={1.75} /> {l("检测结果缓存", "Check result cache")}
                </button>
                <button className="btn btn-primary" onClick={goPlots}>
                  <IconPalette size={13} stroke={1.75} /> {l("去绘图导出", "Go to plot export")}
                </button>
              </div>
            </div>
          )}
          {runStatus === "failed" && (
            <div className="rx-failed-panel">
              <div className="rx-done-head rx-done-head--err">
                <IconCircleX size={16} stroke={1.75} /> {l("分析失败", "Analysis failed")}
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
                      showToast(l("已复制错误信息", "Error copied"), "success");
                    } catch {
                      showToast(l("复制失败", "Copy failed"), "error");
                    }
                  }}
                >
                  <IconCopy size={12} stroke={1.75} /> {l("复制错误信息", "Copy error")}
                </button>
              </div>
              <p>
                {l("常见原因:R 包缺失、数据格式问题。修正后可重新运行;完整日志见上方(红色行为错误)。", "Common causes: missing R packages or data-format problems. Fix them, then run again; the full log is above (error lines are red).")}
              </p>
            </div>
          )}
          {runStatus === "cancelled" && (
            <div className="rx-cancelled-panel">
              <div className="rx-done-head rx-done-head--warn">
                <IconPlayerStop size={16} stroke={1.75} /> {l("已取消", "Cancelled")}
              </div>
              <p>{l("R 进程已终止,已生成的文件保留在输出目录;调整配置后可重新运行。", "The R process was stopped. Generated files remain in the output folder; adjust settings and run again.")}</p>
            </div>
          )}
        </div>
      </div>

      {/* 最近运行 */}
      <div className="card">
        <div className="card-title">
          <IconHistory size={14} stroke={1.75} />
          <span>{l("最近运行记录", "Recent runs")}</span>
          <span className="rx-title-actions">
            <button className="btn" onClick={browseResultForPlots}>
              <IconFolderOpen size={13} stroke={1.75} /> {l("浏览外部结果", "Browse external results")}
            </button>
            <button className="btn" onClick={() => void loadRunsList()}>
              <IconRefresh size={13} stroke={1.75} /> {l("刷新", "Refresh")}
            </button>
          </span>
        </div>
        <div className="card-body">
          {runs.length === 0 ? (
            <div className="rx-empty-hero rx-empty-hero--slim">
              <IconHistory size={22} stroke={1.5} />
              <strong>{l("暂无运行记录", "No runs yet")}</strong>
              <span>
                {l("运行完成后会出现在这里;也可「浏览外部结果」选择任意历史分析目录。", "Completed runs appear here. You can also browse any historical analysis directory.")}
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
                        <span className="rx-tag">{l("无 DEG 缓存", "No DEG cache")}</span>
                      )}
                      <span className="rx-plot-count">
                        <IconPhoto size={10} /> {r.n_plots} {l("图", "charts")}
                      </span>
                    </span>
                  </div>
                  <div className="rx-run-actions">
                    <button
                      className="btn"
                      disabled={!r.has_excel}
                      onClick={() => void applyRunForPlots(r)}
                    >
                      <IconPalette size={12} stroke={1.75} /> {l("用于绘图", "Use for plots")}
                    </button>
                    <button
                      className="btn"
                      onClick={() =>
                        void openInShell(
                          joinPath(r.base_dir || config.output_dir || "", r.name),
                        )
                      }
                    >
                      <IconFolderOpen size={12} stroke={1.75} /> {l("打开", "Open")}
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
