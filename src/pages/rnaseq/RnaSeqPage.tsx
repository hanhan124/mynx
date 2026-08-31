/**
 * RNA-seq 差异分析流水线 — 主页面。
 *
 * 三步向导:数据导入 → 差异分析 → 绘图导出。
 * 进入本页时窗口最大化(保留任务栏的标准最大化,非全屏),离开时恢复进入前状态;
 * 设计体系完全沿用 mynx(Tahoe 令牌 / surface 渐变 / tabler 图标 / spring 动效)。
 */
import { useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  IconMicroscope,
  IconFileImport,
  IconFlask,
  IconPalette,
  IconFolderOpen,
  IconDeviceFloppy,
} from "@tabler/icons-react";
import { showToast } from "@/components/Toast";
import HelpButton from "@/components/HelpButton";
import { RnaSeqProvider, useRnaSeq, validComparisonsOf } from "./store";
import ImportStep from "./ImportStep";
import AnalysisStep from "./AnalysisStep";
import PlotsStep from "./PlotsStep";
import { RnaSeqTutorial } from "./RnaSeqTutorial";
import { useLanguage } from "@/lib/i18n";

type StepId = "import" | "analysis" | "plots";

function StepContent({ step, goStep }: { step: StepId; goStep: (s: StepId) => void }) {
  if (step === "import") return <ImportStep />;
  if (step === "analysis") return <AnalysisStep goPlots={() => goStep("plots")} />;
  return <PlotsStep goAnalysis={() => goStep("analysis")} />;
}

/** 步骤就绪状态(未就绪时 tab 上给灰点,可点击但引导先完成前置步骤) */
function useStepReadiness() {
  const st = useRnaSeq();
  return useMemo(() => {
    const importReady =
      !!st.importData && st.config.data_file === st.successfulImportPath;
    const analysisReady =
      st.hasResult ||
      (st.config.selected_groups.length >= 2 &&
        validComparisonsOf(st.config).length >= 1);
    const plotsReady = st.hasResult;
    return { importReady, analysisReady, plotsReady };
  }, [st.importData, st.config, st.hasResult, st.successfulImportPath]);
}

function RnaSeqStatusStrip() {
  const { language } = useLanguage();
  const l = (zh: string, en: string) => language === "en" ? en : zh;
  const st = useRnaSeq();
  const selected = st.config.selected_groups;
  const sampleCount = selected.reduce(
    (n, group) => n + (st.config.groups[group]?.length ?? 0),
    0,
  );
  const singleRep = selected.some(
    (group) => (st.config.groups[group]?.length ?? 0) < 2,
  );
  const mode = selected.length < 2
    ? l("待设置", "Needs setup")
    : singleRep
      ? l("单重复 · 探索性", "Single replicate · exploratory")
      : st.config.params.engine === "edger_qlf"
        ? "edgeR QL"
        : st.config.params.engine === "deseq2"
          ? "DESeq2"
          : l("自动选择", "Auto")
  const items = [
    { label: "Counts", value: st.importData ? `${st.importData.total_genes.toLocaleString()} genes` : l("未导入", "Not imported"), tone: st.importData ? "ok" : "muted" },
    { label: "Samples", value: sampleCount ? `${sampleCount} samples` : l("未分配", "Unassigned"), tone: sampleCount ? "ok" : "muted" },
    { label: "Design", value: selected.length ? `${selected.length} groups` : l("未设置", "Not set"), tone: selected.length >= 2 ? "ok" : "muted" },
    { label: "Contrast", value: st.config.comparisons.length ? `${validComparisonsOf(st.config).length} valid` : l("未设置", "Not set"), tone: validComparisonsOf(st.config).length ? "ok" : "muted" },
  ];
  return (
    <div className={`rx-status-strip${singleRep ? " rx-status-strip--exploratory" : ""}`}>
      <div className="rx-status-mode">
        <span className="rx-status-pulse" />
        <span className="rx-status-mode-label">{l("分析模式", "Analysis mode")}</span>
        <strong>{mode}</strong>
      </div>
      <div className="rx-status-metrics">
        {items.map((item) => (
          <div className="rx-status-metric" key={item.label}>
            <span>{item.label}</span>
            <b className={`rx-status-value rx-status-value--${item.tone}`}>{item.value}</b>
          </div>
        ))}
      </div>
      {singleRep && (
        <div className="rx-status-note">
          {l("单重复结果用于内部探索，P 值为近似值，不应作为正式生物学重复推断。", "Single-replicate results are exploratory. P values are approximate and should not be used as formal biological-replicate inference.")}
        </div>
      )}
    </div>
  );
}

function RnaSeqInner() {
  const { t } = useLanguage();
  const steps: { id: StepId; label: string; icon: typeof IconFileImport }[] = [
    { id: "import", label: t("rnaseq.import"), icon: IconFileImport },
    { id: "analysis", label: t("rnaseq.analysis"), icon: IconFlask },
    { id: "plots", label: t("rnaseq.plots"), icon: IconPalette },
  ];
  const [step, setStep] = useState<StepId>("import");
  const [betaNoteOpen, setBetaNoteOpen] = useState(true);
  const st = useRnaSeq();
  const readiness = useStepReadiness();
  const stepIndex = steps.findIndex((s) => s.id === step);

  const goStep = (s: StepId) => {
    if (s === "analysis" && !readiness.importReady && !st.hasResult) {
      showToast("建议先在「数据导入」完成 Counts 文件导入", "info");
    }
    if (s === "plots" && !st.hasResult) {
      showToast("绘图需要差异分析结果:先运行 DEG,或在结果来源处选择历史目录", "info");
    }
    setStep(s);
  };

  // ── 配置存取:保存/加载配置 + 加载结果(对齐 publication_pipeline_wails) ──
  const onSaveConfig = async () => {
    const r = await st.saveConfig();
    if (r.saved) showToast(`配置已保存:${r.path}`, "success");
    else if (r.error) showToast(r.error, "error");
  };
  const onLoadConfig = async () => {
    const picked = await open({
      multiple: false,
      filters: [{ name: "JSON 配置", extensions: ["json"] }],
    });
    if (!picked) return;
    const p = Array.isArray(picked) ? picked[0] : picked;
    const res = await st.loadConfig(p);
    if (res.ok) showToast("配置已加载,请核对分组与比较设置", "success");
    else if (res.error) showToast(res.error, "error");
  };
  const onLoadResult = async () => {
    const picked = await open({
      directory: true,
      multiple: false,
      title: "选择差异分析结果目录(含 RNAseq_Analysis_Results.xlsx)",
    });
    if (!picked) return;
    const p = Array.isArray(picked) ? picked[0] : picked;
    const ok = await st.loadFromPath(p, { mergeParams: true });
    if (ok) goStep("plots");
    else showToast("该目录未找到差异分析结果(RNAseq_Analysis_Results.xlsx)", "info");
  };

  const rscriptTag = () => {
    if (st.rscriptFound === null) {
      return (
        <span className="rx-tag" role="button" onClick={() => void st.recheckRscript()}>
          Rscript 检测中…
        </span>
      );
    }
    if (st.rscriptFound) {
      return (
        <span
          className="rx-tag rx-tag--ok rx-tag--clickable"
          role="button"
          title="点击重新检测"
          onClick={() => void st.recheckRscript()}
        >
          Rscript 就绪
        </span>
      );
    }
    return (
      <span
        className="rx-tag rx-tag--err rx-tag--clickable"
        role="button"
        title="点击重新检测(安装 R 后无需重启)"
        onClick={async () => {
          const ok = await st.recheckRscript();
          showToast(
            ok
              ? "已检测到 Rscript"
              : "仍未找到 Rscript:请安装 R(https://cloud.r-project.org)后重试",
            ok ? "success" : "error",
          );
        }}
      >
        Rscript 未找到
      </span>
    );
  };

  return (
    <div className="page-shell page-shell--wide">
      <div className="panel-header">
        <div className="panel-icon" style={{ background: "#af52de" }}>
          <IconMicroscope size={18} color="white" stroke={1.75} />
        </div>
        <div className="panel-title">
        <h2>
            {t("rnaseq.title")}
            <span className="rx-tag rx-tag--warn" title={t("rnaseq.beta")}>
              {t("rnaseq.beta")}
            </span>
          </h2>
          <p>{t("rnaseq.subtitle")}</p>
        </div>
        <div className="panel-actions">
          {rscriptTag()}
          <HelpButton>{(close) => <RnaSeqTutorial onClose={close} />}</HelpButton>
        </div>
      </div>

      {betaNoteOpen && (
        <div className="rx-beta-note">
          <span className="rx-beta-note-text">
            测试版功能,仍在开发完善中:流程与界面可能调整,重要数据请保留原始文件备份;遇到问题可点右上角「帮助」查看指引。
          </span>
          <button
            type="button"
            className="rx-beta-note-close"
            aria-label="关闭提示"
            onClick={() => setBetaNoteOpen(false)}
          >
            ×
          </button>
        </div>
      )}

      <RnaSeqStatusStrip />

      {/* 三步 tab(macOS 分段控件) */}
      <div className="rx-steps" role="tablist">
        <span
          className="rx-steps-indicator"
          style={{ transform: `translateX(${stepIndex * 100}%)` }}
        />
        {steps.map((s, i) => {
          const Icon = s.icon;
          const ready =
            s.id === "import"
              ? readiness.importReady
              : s.id === "analysis"
                ? readiness.analysisReady
                : readiness.plotsReady;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={step === s.id}
              className={`rx-steps-btn${step === s.id ? " active" : ""}`}
              onClick={() => goStep(s.id)}
            >
              <Icon size={14} stroke={1.75} />
              <span>
                {i + 1}. {s.label}
              </span>
              <span
                className={`rx-steps-dot${ready ? " ready" : ""}`}
                title={ready ? "已就绪" : "未就绪"}
              />
            </button>
          );
        })}
      </div>

      {/* 配置存取工具条:加载配置 / 加载结果 / 保存配置 */}
      <div className="rx-config-bar">
        <button type="button" className="btn" onClick={() => void onLoadConfig()}>
          <IconFileImport size={13} stroke={1.75} /> {t("rnaseq.loadConfig")}
        </button>
        <button type="button" className="btn" onClick={() => void onLoadResult()}>
          <IconFolderOpen size={13} stroke={1.75} /> {t("rnaseq.loadResult")}
        </button>
        <button type="button" className="btn" onClick={() => void onSaveConfig()}>
          <IconDeviceFloppy size={13} stroke={1.75} /> {t("rnaseq.saveConfig")}
        </button>
      </div>

      <StepContent step={step} goStep={goStep} />
    </div>
  );
}

export default function RnaSeqPage() {
  return (
    <RnaSeqProvider>
      <RnaSeqInner />
    </RnaSeqProvider>
  );
}
