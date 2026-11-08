/**
 * RNA-seq 差异分析流水线 — 主页面。
 *
 * 三步向导:数据导入 → 分组与分析 → 图形输出。
 * 分析引擎为 r/rnaseq_engine.R(参考脚本 rnaseq_DE_heatmap.R 的原样移植),
 * 本页只负责配置收集、运行调度与结果展示。
 */
import { useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
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
import { RnaSeqProvider, useRnaSeq } from "./store";
import ImportStep from "./ImportStep";
import DesignStep from "./DesignStep";
import PlotsStep from "./PlotsStep";
import { RnaSeqTutorial } from "./RnaSeqTutorial";
import { useLanguage } from "@/lib/i18n";
import { installRRuntime } from "@/lib/rnaseq/runner";

type StepId = "import" | "analysis" | "plots";

function StepContent({ step, goStep }: { step: StepId; goStep: (s: StepId) => void }) {
  if (step === "import") return <ImportStep />;
  if (step === "analysis") return <DesignStep goPlots={() => goStep("plots")} />;
  return <PlotsStep goAnalysis={() => goStep("analysis")} />;
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

  const goStep = (s: StepId) => {
    if (s !== "import" && !st.config.data_file) {
      showToast("请先完成 Counts 数据导入", "info");
      return;
    }
    if (s === "plots" && !st.hasResult) {
      showToast("绘图需要差异分析结果:先运行 DE,或在「图形输出」加载结果目录", "info");
      return;
    }
    setStep(s);
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
          const consent = await ask("未检测到 R。是否现在通过系统包管理器安装?", {
            title: "安装 R",
            kind: "info",
          });
          if (!consent) return;
          showToast("正在安装 R,完成后会自动重新检测…", "info");
          const installed = await installRRuntime();
          if (!installed.ok) {
            showToast(installed.error || "R 安装未完成", "error");
            return;
          }
          const ok = await st.recheckRscript();
          showToast(
            ok ? "已检测到 Rscript" : "R 已安装但尚未被检测到,请重新打开软件后再试",
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
        <div className="panel-icon panel-icon--purple">
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

      {/* 三步工作流 */}
      <div className="rx-steps" role="tablist">
        <span
          className="rx-steps-indicator"
          style={{ transform: `translateX(${steps.findIndex((s) => s.id === step) * 100}%)` }}
        />
        {steps.map((s, i) => {
          const Icon = s.icon;
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
                className={`rx-steps-dot${
                  (s.id === "import" && !!st.config.data_file) ||
                  (s.id === "analysis" && st.hasResult) ||
                  (s.id === "plots" && st.resultImages.length > 0)
                    ? " ready"
                    : ""
                }`}
              />
            </button>
          );
        })}
      </div>

      <details className="rx-project-menu">
        <summary>
          {t("rnaseq.loadConfig")} / {t("rnaseq.loadResult")} / {t("rnaseq.saveConfig")}
        </summary>
        <div className="rx-project-menu-actions">
          <button type="button" className="btn" onClick={() => void st.loadConfig()}>
            <IconFileImport size={13} stroke={1.75} /> {t("rnaseq.loadConfig")}
          </button>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const { open } = await import("@tauri-apps/plugin-dialog");
              const picked = await open({
                directory: true,
                multiple: false,
                title: "选择引擎运行结果目录(含 DE/heatmap/plots)",
              });
              if (!picked) return;
              const p = Array.isArray(picked) ? picked[0] : picked;
              const ok = await st.loadResultDir(p);
              if (ok) setStep("plots");
            }}
          >
            <IconFolderOpen size={13} stroke={1.75} /> {t("rnaseq.loadResult")}
          </button>
          <button type="button" className="btn" onClick={() => void st.saveConfig()}>
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
