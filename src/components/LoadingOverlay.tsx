import { IconX } from "@tabler/icons-react";
import { useLanguage } from "@/lib/i18n";

interface LoadingOverlayProps {
  visible: boolean;
  /** Optional text shown under the spinner (e.g. "正在生成图表 (3/12)") */
  text?: string;
  /**
   * Progress percentage 0-100, or null/undefined for an indeterminate bar.
   * When provided the bar shows determinate fill; otherwise a sliding shimmer.
   */
  progress?: number | null;
  onCancel?: () => void;
  cancelLabel?: string;
  cancelDisabled?: boolean;
  /** Use a non-blocking, in-page live activity when the host already shows details. */
  variant?: "modal" | "live";
}

export default function LoadingOverlay({
  visible,
  text,
  progress,
  onCancel,
  cancelLabel,
  cancelDisabled = false,
  variant = "modal",
}: LoadingOverlayProps) {
  const { t } = useLanguage();
  if (!visible) return null;

  const live = variant === "live";
  const determinate = typeof progress === "number" && Number.isFinite(progress);
  const pct = determinate ? Math.max(0, Math.min(100, progress as number)) : 0;
  const showText = text ?? (determinate ? `${Math.round(pct)}%` : t("loading.processing"));

  return (
    <div
      className={`loading-overlay${live ? " loading-overlay--live" : ""}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="loading-box">
        <div className="spinner" />
        {showText && <div className="loading-text">{showText}</div>}
        <div className="loading-progress-track">
          {determinate ? (
            <div
              className="loading-progress-fill"
              style={{ width: `${pct}%` }}
              aria-valuenow={Math.round(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
              role="progressbar"
            />
          ) : (
            <div className="loading-progress-indeterminate" />
          )}
        </div>
        {onCancel && (
          <button
            type="button"
            className="loading-cancel"
            onClick={onCancel}
            disabled={cancelDisabled}
          >
            <IconX size={14} />
            {cancelLabel ?? t("loading.cancel")}
          </button>
        )}
      </div>
    </div>
  );
}
