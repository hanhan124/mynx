import { platform } from "@tauri-apps/plugin-os";
import { Command as ShellCommand } from "@tauri-apps/plugin-shell";

export interface TiffOptions {
  watermark: boolean;
  font: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  marginX: number;
  marginY: number;
  paddingX: number;
  paddingY: number;
  transparency: number;
  quality: number;
}

interface ConvertResult {
  ok: number;
  failed: number;
  outputDir: string;
}

type TiffProgress = (current: number, total: number) => void;

// ── PowerShell ESC (Windows) ────────────────────────────────────────────────
function escapePsString(value: string): string {
  return value
    .replace(/'/g, "''")
    .replace(/\$/g, "`$")
    .replace(/`/g, "``")
    .replace(/\(/g, "`(")
    .replace(/\)/g, "`)");
}

// ── Shell ESC (macOS / Linux) ──────────────────────────────────────────────
function escapeShString(value: string): string {
  return value.replace(/'/g, "'\\''");
}

// ── Windows: PowerShell TIFF→JPEG ──────────────────────────────────────────
function buildWindowsScript(
  folderPath: string,
  outputDir: string,
  options: TiffOptions
): string {
  const fontStyleExpr = [
    "([System.Drawing.FontStyle]::Regular)",
    options.bold ? " -bor [System.Drawing.FontStyle]::Bold" : "",
    options.italic ? " -bor [System.Drawing.FontStyle]::Italic" : "",
  ].join("");

  return `
Add-Type -AssemblyName System.Drawing

$FontName = '${escapePsString(options.font)}'
$FontSize = ${options.fontSize}
$FontStyle = ${fontStyleExpr}
$MarginX = ${options.marginX}
$MarginY = ${options.marginY}
$PaddingX = ${options.paddingX}
$PaddingY = ${options.paddingY}
$TextColor = [System.Drawing.Color]::White
$BackgroundColor = [System.Drawing.Color]::FromArgb(${Math.round(options.transparency * 255)}, 90, 90, 90)
$JpegQuality = ${options.quality}
$InputDir = '${escapePsString(folderPath)}'
$OutputDir = '${escapePsString(outputDir)}'
$AddFileName = $${options.watermark ? "true" : "false"}
$jpgCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]$JpegQuality)
$ok = 0
$failed = 0

if (!(Test-Path -LiteralPath $OutputDir)) {
  New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
}

$Files = Get-ChildItem -LiteralPath $InputDir -File | Where-Object { $_.Extension -match '^\\.tiff?$' }
$totalFiles = $Files.Count
$idx = 0
Write-Output "PROGRESS:0/$totalFiles"

foreach ($file in $Files) {
  $idx = $idx + 1
  $image = $null
  $bitmap = $null
  $graphics = $null
  $font = $null
  $textBrush = $null
  $bgBrush = $null
  try {
    $image = [System.Drawing.Image]::FromFile($file.FullName)
    $bitmap = New-Object System.Drawing.Bitmap($image.Width, $image.Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.Clear([System.Drawing.Color]::White)
    $graphics.DrawImage($image, 0, 0, $image.Width, $image.Height)

    if ($AddFileName) {
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
      $font = New-Object System.Drawing.Font($FontName, $FontSize, $FontStyle, [System.Drawing.GraphicsUnit]::Pixel)
      $textBrush = New-Object System.Drawing.SolidBrush($TextColor)
      $bgBrush = New-Object System.Drawing.SolidBrush($BackgroundColor)
      $label = $file.BaseName
      $maxWidth = [single]($image.Width - $MarginX - $PaddingX)
      $stringFormat = New-Object System.Drawing.StringFormat
      $stringFormat.FormatFlags = [System.Drawing.StringFormatFlags]::MeasureTrailingSpaces
      $textLayoutRect = New-Object System.Drawing.RectangleF([single]$MarginX, [single]$MarginY, [single]$maxWidth, [single]$image.Height)
      $textSize = $graphics.MeasureString($label, $font, [single]$maxWidth, $stringFormat)
      $bgRect = New-Object System.Drawing.RectangleF([single]$MarginX, [single]$MarginY, [single]([Math]::Min($textSize.Width + 2 * $PaddingX, $maxWidth)), [single]($textSize.Height + 2 * $PaddingY))
      $graphics.FillRectangle($bgBrush, $bgRect)
      $graphics.DrawString($label, $font, $textBrush, $textLayoutRect, $stringFormat)
    }

    $outPath = Join-Path $OutputDir ($file.BaseName + ".jpg")
    $bitmap.Save($outPath, $jpgCodec, $encoderParams)
    $ok++
  } catch {
    $failed++
  } finally {
    if ($graphics) { $graphics.Dispose() }
    if ($bitmap) { $bitmap.Dispose() }
    if ($image) { $image.Dispose() }
    if ($font) { $font.Dispose() }
    if ($textBrush) { $textBrush.Dispose() }
    if ($bgBrush) { $bgBrush.Dispose() }
  }
  Write-Output "PROGRESS:$idx/$totalFiles"
}

Write-Output "RESULT:$ok|$failed|$OutputDir"
`.trim();
}

// ── macOS/Linux: Shell (sips + ImageMagick fallback) TIFF→JPEG ────────────
function buildUnixScript(
  folderPath: string,
  outputDir: string,
  options: TiffOptions
): string {
  // sips is built-in on macOS (no ImageMagick needed for basic conversion)
  // For watermark, we use a combination of sips + optional ImageMagick if available
  const inputDirEsc = escapeShString(folderPath);
  const outputDirEsc = escapeShString(outputDir);
  const fontEsc = escapeShString(options.font);
  /* fontSize unused in shell script directly, passed through fontEsc */
  const quality = options.quality;
  const watermarkEnabled = options.watermark;
  const marginX = options.marginX;
  const marginY = options.marginY;

  return `
#!/bin/bash
INPUT_DIR='${inputDirEsc}'
OUTPUT_DIR='${outputDirEsc}'
QUALITY=${quality}
WATERMARK=${watermarkEnabled ? "true" : "false"}
FONT_NAME='${fontEsc}'
const FONT_SIZE = Math.round(${options.fontSize})
MARGIN_X=${marginX}
MARGIN_Y=${marginY}

mkdir -p "$OUTPUT_DIR"

# Collect files
FILES=()
while IFS= read -r -d '' f; do
  FILES+=("$f")
done < <(find "$INPUT_DIR" -maxdepth 1 -type f \( -iname "*.tif" -o -iname "*.tiff" \) -print0)

TOTAL=\${#FILES[@]}
IDX=0
OK=0
FAILED=0

echo "PROGRESS:0/$TOTAL"

for f in "\${FILES[@]}"; do
  IDX=\$((IDX + 1))
  BASENAME=\$(basename "\$f")
  NAME="\${BASENAME%.*}"
  OUT="\$OUTPUT_DIR/\${NAME}.jpg"

  # macOS built-in conversion via sips (preserves quality)
  if command -v sips &>/dev/null; then
    sips -s format jpeg -s formatOptions ${quality} "$f" --out "$OUT" 2>/dev/null
    CONV_OK=$?
  # Fallback: ImageMagick
  elif command -v magick &>/dev/null; then
    magick convert "$f" -quality ${quality}% "$OUT" 2>/dev/null
    CONV_OK=$?
  elif command -v convert &>/dev/null; then
    convert "$f" -quality ${quality}% "$OUT" 2>/dev/null
    CONV_OK=$?
  else
    CONV_OK=1
  fi

  if [ $CONV_OK -eq 0 ] && [ -f "$OUT" ]; then
    if [ "$WATERMARK" = "true" ]; then
      # Try ImageMagick for watermark; if not available, skip watermark without failing
      if command -v magick &>/dev/null; then
        magick "$OUT" -font "$FONT_NAME" -pointsize $FONT_SIZE \
          -fill "rgba(255,255,255,0.8)" -annotate +\${MARGIN_X}+\${MARGIN_Y} "\$NAME" "\$OUT" 2>/dev/null
      elif command -v convert &>/dev/null; then
        convert "\$OUT" -font "\$FONT_NAME" -pointsize \$FONT_SIZE \
          -fill "rgba(255,255,255,0.8)" -annotate +\${MARGIN_X}+\${MARGIN_Y} "\$NAME" "\$OUT" 2>/dev/null
      fi
    fi
    OK=$((OK + 1))
  else
    FAILED=$((FAILED + 1))
  fi

  echo "PROGRESS:$IDX/$TOTAL"
done

echo "RESULT:$OK|$FAILED|$OUTPUT_DIR"
`;
}

// ── Cross-platform entry point ──────────────────────────────────────────────
export async function convertTiff(
  folderPath: string,
  options: TiffOptions,
  onProgress?: TiffProgress
): Promise<ConvertResult> {
  const now = new Date();
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "_",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");

  const outputDir = `${folderPath}/JPG_output_${ts}`;

  // Detect platform
  const os = await platform();

  if (os === "windows") {
    return convertWithPowershell(folderPath, outputDir, options, onProgress);
  } else {
    return convertWithShell(folderPath, outputDir, options, onProgress);
  }
}

// ── Windows: PowerShell ─────────────────────────────────────────────────────
async function convertWithPowershell(
  folderPath: string,
  outputDir: string,
  options: TiffOptions,
  onProgress?: TiffProgress
): Promise<ConvertResult> {
  const psScript = buildWindowsScript(folderPath, outputDir, options);
  const tempDir = folderPath;
  const psPath = `${tempDir}/tiff_convert_${Date.now()}.ps1`;

  const { writeFile, remove } = await import("@tauri-apps/plugin-fs");
  await writeFile(psPath, new TextEncoder().encode(psScript));

  return new Promise<ConvertResult>((resolve) => {
    let stdoutBuf = "";
    let resolved = false;

    const cleanup = async () => {
      try { await remove(psPath); } catch { /* best effort */ }
    };

    const finalize = (result: ConvertResult) => {
      if (resolved) return;
      resolved = true;
      void cleanup();
      resolve(result);
    };

    try {
      const command = ShellCommand.create("powershell", [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psPath,
      ]);

      command.stdout.on("data", (line: string) => {
        stdoutBuf += line + "\n";
        if (!onProgress) return;
        const match = line.match(/PROGRESS:(\d+)\/(\d+)/);
        if (match) {
          const cur = parseInt(match[1], 10);
          const tot = parseInt(match[2], 10);
          if (Number.isFinite(cur) && Number.isFinite(tot) && tot > 0) {
            onProgress(cur, tot);
          }
        }
      });

      command.on("close", () => {
        const match = stdoutBuf.match(/RESULT:(\d+)\|(\d+)\|(.*)$/s);
        if (!match) {
          finalize({ ok: 0, failed: 0, outputDir });
          return;
        }
        finalize({
          ok: parseInt(match[1], 10),
          failed: parseInt(match[2], 10),
          outputDir: match[3].trim() || outputDir,
        });
      });

      command.on("error", () => finalize({ ok: 0, failed: 0, outputDir }));
      void command.spawn();
    } catch {
      finalize({ ok: 0, failed: 0, outputDir });
    }
  });
}

// ── macOS / Linux: Bash ─────────────────────────────────────────────────────
async function convertWithShell(
  folderPath: string,
  outputDir: string,
  options: TiffOptions,
  onProgress?: TiffProgress
): Promise<ConvertResult> {
  const shScript = buildUnixScript(folderPath, outputDir, options);

  // Write script to a temp file
  const { writeFile, remove } = await import("@tauri-apps/plugin-fs");
  const shPath = `${folderPath}/tiff_convert_${Date.now()}.sh`;
  await writeFile(shPath, new TextEncoder().encode(shScript));

  return new Promise<ConvertResult>((resolve) => {
    let stdoutBuf = "";
    let resolved = false;

    const cleanup = async () => {
      try { await remove(shPath); } catch { /* best effort */ }
    };

    const finalize = (result: ConvertResult) => {
      if (resolved) return;
      resolved = true;
      void cleanup();
      resolve(result);
    };

    try {
      const chmodCmd = ShellCommand.create("bash", ["-c", `chmod +x '${shPath}'`]);
      chmodCmd.execute().then(() => {
        const command = ShellCommand.create("bash", [shPath]);
        command.stdout.on("data", (line: string) => {
          stdoutBuf += line + "\n";
          if (!onProgress) return;
          const match = line.match(/PROGRESS:(\d+)\/(\d+)/);
          if (match) {
            const cur = parseInt(match[1], 10);
            const tot = parseInt(match[2], 10);
            if (Number.isFinite(cur) && Number.isFinite(tot) && tot > 0) {
              onProgress(cur, tot);
            }
          }
        });

        command.on("close", () => {
          const match = stdoutBuf.match(/RESULT:(\d+)\|(\d+)\|(.*)$/s);
          if (!match) {
            finalize({ ok: 0, failed: 0, outputDir });
            return;
          }
          finalize({
            ok: parseInt(match[1], 10),
            failed: parseInt(match[2], 10),
            outputDir: match[3].trim() || outputDir,
          });
        });

        command.on("error", () => finalize({ ok: 0, failed: 0, outputDir }));
        void command.spawn();
      });
    } catch {
      finalize({ ok: 0, failed: 0, outputDir });
    }
  });
}
