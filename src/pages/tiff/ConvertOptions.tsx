import { useState } from "react";
import { IconInfoCircleFilled } from "@tabler/icons-react";
import type { TiffOptions } from "@/lib/tiff-convert";
import { useLanguage } from "@/lib/i18n";

const FONTS = ["Arial", "Calibri", "Times New Roman", "微软雅黑", "黑体", "宋体"];
const SIZES = [36, 48, 60, 72, 96, 120];
const QUALITIES = [80, 85, 90, 95, 98];

interface ConvertOptionsProps {
  onConvert: (options: TiffOptions) => void;
  loading: boolean;
  disabled?: boolean;
}

export default function ConvertOptions({ onConvert, loading, disabled }: ConvertOptionsProps) {
  const { t } = useLanguage();
  const [addLabel, setAddLabel] = useState(true);
  const [font, setFont] = useState("Arial");
  const [fontSize, setFontSize] = useState(72);
  const [bold, setBold] = useState(true);
  const [italic, setItalic] = useState(false);
  const [marginX, setMarginX] = useState("18");
  const [marginY, setMarginY] = useState("18");
  const [paddingX, setPaddingX] = useState("12");
  const [paddingY, setPaddingY] = useState("8");
  const [bgAlpha, setBgAlpha] = useState("210");
  const [quality, setQuality] = useState(95);

  const handleConvert = () => {
    // Clamp numeric fields to their declared min/max so that an empty
    // input (Number("") === 0) or a manually-typed out-of-range value
    // never produces a broken TIFF script. NaN/empty falls back to the
    // field's current default rather than silently sending 0.
    const clamp = (raw: string, lo: number, hi: number, fallback: number): number => {
      const n = Number(raw);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(lo, Math.min(hi, n));
    };

    onConvert({
      watermark: addLabel,
      font,
      fontSize,
      bold,
      italic,
      marginX: clamp(marginX, 0, 200, 18),
      marginY: clamp(marginY, 0, 200, 18),
      paddingX: clamp(paddingX, 0, 50, 12),
      paddingY: clamp(paddingY, 0, 50, 8),
      transparency: clamp(bgAlpha, 0, 255, 210) / 255,
      quality,
    });
  };

  const showTextOpts = addLabel;

  return (
    <>
      <div className="notice">
        <IconInfoCircleFilled size={14} stroke={1.75} />
        <span>{t("tiff.optionsHint")}</span>
      </div>

      <div className="form-group">
        <label>{t("tiff.watermark")}</label>
        <select value={addLabel ? "1" : "0"} onChange={(e) => setAddLabel(e.target.value === "1")}>
          <option value="1">{t("tiff.yesLabel")}</option>
          <option value="0">{t("tiff.noLabel")}</option>
        </select>
      </div>

      {showTextOpts && (
        <>
          <div className="form-row">
            <div className="form-group">
              <label>{t("tiff.font")}</label>
              <select value={font} onChange={(e) => setFont(e.target.value)}>
                {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{t("tiff.fontSize")}</label>
              <select value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))}>
                {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>{t("tiff.bold")}</label>
              <select value={bold ? "1" : "0"} onChange={(e) => setBold(e.target.value === "1")}>
                <option value="1">{t("tiff.yes")}</option>
                <option value="0">{t("tiff.no")}</option>
              </select>
            </div>
            <div className="form-group">
              <label>{t("tiff.italic")}</label>
              <select value={italic ? "1" : "0"} onChange={(e) => setItalic(e.target.value === "1")}>
                <option value="0">{t("tiff.no")}</option>
                <option value="1">{t("tiff.yes")}</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>{t("tiff.marginLeft")}</label>
              <input type="number" value={marginX} onChange={(e) => setMarginX(e.target.value)} min={0} max={200} />
            </div>
            <div className="form-group">
              <label>{t("tiff.marginTop")}</label>
              <input type="number" value={marginY} onChange={(e) => setMarginY(e.target.value)} min={0} max={200} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>{t("tiff.paddingX")}</label>
              <input type="number" value={paddingX} onChange={(e) => setPaddingX(e.target.value)} min={0} max={50} />
            </div>
            <div className="form-group">
              <label>{t("tiff.paddingY")}</label>
              <input type="number" value={paddingY} onChange={(e) => setPaddingY(e.target.value)} min={0} max={50} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>{t("tiff.backgroundOpacity")}</label>
              <select value={bgAlpha} onChange={(e) => setBgAlpha(e.target.value)}>
                {[
                  { label: t("tiff.opaque"), value: 255 },
                  { label: t("tiff.semiTransparent"), value: 210 },
                  { label: t("tiff.moreTransparent"), value: 128 },
                  { label: t("tiff.transparent"), value: 0 },
                ].map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>{t("tiff.quality")}</label>
              <select value={quality} onChange={(e) => setQuality(Number(e.target.value))}>
                {QUALITIES.map((q) => <option key={q} value={q}>{q}</option>)}
              </select>
            </div>
          </div>
        </>
      )}

      <button
        className="btn btn-primary btn-full"
        onClick={handleConvert}
        disabled={loading || disabled}
        style={{ marginTop: 4 }}
      >
        {loading ? t("tiff.converting") : disabled ? t("tiff.chooseFirst") : t("tiff.convert")}
      </button>
    </>
  );
}
