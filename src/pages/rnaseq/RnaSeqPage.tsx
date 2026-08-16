/**
 * RNA-seq 差异分析流水线 — 主页面。
 *
 * 三步向导:数据导入 → 差异分析 → 绘图导出。
 * 进入本页时窗口最大化(保留任务栏的标准最大化,非全屏),离开时恢复进入前状态;
 * 设计体系完全沿用 mynx(Tahoe 令牌 / surface 渐变 / tabler 图标 / spring 动效)。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  IconMicroscope,
  IconFileImport,
  IconFlask,
  IconPalette,
} from "@tabler/icons-react";
import { showToast } from "@/components/Toast";
import HelpButton from "@/components/HelpButton";
import { RnaSeqProvider, useRnaSeq, validComparisonsOf } from "./store";
import ImportStep from "./ImportStep";
import AnalysisStep from "./AnalysisStep";
import PlotsStep from "./PlotsStep";
import { RnaSeqTutorial } from "./RnaSeqTutorial";

type StepId = "import" | "analysis" | "plots";

const STEPS: { id: StepId; label: string; icon: typeof IconFileImport }[] = [
  { id: "import", label: "数据导入", icon: IconFileImport },
  { id: "analysis", label: "差异分析", icon: IconFlask },
  { id: "plots", label: "绘图导出", icon: IconPalette },
];

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

function RnaSeqInner() {
  const [step, setStep] = useState<StepId>("import");
  const [betaNoteOpen, setBetaNoteOpen] = useState(true);
  // 进入呈现:窗口最大化落定后内容统一淡入,避免窗口缩放与内容重排两段动画叠加掉帧
  const [revealed, setRevealed] = useState(false);
  const [enterDone, setEnterDone] = useState(false);
  const st = useRnaSeq();
  const readiness = useStepReadiness();
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  // ── 窗口最大化/恢复 ──
  // 进入 → 最大化(标准最大化,保留任务栏;macOS 为 zoom 填满屏幕);
  // 离开 → 恢复进入前的尺寸与位置。
  // 注:Windows 无装饰窗口有两个 tao 怪癖 —— ① unmaximize 不还原 bounds,
  // 需显式 setSize/setPosition;② 最大化状态下 set_min_size 会直接破坏最大化
  // 标志。因此这里完全不动最小尺寸约束,只做最大化/还原。
  const enterState = useRef<{
    wasMax: boolean;
    norm?: { w: number; h: number; x: number; y: number };
  } | null>(null);
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const win = getCurrentWindow();
    // 卸载后立即重挂载(dev StrictMode / HMR):取消已排定的恢复,避免最大化闪烁
    if (restoreTimer.current) {
      clearTimeout(restoreTimer.current);
      restoreTimer.current = null;
    }
    void (async () => {
      let delay = 0;
      try {
        if (enterState.current) {
          // 重挂载:沿用首次进入的处理结果(窗口已最大化,直接呈现)
        } else {
          const wasMax = await win.isMaximized();
          if (wasMax) {
            enterState.current = { wasMax: true };
          } else {
            const scale = await win.scaleFactor();
            const inner = await win.innerSize();
            const pos = await win.outerPosition();
            enterState.current = {
              wasMax: false,
              norm: {
                w: inner.width / scale,
                h: inner.height / scale,
                x: pos.x,
                y: pos.y,
              },
            };
            await win.maximize().catch(() => {});
            // 等最大化过渡与 WebView 重排完成后再呈现内容(内容此时 opacity:0,
            // WebView 无需在缩放过程中绘制重 DOM,窗口动画因此不掉帧)
            delay = 200;
          }
        }
      } catch {
        /* 非 Tauri 环境(纯浏览器开发)忽略 */
      }
      revealTimer.current = setTimeout(() => {
        revealTimer.current = null;
        setRevealed(true);
      }, delay);
    })();
    return () => {
      if (revealTimer.current) {
        clearTimeout(revealTimer.current);
        revealTimer.current = null;
      }
      const st = enterState.current;
      // 恢复延迟一小拍:若组件随即重挂载,上面的挂载逻辑会取消它
      restoreTimer.current = setTimeout(() => {
        restoreTimer.current = null;
        void (async () => {
          try {
            const curMax = await win.isMaximized();
            if (curMax && st && !st.wasMax && st.norm) {
              // 进入前是普通窗口 → 还原进入前的尺寸与位置
              await win.unmaximize().catch(() => {});
              await win
                .setSize(new LogicalSize(st.norm.w, st.norm.h))
                .catch(() => {});
              await win
                .setPosition(new PhysicalPosition(st.norm.x, st.norm.y))
                .catch(() => {});
            }
            // 其余情形(进入前已最大化 / 页内手动还原过)不干预
            enterState.current = null; // 真正离开,复位供下次进入
          } catch {
            /* ignore */
          }
        })();
      }, 120);
    };
  }, []);

  const goStep = (s: StepId) => {
    if (s === "analysis" && !readiness.importReady && !st.hasResult) {
      showToast("建议先在「数据导入」完成 Counts 文件导入", "info");
    }
    if (s === "plots" && !st.hasResult) {
      showToast("绘图需要差异分析结果:先运行 DEG,或在结果来源处选择历史目录", "info");
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
    <div
      className={`page-shell page-shell--wide rx-enter${
        enterDone ? "" : revealed ? " rx-enter--in" : " rx-enter--hidden"
      }`}
      onAnimationEnd={(e) => {
        // 入场动画结束后移除动画类:清除 transform,避免影响内联 Modal 的 fixed 定位
        if (e.target === e.currentTarget) setEnterDone(true);
      }}
    >
      <div className="panel-header">
        <div className="panel-icon" style={{ background: "#af52de" }}>
          <IconMicroscope size={18} color="white" stroke={1.75} />
        </div>
        <div className="panel-title">
          <h2>
            RNA-seq 分析
            <span className="rx-tag rx-tag--warn" title="测试版功能,仍在开发完善中">
              测试版
            </span>
          </h2>
          <p>差异分析(DESeq2 / edgeR)与图表导出</p>
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

      {/* 三步 tab(macOS 分段控件) */}
      <div className="rx-steps" role="tablist">
        <span
          className="rx-steps-indicator"
          style={{ transform: `translateX(${stepIndex * 100}%)` }}
        />
        {STEPS.map((s, i) => {
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
