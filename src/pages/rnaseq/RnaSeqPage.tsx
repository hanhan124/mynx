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
import { Button, Group, Stack, Tabs, Text, ThemeIcon } from "@mantine/core";

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
      <Group className="panel-header" justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="sm" wrap="nowrap" miw={0}>
          <ThemeIcon size={36} radius="md" color="violet">
            <IconMicroscope size={18} stroke={1.75} />
          </ThemeIcon>
          <Stack gap={2} miw={0}>
            <Text fw={700} size="lg" truncate>{t("rnaseq.title")}</Text>
            <Text size="sm" c="dimmed" truncate>{t("rnaseq.subtitle")}</Text>
          </Stack>
        </Group>
        <Group className="panel-actions" gap="xs" wrap="nowrap">
          {rscriptTag()}
          <HelpButton>{(close) => <RnaSeqTutorial onClose={close} />}</HelpButton>
        </Group>
      </Group>

      {/* 三步工作流 */}
      <Tabs value={step} onChange={(value) => value && goStep(value as StepId)} className="rx-steps">
        <Tabs.List>
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <Tabs.Tab
              key={s.id}
              value={s.id}
              leftSection={<Icon size={14} stroke={1.75} />}
            >
              {i + 1}. {s.label}
              <span
                className={`rx-steps-dot${
                  (s.id === "import" && !!st.config.data_file) ||
                  (s.id === "analysis" && st.hasResult) ||
                  (s.id === "plots" && st.resultImages.length > 0)
                    ? " ready"
                    : ""
                }`}
              />
            </Tabs.Tab>
          );
        })}
        </Tabs.List>
      </Tabs>

      <details className="rx-project-menu">
        <summary>
          {t("rnaseq.loadConfig")} / {t("rnaseq.loadResult")} / {t("rnaseq.saveConfig")}
        </summary>
        <div className="rx-project-menu-actions">
          <Button type="button" variant="default" size="sm" onClick={() => void st.loadConfig()}>
            <IconFileImport size={13} stroke={1.75} /> {t("rnaseq.loadConfig")}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
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
          </Button>
          <Button type="button" variant="default" size="sm" onClick={() => void st.saveConfig()}>
            <IconDeviceFloppy size={13} stroke={1.75} /> {t("rnaseq.saveConfig")}
          </Button>
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
