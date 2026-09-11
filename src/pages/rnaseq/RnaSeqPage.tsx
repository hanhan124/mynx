/**
 * RNA-seq 差异分析流水线 — 主页面。
 *
 * 三步向导:数据导入 → 差异分析 → 绘图导出。
 * 进入本页时窗口最大化(保留任务栏的标准最大化,非全屏),离开时恢复进入前状态;
 * 设计体系完全沿用 mynx(Tahoe 令牌 / surface 渐变 / tabler 图标 / spring 动效)。
 */
import { useMemo, useState } from "react";
import { ask, open } from "@tauri-apps/plugin-dialog";
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
import { installRRuntime } from "@/lib/rnaseq/runner";

type StepId = "import" | "analysis" | "plots";

function StepContent({ step, goStep }: { step: StepId; goStep: (s: StepId) => void }) {
  if (step === "import") return <ImportStep />;
  if (step === "analysis") return <AnalysisStep goPlots={() => goStep("plots")} />;
  return <PlotsStep goAnalysis={() => goStep("analysis")} />;
}

/** 步骤就绪状态。步骤只在其前提完成后开放，避免用户跳到没有可执行操作的页面。 */
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

function RnaSeqInner() {
  const { t } = useLanguage();
  const steps: { id: StepId; label: string; icon: typeof IconFileImport }[] = [
    { id: "import", label: t("rnaseq.import"), icon: IconFileImport },
    { id: "analysis", label: t("rnaseq.analysis"), icon: IconFlask },
    { id: "plots", label: t("rnaseq.plots"), icon: IconPalette },
  ];
  const [step, setStep] = useState<StepId>("import");
  const st = useRnaSeq();
  const readiness = useStepReadiness();
  const stepIndex = steps.findIndex((s) => s.id === step);

  const goStep = (s: StepId) => {
    if (s === "analysis" && !readiness.importReady && !st.hasResult) {
      showToast("请先完成 Counts 数据导入", "info");
      return;
    }
    if (s === "plots" && !st.hasResult) {
      showToast("绘图需要差异分析结果:先运行 DEG,或在结果来源处选择历史目录", "info");
      return;
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
          const consent = await ask("未检测到 R。是否现在通过系统包管理器安装？", {
            title: "安装 R",
            kind: "info",
          });
          if (!consent) return;
          showToast("正在安装 R，完成后会自动重新检测…", "info");
          const installed = await installRRuntime();
          if (!installed.ok) {
            showToast(installed.error || "R 安装未完成", "error");
            return;
          }
          const ok = await st.recheckRscript();
          showToast(
            ok ? "已检测到 Rscript" : "R 已安装但尚未被检测到，请重新打开软件后再试",
            ok ? "success" : "info",
          );
        }}
      >
        Rscript 未找到
      </span>
    );
  };

  return (
    <div className="page-shell page-shell--wide unified-page unified-page--rnaseq">
      <div className="panel-header">
        <div className="panel-icon" style={{ background: "#af52de" }}>
          <IconMicroscope size={18} color="white" stroke={1.75} />
        </div>
        <div className="panel-title">
          <h2>{t("rnaseq.title")}</h2>
          <p>{t("rnaseq.subtitle")}</p>
        </div>
        <div className="panel-actions">
          {rscriptTag()}
          <HelpButton>{(close) => <RnaSeqTutorial onClose={close} />}</HelpButton>
        </div>
      </div>

      {/* 三步工作流:只开放已满足前置条件的下一步，避免进入空页面。 */}
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
                title={ready ? "已完成" : i > stepIndex ? "完成上一步后开放" : "待完成"}
              />
            </button>
          );
        })}
      </div>

      <details className="rx-project-menu">
        <summary>
          {t("rnaseq.loadConfig")} / {t("rnaseq.loadResult")}
        </summary>
        <div className="rx-project-menu-actions">
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
      </details>

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
