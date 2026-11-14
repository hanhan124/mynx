import { open } from "@tauri-apps/plugin-dialog";
import {
  IconInfoCircleFilled,
  IconPhotoFilled,
} from "@tabler/icons-react";
import { useLanguage } from "@/lib/i18n";
import { Button, Select, TextInput } from "@mantine/core";
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
        <Select
          size="sm"
          data={[{ value: "lossless", label: t("imgconv.modeLossless") }, { value: "lossy", label: t("imgconv.modeLossy") }]}
          label={t("imgconv.compression")}
          value={settings.mode}
          onChange={(value) => onChange({ mode: (value ?? "lossless") as ConverterSettings["mode"] })}
        />
      </div>

      {settings.mode === "lossless" ? (
        <div className="form-group">
          <label>{t("imgconv.optimizeLevel")}</label>
          <Select
            size="sm"
            data={[{ value: "1", label: t("imgconv.levelFast") }, { value: "2", label: t("imgconv.levelBalanced") }, { value: "3", label: t("imgconv.levelMax") }]}
            label={t("imgconv.optimizeLevel")}
            value={String(settings.optimizeLevel)}
            onChange={(value) => onChange({ optimizeLevel: Number(value ?? 2) })}
          />
        </div>
      ) : (
        <div className="form-row">
          <div className="form-group">
            <label>{t("imgconv.colors")}</label>
            <Select
              size="sm"
              data={COLOR_COUNTS.map((c) => String(c))}
              label={t("imgconv.colors")}
              value={String(settings.colors)}
              onChange={(value) => onChange({ colors: Number(value ?? 256) })}
            />
          </div>
          <div className="form-group">
            <label>{t("imgconv.dither")}</label>
            <Select
              size="sm"
              data={[{ value: "1", label: t("imgconv.yes") }, { value: "0", label: t("imgconv.no") }]}
              label={t("imgconv.dither")}
              value={yesNo(settings.dither)}
              onChange={(value) => onChange({ dither: value === "1" })}
            />
          </div>
        </div>
      )}

      {/* ── 水印设置：关闭时占满整行，开启后与水印类型并排 ── */}
      {settings.watermarkOn ? (
        <div className="form-row">
          <div className="form-group">
            <Select
              size="sm"
              data={[{ value: "0", label: t("imgconv.watermarkOff") }, { value: "1", label: t("imgconv.watermarkOn") }]}
              label={t("imgconv.watermark")}
              value={yesNo(settings.watermarkOn)}
              onChange={(value) => onChange({ watermarkOn: value === "1" })}
            />
          </div>
          <div className="form-group">
            <Select
              size="sm"
              data={[{ value: "text", label: t("imgconv.wmText") }, { value: "image", label: t("imgconv.wmImage") }]}
              label={t("imgconv.wmKind")}
              value={wm.kind}
              onChange={(value) => patchWm({ kind: (value ?? "text") as WatermarkSettings["kind"] })}
            />
          </div>
        </div>
      ) : (
        <div className="form-group">
          <label>{t("imgconv.watermark")}</label>
          <Select
            size="sm"
            data={[{ value: "0", label: t("imgconv.watermarkOff") }, { value: "1", label: t("imgconv.watermarkOn") }]}
            label={t("imgconv.watermark")}
            value={yesNo(settings.watermarkOn)}
            onChange={(value) => onChange({ watermarkOn: value === "1" })}
          />
        </div>
      )}

      {settings.watermarkOn && wm.kind === "text" && (
        <>
          <div className="form-group">
            <label>{t("imgconv.wmContent")}</label>
            <TextInput
              size="sm"
              label={t("imgconv.wmContent")}
              value={wm.content}
              placeholder={t("imgconv.wmContentHint")}
              onChange={(event) => patchWm({ content: event.currentTarget.value })}
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t("imgconv.font")}</label>
              <Select size="sm" data={FONTS} label={t("imgconv.font")} value={wm.font} onChange={(value) => patchWm({ font: value ?? FONTS[0] })} />
            </div>
            <div className="form-group">
              <label>{t("imgconv.fontSize")}</label>
              <Select size="sm" data={FONT_SIZES.map(String)} label={t("imgconv.fontSize")} value={String(wm.fontSize)} onChange={(value) => patchWm({ fontSize: Number(value ?? 72) })} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t("imgconv.bold")}</label>
              <Select size="sm" data={[{ value: "1", label: t("imgconv.yes") }, { value: "0", label: t("imgconv.no") }]} label={t("imgconv.bold")} value={yesNo(wm.bold)} onChange={(value) => patchWm({ bold: value === "1" })} />
            </div>
            <div className="form-group">
              <label>{t("imgconv.color")}</label>
              <Select size="sm" data={[{ value: "white", label: t("imgconv.white") }, { value: "black", label: t("imgconv.black") }]} label={t("imgconv.color")} value={wm.color} onChange={(value) => patchWm({ color: (value ?? "white") as WatermarkSettings["color"] })} />
            </div>
          </div>
        </>
      )}

      {settings.watermarkOn && wm.kind === "image" && (
        <div className="form-group">
          <label>{t("imgconv.logo")}</label>
          <Button type="button" variant="default" fullWidth onClick={chooseLogo}>
            <IconPhotoFilled size={14} stroke={1.75} />
            {wm.imagePath ? baseName(wm.imagePath) : t("imgconv.chooseLogo")}
          </Button>
        </div>
      )}

      {settings.watermarkOn && (
        <>
          <div className="form-row">
            <div className="form-group">
              <label>{t("imgconv.opacity")}</label>
              <Select size="sm" data={["1", "0.85", "0.7", "0.5"]} label={t("imgconv.opacity")} value={String(wm.opacity)} onChange={(value) => patchWm({ opacity: Number(value ?? 0.85) })} />
            </div>
            <div className="form-group">
              <label>{t("imgconv.position")}</label>
              <Select size="sm" data={["top-left", "top-center", "top-right", "center-left", "center", "center-right", "bottom-left", "bottom-center", "bottom-right", "tile"]} label={t("imgconv.position")} value={wm.position} onChange={(value) => patchWm({ position: (value ?? "bottom-right") as WatermarkPosition })} />
            </div>
          </div>
          {wm.kind === "image" && (
            <div className="form-group">
              <label>{t("imgconv.logoScale")}</label>
              <Select size="sm" data={["0.1", "0.15", "0.25", "0.4", "0.6"]} label={t("imgconv.logoScale")} value={String(wm.scale)} onChange={(value) => patchWm({ scale: Number(value ?? 0.25) })} />
            </div>
          )}
          {wm.kind === "text" && (
            <div className="form-group">
              <label>{t("imgconv.background")}</label>
              <Select size="sm" data={["none", "opaque", "semi", "light"]} label={t("imgconv.background")} value={wm.background} onChange={(value) => patchWm({ background: (value ?? "none") as WatermarkSettings["background"] })} />
            </div>
          )}
        </>
      )}

      {/* ── 输出设置 ── */}
      <div className="form-group">
        <label>{t("imgconv.output")}</label>
        <Select
          size="sm"
          data={[{ value: "subfolder", label: t("imgconv.outSubfolder") }, { value: "alongside", label: t("imgconv.outAlongside") }, { value: "custom", label: t("imgconv.outCustom") }]}
          label={t("imgconv.output")}
          value={settings.outputMode}
          onChange={(value) => onChange({ outputMode: (value ?? "subfolder") as OutputMode })}
        />
      </div>
      {settings.outputMode === "custom" && (
        <div className="form-group">
          <Button type="button" variant="default" fullWidth onClick={chooseOutputDir}>
            {settings.customDir ? baseName(settings.customDir) : t("imgconv.chooseDir")}
          </Button>
        </div>
      )}
      <div className="imgconv-hint">{t("imgconv.outputHint")}</div>

      <Button
        fullWidth
        onClick={onConvert}
        disabled={loading || !canConvert}
        style={{ marginTop: 4 }}
      >
        {loading ? t("imgconv.converting") : canConvert ? t("imgconv.convert") : t("imgconv.chooseFirst")}
      </Button>
    </>
  );
}
