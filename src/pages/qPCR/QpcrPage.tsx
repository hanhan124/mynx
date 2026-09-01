import { useState, useCallback } from "react";
import {
  IconArrowRight,
  IconChartBar,
  IconDna,
  IconFileSpreadsheet,
  IconFlask,
} from "@tabler/icons-react";
import FileSelect from "./FileSelect";
import Transform from "./Transform";
import Calculate from "./Calculate";
import QpcrPlotter from "./QpcrPlotter";
import LoadingOverlay from "@/components/LoadingOverlay";
import HelpButton, { QpcrTutorial } from "@/components/HelpButton";
import type { ExcelFile } from "@/lib/excel-io";
import { saveExcelFile } from "@/lib/excel-io";
import { generateChartsFromFile } from "@/lib/chart-gen";
import { detectTransformedGenes } from "@/lib/qpcr-transform";
import { showToast } from "@/components/Toast";
import { useLanguage } from "@/lib/i18n";

export default function QpcrPage() {
  const { t, language } = useLanguage();
  const [file, setFile] = useState<ExcelFile | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [geneNames, setGeneNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  /** 0-100 determinate, or null for indeterminate. */
  const [progress, setProgress] = useState<number | null>(null);

  const startStage = useCallback(
    (text: string, mode: "determinate" | "indeterminate" = "indeterminate") => {
      setLoadingText(text);
      setProgress(mode === "indeterminate" ? null : 0);
      setLoading(true);
    },
    [],
  );

  const endStage = useCallback(() => {
    setLoading(false);
    setProgress(null);
  }, []);

  const updateProgress = useCallback((current: number, total: number, text?: string) => {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    setProgress(pct);
    if (text) setLoadingText(text);
    setLoading(true);
  }, []);

  const silentSave = useCallback(async (): Promise<boolean> => {
    if (!file) return false;
    try {
      await saveExcelFile(file.workbook, file.path);
      return true;
    } catch (e) {
      showToast(
        t("qpcr.saveFailed", { detail: e instanceof Error ? e.message : String(e) }),
        "error",
      );
      return false;
    }
  }, [file]);

  const handleTransformComplete = useCallback(
    async (names: string[]) => {
      setGeneNames(names);
      startStage(t("qpcr.save"), "indeterminate");
      try {
        const saved = await silentSave();
        if (!saved) return;
      } finally {
        endStage();
      }
    },
    [silentSave, startStage, endStage],
  );

  const handleCalculateComplete = useCallback(
    async (
      repeatCount: number,
      chartColor: string,
      methodOptions: {
        method: "ref-normalized" | "control-relative";
        controlGroup?: string;
      },
    ) => {
      if (!file) return;
      try {
        startStage(t("qpcr.save"), "indeterminate");
        await silentSave();

        startStage(t("qpcr.generating"), "determinate");
        const result = await generateChartsFromFile(
          file.path,
          repeatCount,
          chartColor,
          (current, total) => {
            updateProgress(
              current,
              total,
              `${t("qpcr.generating")} (${current}/${total})...`,
            );
          },
          methodOptions,
        );
        if (result.success) {
          const created = result.chartsCreated ?? 0;
          const tail = result.reason ? `，${result.reason}` : "";
          showToast(t("qpcr.chartComplete", { count: created, detail: tail }), "success");
        } else {
          showToast(
            t("qpcr.chartFailed", {
              detail: result.reason ?? (language === "en" ? "Unknown error" : "未知错误"),
            }),
            "error",
          );
        }
      } catch (e) {
        showToast(t("qpcr.chartError", { detail: String(e) }), "error");
      } finally {
        endStage();
      }
    },
    [file, silentSave, startStage, endStage, updateProgress],
  );

  return (
    <div className="page-shell page-shell--wide qpcr-page">
      <LoadingOverlay visible={loading} text={loadingText} progress={progress} />

      <header className="qpcr-page-hero">
        <div className="qpcr-hero-copy">
          <div className="qpcr-hero-title-row">
            <div className="panel-icon" style={{ background: "#0a84ff" }}>
              <IconDna size={19} color="white" stroke={1.75} />
            </div>
            <div className="panel-title">
              <h2>{t("qpcr.title")}</h2>
              <p>{t("qpcr.subtitle")}</p>
            </div>
          </div>
        </div>
        <div className="qpcr-hero-side">
          <HelpButton>{(close) => <QpcrTutorial onClose={close} />}</HelpButton>
        </div>
      </header>

      <div className="qpcr-workflow-overview" aria-label="qPCR workflow">
        <div className="qpcr-overview-step is-current">
          <span className="qpcr-overview-index">01</span>
          <span>
            <strong>{t("qpcr.transform")}</strong>
          </span>
        </div>
        <span className="qpcr-overview-connector">
          <IconArrowRight size={14} />
        </span>
        <div className="qpcr-overview-step">
          <span className="qpcr-overview-index">02</span>
          <span>
            <strong>{t("qpcr.calculate")}</strong>
          </span>
        </div>
        <span className="qpcr-overview-connector">
          <IconArrowRight size={14} />
        </span>
        <div className="qpcr-overview-step">
          <span className="qpcr-overview-index">
            <IconChartBar size={13} />
          </span>
          <span>
            <strong>绘图与导出</strong>
          </span>
        </div>
      </div>

      {/* 步骤 0: 文件 */}
      <section className="card qpcr-source-card">
        <div className="qpcr-section-head">
          <div className="qpcr-section-title">
            <span className="qpcr-section-icon qpcr-section-icon--green">
              <IconFileSpreadsheet size={15} stroke={1.75} />
            </span>
            <span>
              <strong>{t("qpcr.dataFile")}</strong>
            </span>
          </div>
        </div>
        <div className="qpcr-source-layout">
          <div className="qpcr-source-main">
            <FileSelect
              file={file}
              sheetName={sheetName}
              onFileChange={(f) => {
                setFile(f);
                if (f) {
                  // Auto-detect gene names if file already has Transformed Data sheet
                  const genes = detectTransformedGenes(f.workbook);
                  setGeneNames(genes);
                } else {
                  setSheetName("");
                  setGeneNames([]);
                  endStage();
                }
              }}
              onSheetChange={setSheetName}
            />
          </div>
        </div>
      </section>

      {/* 步骤 1 + 2: 宽屏并排(转换 / 计算), 窄屏自动回退单列堆叠 */}
      <div className="card-grid card-grid--2 qpcr-processing-grid">
        {/* 步骤 1: 转换 — 始终显示 */}
        <section className="card qpcr-step-card qpcr-step-card--transform">
          <div className="qpcr-step-head">
            <span className="qpcr-step-index">01</span>
            <span className="qpcr-step-heading">
              <strong>{t("qpcr.transform")}</strong>
            </span>
            <span className="qpcr-step-mark">
              <IconFlask size={14} />
            </span>
          </div>
          <div className="card-body qpcr-step-body">
            <Transform
              workbook={file?.workbook ?? null}
              sheetName={sheetName}
              onComplete={handleTransformComplete}
              onProgress={updateProgress}
              onError={endStage}
            />
          </div>
        </section>

        {/* 步骤 2: 计算 — 始终显示 */}
        <section className="card qpcr-step-card qpcr-step-card--calculate">
          <div className="qpcr-step-head">
            <span className="qpcr-step-index">02</span>
            <span className="qpcr-step-heading">
              <strong>{t("qpcr.calculate")}</strong>
            </span>
            <span className="qpcr-step-mark">
              <IconDna size={14} />
            </span>
          </div>
          <div className="card-body qpcr-step-body">
            <Calculate
              workbook={file?.workbook ?? null}
              geneNames={geneNames}
              onComplete={handleCalculateComplete}
              onProgress={updateProgress}
              onError={endStage}
            />
          </div>
        </section>
      </div>

      {/* 步骤 3: 柱状图与热图 — 使用独立文件选框，避免与前两步的数据状态冲突 */}
      <QpcrPlotter />
    </div>
  );
}
