import { Command } from "@tauri-apps/plugin-shell";

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

export interface ConvertResult {
  ok: number;
  failed: number;
  outputDir: string;
}

function escapePsSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

export async function convertTiff(
  folderPath: string,
  options: TiffOptions
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

  const outputDir = `${folderPath}\\JPG_output_${ts}`;
  const psPath = `${folderPath}\\tiff_convert_${Date.now()}.ps1`;

  const fontStyleExpr = [
    "([System.Drawing.FontStyle]::Regular)",
    options.bold ? " -bor [System.Drawing.FontStyle]::Bold" : "",
    options.italic ? " -bor [System.Drawing.FontStyle]::Italic" : "",
  ].join("");

  const psScript = `
Add-Type -AssemblyName System.Drawing

$FontName = '${escapePsSingleQuoted(options.font)}'
$FontSize = ${options.fontSize}
$FontStyle = ${fontStyleExpr}
$MarginX = ${options.marginX}
$MarginY = ${options.marginY}
$PaddingX = ${options.paddingX}
$PaddingY = ${options.paddingY}
$TextColor = [System.Drawing.Color]::White
$BackgroundColor = [System.Drawing.Color]::FromArgb(${Math.round(
    options.transparency * 255
  )}, 90, 90, 90)
$JpegQuality = ${options.quality}
$InputDir = '${escapePsSingleQuoted(folderPath)}'
$OutputDir = '${escapePsSingleQuoted(outputDir)}'
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

foreach ($file in $Files) {
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
}

Write-Output "RESULT:$ok|$failed|$OutputDir"
`.trim();

  const { writeFile, remove } = await import("@tauri-apps/plugin-fs");
  await writeFile(psPath, new TextEncoder().encode(psScript));

  try {
    const output = await Command.create("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      psPath,
    ]).execute();

    const stdout = (output.stdout || "").trim();
    const match = stdout.match(/RESULT:(\d+)\|(\d+)\|(.*)$/s);
    if (!match) {
      return {
        ok: 0,
        failed: 0,
        outputDir,
      };
    }

    return {
      ok: parseInt(match[1], 10),
      failed: parseInt(match[2], 10),
      outputDir: match[3].trim() || outputDir,
    };
  } catch {
    return {
      ok: 0,
      failed: 0,
      outputDir,
    };
  } finally {
    try {
      await remove(psPath);
    } catch {
      // best effort cleanup
    }
  }
}
