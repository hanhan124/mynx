import { Command } from "@tauri-apps/plugin-shell";

export interface TiffOptions {
  watermark: boolean;
  font: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  margin: number;
  padding: number;
  transparency: number;
  quality: number;
}

export interface ConvertResult {
  ok: number;
  failed: number;
  outputDir: string;
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

  const watermarkBlock = options.watermark
    ? `
$watermarkFont = New-Object System.Drawing.Font("${options.font}", ${options.fontSize}, $(if(${options.bold}){[System.Drawing.FontStyle]::Bold}else{[System.Drawing.FontStyle]::Regular}) -bor $(if(${options.italic}){[System.Drawing.FontStyle]::Italic}else{[System.Drawing.FontStyle]::Regular}))
$alpha = ${Math.round(options.transparency * 255)}
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.FromArgb]::FromArgb($alpha, 255, 255, 255))
`
    : "";

  const drawWatermark = options.watermark
    ? `
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.DrawString("Mynx", $watermarkFont, $brush, ${options.margin}, ${options.margin})
    $graphics.Dispose()
    `
    : "";

  const psScript = `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Drawing.Imaging

$inputDir = "${folderPath.replace(/\\/g, "\\\\").replace(/"/g, '`"')}"
$outputDir = "${outputDir.replace(/\\/g, "\\\\").replace(/"/g, '`"')}"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$files = Get-ChildItem -Path $inputDir -Include *.tif,*.tiff -File
$count = 0
$failed = 0

${watermarkBlock}

foreach ($file in $files) {
    try {
        $img = [System.Drawing.Image]::FromFile($file.FullName)
        $bitmap = New-Object System.Drawing.Bitmap($img.Width, $img.Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $g = [System.Drawing.Graphics]::FromImage($bitmap)
        $g.Clear([System.Drawing.Color]::White)
        $g.DrawImage($img, 0, 0, $img.Width, $img.Height)
        $g.Dispose()
        $img.Dispose()

        ${drawWatermark}

        $outPath = Join-Path $outputDir ([System.IO.Path]::ChangeExtension($file.Name, ".jpg"))
        $encoderParam = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, ${options.quality}L)
        $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
        $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
        $encoderParams.Param[0] = $encoderParam
        $bitmap.Save($outPath, $codec, $encoderParams)
        $bitmap.Dispose()
        $count++
    } catch {
        $failed++
    }
}

Write-Output "$count|$failed|$outputDir"
`.trim();

  const output = await Command.create("powershell", [
    "-NoProfile",
    "-Command",
    psScript,
  ]).execute();

  const stdout = output.stdout.trim();
  const parts = stdout.split("|");

  return {
    ok: parseInt(parts[0] || "0", 10),
    failed: parseInt(parts[1] || "0", 10),
    outputDir: parts[2] || outputDir,
  };
}
