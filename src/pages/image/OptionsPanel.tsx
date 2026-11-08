import { open } from "@tauri-apps/plugin-dialog";
import {
  IconInfoCircleFilled,
  IconPhotoFilled,
} from "@tabler/icons-react";
import { useLanguage } from "@/lib/i18n";
import {
  baseName,
  IMAGE_EXTENSIONS,
  type OutputMode,
  type WatermarkPosition,
} from "@/lib/image-convert";

export type WatermarkSettings = {
  kind: "text" | "image";
  content: string;
  font: string;
  fontSize: number;
  bold: boolean;
  color: "white" | "black";
  opacity: number;
  position: WatermarkPosition;
  background: "none" | "opaque" | "semi" | "light";
  imagePath: string;
  scale: number;
};

export interface ConverterSettings {
  mode: "lossless" | "lossy";
  optimizeLevel: number;
  colors: number;
  dither: boolean;
  outputMode: OutputMode;
  customDir: string;
  watermarkOn: boolean;
  watermark: WatermarkSettings;
}

export const DEFAULT_SETTINGS: ConverterSettings = {
  mode: "lossless",
  optimizeLevel: 2,
  colors: 256,
  dither: true,
  outputMode: "subfolder",
  customDir: "",
  watermarkOn: false,
  watermark: {
    kind: "text",
    content: "",
    font: "微软雅黑",
    fontSize: 72,
    bold: true,
    color: "white",
    opacity: 0.85,
    position: "bottom-right",
    background: "none",
    imagePath: "",
    scale: 0.25,
  },
};

const FONTS = ["微软雅黑", "黑体", "宋体", "Arial", "Calibri", "Times New Roman"];
const FONT_SIZES = [36, 48, 60, 72, 96, 120];
const COLOR_COUNTS = [256, 128, 64, 32];

interface OptionsPanelProps {
  settings: ConverterSettings;
  onChange: (patch: Partial<ConverterSettings>) => void;
  onConvert: () => void;
  canConvert: boolean;
  loading: boolean;
}

export default function OptionsPanel({
  settings,
  onChange,
  onConvert,
  canConvert,
  loading,
}: OptionsPanelProps) {
  const { t } = useLanguage();
  const wm = settings.watermark;
  const patchWm = (patch: Partial<WatermarkSettings>) =>
    onChange({ watermark: { ...wm, ...patch } });
  const yesNo = (value: boolean) => (value ? "1" : "0");

  const chooseLogo = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }],
    });
    if (typeof selected === "string") patchWm({ imagePath: selected });
  };

  const chooseOutputDir = async () => {
    const selected = await open({ directory: true });
    if (typeof selected === "string") onChange({ customDir: selected });
  };

  return (
    <>
      <div className="notice">
        <IconInfoCircleFilled size={14} stroke={1.75} />
        <span>{t("imgconv.compressionHint")}</span>
      </div>

      {/* ── 压缩设置 ── */}
      <div className="form-group">
        <label>{t("imgconv.compression")}</label>
        <select
          value={settings.mode}
          onChange={(e) => onChange({ mode: e.target.value as ConverterSettings["mode"] })}
        >
          <option value="lossless">{t("imgconv.modeLossless")}</option>
          <option value="lossy">{t("imgconv.modeLossy")}</option>
        </select>
      </div>

      {settings.mode === "lossless" ? (
        <div className="form-group">
          <label>{t("imgconv.optimizeLevel")}</label>
          <select
            value={settings.optimizeLevel}
            onChange={(e) => onChange({ optimizeLevel: Number(e.target.value) })}
          >
            <option value={1}>{t("imgconv.levelFast")}</option>
            <option value={2}>{t("imgconv.levelBalanced")}</option>
            <option value={3}>{t("imgconv.levelMax")}</option>
          </select>
        </div>
      ) : (
        <div className="form-row">
          <div className="form-group">
            <label>{t("imgconv.colors")}</label>
            <select
              value={settings.colors}
              onChange={(e) => onChange({ colors: Number(e.target.value) })}
            >
              {COLOR_COUNTS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>{t("imgconv.dither")}</label>
            <select
              value={yesNo(settings.dither)}
              onChange={(e) => onChange({ dither: e.target.value === "1" })}
            >
              <option value="1">{t("imgconv.yes")}</option>
              <option value="0">{t("imgconv.no")}</option>
            </select>
          </div>
        </div>
      )}

      {/* ── 水印设置：关闭时占满整行，开启后与水印类型并排 ── */}
      {settings.watermarkOn ? (
        <div className="form-row">
          <div className="form-group">
            <label>{t("imgconv.watermark")}</label>
            <select
              value={yesNo(settings.watermarkOn)}
              onChange={(e) => onChange({ watermarkOn: e.target.value === "1" })}
            >
              <option value="0">{t("imgconv.watermarkOff")}</option>
              <option value="1">{t("imgconv.watermarkOn")}</option>
            </select>
          </div>
          <div className="form-group">
            <label>{t("imgconv.wmKind")}</label>
            <select
              value={wm.kind}
              onChange={(e) => patchWm({ kind: e.target.value as WatermarkSettings["kind"] })}
            >
              <option value="text">{t("imgconv.wmText")}</option>
              <option value="image">{t("imgconv.wmImage")}</option>
            </select>
          </div>
        </div>
      ) : (
        <div className="form-group">
          <label>{t("imgconv.watermark")}</label>
          <select
            value={yesNo(settings.watermarkOn)}
            onChange={(e) => onChange({ watermarkOn: e.target.value === "1" })}
          >
            <option value="0">{t("imgconv.watermarkOff")}</option>
            <option value="1">{t("imgconv.watermarkOn")}</option>
          </select>
        </div>
      )}

      {settings.watermarkOn && wm.kind === "text" && (
        <>
          <div className="form-group">
            <label>{t("imgconv.wmContent")}</label>
            <input
              type="text"
              value={wm.content}
              placeholder={t("imgconv.wmContentHint")}
              onChange={(e) => patchWm({ content: e.target.value })}
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t("imgconv.font")}</label>
              <select value={wm.font} onChange={(e) => patchWm({ font: e.target.value })}>
                {FONTS.map((font) => (
                  <option key={font} value={font}>{font}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>{t("imgconv.fontSize")}</label>
              <select
                value={wm.fontSize}
                onChange={(e) => patchWm({ fontSize: Number(e.target.value) })}
              >
                {FONT_SIZES.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t("imgconv.bold")}</label>
              <select
                value={yesNo(wm.bold)}
                onChange={(e) => patchWm({ bold: e.target.value === "1" })}
              >
                <option value="1">{t("imgconv.yes")}</option>
                <option value="0">{t("imgconv.no")}</option>
              </select>
            </div>
            <div className="form-group">
              <label>{t("imgconv.color")}</label>
              <select
                value={wm.color}
                onChange={(e) => patchWm({ color: e.target.value as WatermarkSettings["color"] })}
              >
                <option value="white">{t("imgconv.white")}</option>
                <option value="black">{t("imgconv.black")}</option>
              </select>
            </div>
          </div>
        </>
      )}

      {settings.watermarkOn && wm.kind === "image" && (
        <div className="form-group">
          <label>{t("imgconv.logo")}</label>
          <button type="button" className="btn btn-full" onClick={chooseLogo}>
            <IconPhotoFilled size={14} stroke={1.75} />
            {wm.imagePath ? baseName(wm.imagePath) : t("imgconv.chooseLogo")}
          </button>
        </div>
      )}

      {settings.watermarkOn && (
        <>
          <div className="form-row">
            <div className="form-group">
              <label>{t("imgconv.opacity")}</label>
              <select
                value={wm.opacity}
                onChange={(e) => patchWm({ opacity: Number(e.target.value) })}
              >
                <option value={1}>100%</option>
                <option value={0.85}>85%</option>
                <option value={0.7}>70%</option>
                <option value={0.5}>50%</option>
              </select>
            </div>
            <div className="form-group">
              <label>{t("imgconv.position")}</label>
              <select
                value={wm.position}
                onChange={(e) => patchWm({ position: e.target.value as WatermarkPosition })}
              >
                <option value="top-left">{t("imgconv.posTL")}</option>
                <option value="top-center">{t("imgconv.posTC")}</option>
                <option value="top-right">{t("imgconv.posTR")}</option>
                <option value="center-left">{t("imgconv.posML")}</option>
                <option value="center">{t("imgconv.posC")}</option>
                <option value="center-right">{t("imgconv.posMR")}</option>
                <option value="bottom-left">{t("imgconv.posBL")}</option>
                <option value="bottom-center">{t("imgconv.posBC")}</option>
                <option value="bottom-right">{t("imgconv.posBR")}</option>
                <option value="tile">{t("imgconv.posTile")}</option>
              </select>
            </div>
          </div>
          {wm.kind === "image" && (
            <div className="form-group">
              <label>{t("imgconv.logoScale")}</label>
              <select
                value={wm.scale}
                onChange={(e) => patchWm({ scale: Number(e.target.value) })}
              >
                <option value={0.1}>10%</option>
                <option value={0.15}>15%</option>
                <option value={0.25}>25%</option>
                <option value={0.4}>40%</option>
                <option value={0.6}>60%</option>
              </select>
            </div>
          )}
          {wm.kind === "text" && (
            <div className="form-group">
              <label>{t("imgconv.background")}</label>
              <select
                value={wm.background}
                onChange={(e) => patchWm({ background: e.target.value as WatermarkSettings["background"] })}
              >
                <option value="none">{t("imgconv.bgNone")}</option>
                <option value="opaque">{t("imgconv.bgOpaque")}</option>
                <option value="semi">{t("imgconv.bgSemi")}</option>
                <option value="light">{t("imgconv.bgLight")}</option>
              </select>
            </div>
          )}
        </>
      )}

      {/* ── 输出设置 ── */}
      <div className="form-group">
        <label>{t("imgconv.output")}</label>
        <select
          value={settings.outputMode}
          onChange={(e) => onChange({ outputMode: e.target.value as OutputMode })}
        >
          <option value="subfolder">{t("imgconv.outSubfolder")}</option>
          <option value="alongside">{t("imgconv.outAlongside")}</option>
          <option value="custom">{t("imgconv.outCustom")}</option>
        </select>
      </div>
      {settings.outputMode === "custom" && (
        <div className="form-group">
          <button type="button" className="btn btn-full" onClick={chooseOutputDir}>
            {settings.customDir ? baseName(settings.customDir) : t("imgconv.chooseDir")}
          </button>
        </div>
      )}
      <div className="imgconv-hint">{t("imgconv.outputHint")}</div>

      <button
        className="btn btn-primary btn-full"
        onClick={onConvert}
        disabled={loading || !canConvert}
        style={{ marginTop: 4 }}
      >
        {loading ? t("imgconv.converting") : canConvert ? t("imgconv.convert") : t("imgconv.chooseFirst")}
      </button>
    </>
  );
}
