const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-Se6sZTtU.js","assets/path-CJbXD09f.js","assets/index-Dx4wHlxw.js","assets/index-DSYwAgMU.css"])))=>i.map(i=>d[i]);
import{c as E,p as G,_ as F,u as k,r as $,j as e,I as K,g as Y,s as y}from"./index-Dx4wHlxw.js";import{u as H,o as V}from"./useDropZone-Dvn1E4ZV.js";import{Command as _}from"./index-DwJAI_iM.js";import{L as q}from"./LoadingOverlay-D2aiM0uX.js";import{H as Q,T as Z}from"./HelpButton-CBj0mnqp.js";/**
 * @license @tabler/icons-react v3.44.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */const J=[["path",{d:"M6 3a1 1 0 0 1 .993 .883l.007 .117v3.171a3.001 3.001 0 0 1 0 5.658v7.171a1 1 0 0 1 -1.993 .117l-.007 -.117v-7.17a3.002 3.002 0 0 1 -1.995 -2.654l-.005 -.176l.005 -.176a3.002 3.002 0 0 1 1.995 -2.654v-3.17a1 1 0 0 1 1 -1z",key:"svg-0"}],["path",{d:"M12 3a1 1 0 0 1 .993 .883l.007 .117v9.171a3.001 3.001 0 0 1 0 5.658v1.171a1 1 0 0 1 -1.993 .117l-.007 -.117v-1.17a3.002 3.002 0 0 1 -1.995 -2.654l-.005 -.176l.005 -.176a3.002 3.002 0 0 1 1.995 -2.654v-9.17a1 1 0 0 1 1 -1z",key:"svg-1"}],["path",{d:"M18 3a1 1 0 0 1 .993 .883l.007 .117v.171a3.001 3.001 0 0 1 0 5.658v10.171a1 1 0 0 1 -1.993 .117l-.007 -.117v-10.17a3.002 3.002 0 0 1 -1.995 -2.654l-.005 -.176l.005 -.176a3.002 3.002 0 0 1 1.995 -2.654v-.17a1 1 0 0 1 1 -1z",key:"svg-2"}]],ee=E("filled","adjustments-filled","AdjustmentsFilled",J);/**
 * @license @tabler/icons-react v3.44.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */const te=[["path",{d:"M9 3a1 1 0 0 1 .608 .206l.1 .087l2.706 2.707h6.586a3 3 0 0 1 2.995 2.824l.005 .176v8a3 3 0 0 1 -2.824 2.995l-.176 .005h-14a3 3 0 0 1 -2.995 -2.824l-.005 -.176v-11a3 3 0 0 1 2.824 -2.995l.176 -.005h4z",key:"svg-0"}]],P=E("filled","folder-filled","FolderFilled",te);function I(i){return i.replace(/`/g,"``").replace(/'/g,"''").replace(/\$/g,"`$").replace(/\(/g,"`(").replace(/\)/g,"`)")}function O(i){return i.replace(/'/g,"'\\''")}function ae(i,s,n){const t=["([System.Drawing.FontStyle]::Regular)",n.bold?" -bor [System.Drawing.FontStyle]::Bold":"",n.italic?" -bor [System.Drawing.FontStyle]::Italic":""].join(""),c=Math.max(0,Math.min(255,Math.round(n.transparency*255)));return`
Add-Type -AssemblyName System.Drawing

$FontName = '${I(n.font)}'
$FontSize = ${n.fontSize}
$FontStyle = ${t}
$MarginX = ${n.marginX}
$MarginY = ${n.marginY}
$PaddingX = ${n.paddingX}
$PaddingY = ${n.paddingY}
$TextColor = [System.Drawing.Color]::White
$BackgroundColor = [System.Drawing.Color]::FromArgb(${c}, 90, 90, 90)
$JpegQuality = ${n.quality}
$InputDir = '${I(i)}'
$OutputDir = '${I(s)}'
$AddFileName = ${n.watermark?"$true":"$false"}
$jpgCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]$JpegQuality)
$ok = 0
$failed = 0

if (!(Test-Path -LiteralPath $OutputDir)) {
  New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
}

$Files = Get-ChildItem -LiteralPath $InputDir -File | Where-Object { $_.Extension -match '^\\.tiff?$' }
$totalFiles = if ($Files) { @($Files).Count } else { 0 }
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

Write-Output "RESULT:$ok|$failed|0|$OutputDir"
`.trim()}function ie(i,s,n){const t=O(i),c=O(s),f=O(n.font),g=n.quality,T=n.watermark,w=n.marginX,h=n.marginY,m=n.fontSize,p=n.bold?"1":"0",v=n.italic?"1":"0";return`
#!/bin/bash
INPUT_DIR='${t}'
OUTPUT_DIR='${c}'
QUALITY=${g}
WATERMARK=${T?"true":"false"}
FONT_NAME='${f}'
FONT_SIZE=${m}
BOLD=${p}
ITALIC=${v}
MARGIN_X=${w}
MARGIN_Y=${h}

mkdir -p "$OUTPUT_DIR"

FILES=()
while IFS= read -r -d '' f; do
  FILES+=("$f")
done < <(find "$INPUT_DIR" -maxdepth 1 -type f \\( -iname "*.tif" -o -iname "*.tiff" \\) -print0)

TOTAL=\${#FILES[@]}
IDX=0
OK=0
FAILED=0
WATERMARK_SKIPPED=0

# Check if ImageMagick is available for watermarking
HAS_MAGICK=0
if command -v magick &>/dev/null; then
  HAS_MAGICK=1
elif command -v convert &>/dev/null; then
  HAS_MAGICK=1
fi
if [ "$WATERMARK" = "true" ] && [ "$HAS_MAGICK" = "0" ]; then
  WATERMARK_SKIPPED=1
fi

echo "PROGRESS:0/$TOTAL"

for f in "\${FILES[@]}"; do
  IDX=$((IDX + 1))
  BASENAME=$(basename "$f")
  NAME="\${BASENAME%.*}"
  OUT="$OUTPUT_DIR/\${NAME}.jpg"

  if command -v sips &>/dev/null; then
    sips -s format jpeg -s formatOptions ${g} "$f" --out "$OUT" 2>/dev/null
    CONV_OK=$?
  elif command -v magick &>/dev/null; then
    magick convert "$f" -quality ${g}% "$OUT" 2>/dev/null
    CONV_OK=$?
  elif command -v convert &>/dev/null; then
    convert "$f" -quality ${g}% "$OUT" 2>/dev/null
    CONV_OK=$?
  else
    CONV_OK=1
  fi

  if [ $CONV_OK -eq 0 ] && [ -f "$OUT" ]; then
    if [ "$WATERMARK" = "true" ] && [ "$HAS_MAGICK" = "1" ]; then
      FONT_OPTS=""
      if [ "$BOLD" = "1" ]; then FONT_OPTS="$FONT_OPTS -weight Bold"; fi
      if [ "$ITALIC" = "1" ]; then FONT_OPTS="$FONT_OPTS -style Italic"; fi
      TMP_OUT="$OUT.tmp"
      if command -v magick &>/dev/null; then
        mv "$OUT" "$TMP_OUT"
        magick "$TMP_OUT" -font "$FONT_NAME" -pointsize $FONT_SIZE $FONT_OPTS           -fill "rgba(255,255,255,0.85)" -annotate +\${MARGIN_X}+\${MARGIN_Y} "$NAME" "$OUT" 2>/dev/null
        rm -f "$TMP_OUT"
      elif command -v convert &>/dev/null; then
        mv "$OUT" "$TMP_OUT"
        convert "$TMP_OUT" -font "$FONT_NAME" -pointsize $FONT_SIZE $FONT_OPTS           -fill "rgba(255,255,255,0.85)" -annotate +\${MARGIN_X}+\${MARGIN_Y} "$NAME" "$OUT" 2>/dev/null
        rm -f "$TMP_OUT"
      fi
    fi
    OK=$((OK + 1))
  else
    FAILED=$((FAILED + 1))
  fi

  echo "PROGRESS:$IDX/$TOTAL"
done

echo "RESULT:$OK|$FAILED|$WATERMARK_SKIPPED|$OUTPUT_DIR"
`}async function ne(i,s,n){const t=new Date,c=[t.getFullYear(),String(t.getMonth()+1).padStart(2,"0"),String(t.getDate()).padStart(2,"0"),"_",String(t.getHours()).padStart(2,"0"),String(t.getMinutes()).padStart(2,"0"),String(t.getSeconds()).padStart(2,"0")].join(""),f=`${i}/JPG_output_${c}`;return await G()==="windows"?se(i,f,s,n):re(i,f,s,n)}function M(i){let s="";return n=>{s+=n;const t=s.split(`
`);s=t.pop()??"";for(const c of t){const f=c.replace(/\r$/,"");f&&i(f)}}}async function se(i,s,n,t){const c=ae(i,s,n),{writeFile:f,remove:g}=await F(async()=>{const{writeFile:x,remove:l}=await import("./index-Se6sZTtU.js");return{writeFile:x,remove:l}},__vite__mapDeps([0,1,2,3])),{tempDir:T}=await F(async()=>{const{tempDir:x}=await import("./path-CJbXD09f.js");return{tempDir:x}},__vite__mapDeps([1,2,3])),h=`${await T()}/tiff_convert_${Date.now()}.ps1`,m=new Uint8Array([239,187,191]),p=new TextEncoder().encode(c),v=new Uint8Array(m.length+p.length);return v.set(m,0),v.set(p,m.length),await f(h,v),new Promise(x=>{let l="",r=!1;const d=async()=>{try{await g(h)}catch{}},o=u=>{r||(r=!0,d(),x(u))},S=M(u=>{if(l+=u+`
`,t){const j=u.match(/PROGRESS:(\d+)\/(\d+)/);if(j){const b=parseInt(j[1],10),N=parseInt(j[2],10);Number.isFinite(b)&&Number.isFinite(N)&&N>=0&&t(b,N)}}});try{const u=_.create("powershell",["-NoProfile","-ExecutionPolicy","Bypass","-File",h]);u.stdout.on("data",S),u.on("close",()=>{const j=l.match(/RESULT:(\d+)\|(\d+)\|(\d+)\|(.*)$/s);if(!j){o({ok:0,failed:-1,outputDir:s,watermarkSkipped:!1});return}o({ok:parseInt(j[1],10),failed:parseInt(j[2],10),watermarkSkipped:parseInt(j[3],10)===1,outputDir:j[4].trim()||s})}),u.on("error",()=>o({ok:0,failed:-1,outputDir:s,watermarkSkipped:!1})),u.spawn()}catch{o({ok:0,failed:-1,outputDir:s,watermarkSkipped:!1})}})}async function re(i,s,n,t){const c=ie(i,s,n),{writeFile:f,remove:g}=await F(async()=>{const{writeFile:m,remove:p}=await import("./index-Se6sZTtU.js");return{writeFile:m,remove:p}},__vite__mapDeps([0,1,2,3])),{tempDir:T}=await F(async()=>{const{tempDir:m}=await import("./path-CJbXD09f.js");return{tempDir:m}},__vite__mapDeps([1,2,3])),h=`${await T()}/tiff_convert_${Date.now()}.sh`;return await f(h,new TextEncoder().encode(c)),new Promise(m=>{let p="",v=!1;const x=async()=>{try{await g(h)}catch{}},l=d=>{v||(v=!0,x(),m(d))},r=M(d=>{if(p+=d+`
`,t){const o=d.match(/PROGRESS:(\d+)\/(\d+)/);if(o){const S=parseInt(o[1],10),u=parseInt(o[2],10);Number.isFinite(S)&&Number.isFinite(u)&&u>=0&&t(S,u)}}});try{_.create("bash",["-c",`chmod +x '${O(h)}'`]).execute().then(()=>{const o=_.create("bash",[h]);o.stdout.on("data",r),o.on("close",()=>{const S=p.match(/RESULT:(\d+)\|(\d+)\|(\d+)\|(.*)$/s);if(!S){l({ok:0,failed:-1,outputDir:s,watermarkSkipped:!1});return}l({ok:parseInt(S[1],10),failed:parseInt(S[2],10),watermarkSkipped:parseInt(S[3],10)===1,outputDir:S[4].trim()||s})}),o.on("error",()=>l({ok:0,failed:-1,outputDir:s,watermarkSkipped:!1})),o.spawn()})}catch{l({ok:0,failed:-1,outputDir:s,watermarkSkipped:!1})}})}const le=["Arial","Calibri","Times New Roman","微软雅黑","黑体","宋体"],oe=[36,48,60,72,96,120],ce=[80,85,90,95,98];function de({onConvert:i,loading:s,disabled:n}){const{t}=k(),[c,f]=$.useState(!0),[g,T]=$.useState("Arial"),[w,h]=$.useState(72),[m,p]=$.useState(!0),[v,x]=$.useState(!1),[l,r]=$.useState("18"),[d,o]=$.useState("18"),[S,u]=$.useState("12"),[j,b]=$.useState("8"),[N,R]=$.useState("210"),[D,C]=$.useState(95),L=()=>{const a=(B,X,z,W)=>{const A=Number(B);return Number.isFinite(A)?Math.max(X,Math.min(z,A)):W};i({watermark:c,font:g,fontSize:w,bold:m,italic:v,marginX:a(l,0,200,18),marginY:a(d,0,200,18),paddingX:a(S,0,50,12),paddingY:a(j,0,50,8),transparency:a(N,0,255,210)/255,quality:D})},U=c;return e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"notice",children:[e.jsx(K,{size:14,stroke:1.75}),e.jsx("span",{children:t("tiff.optionsHint")})]}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{children:t("tiff.watermark")}),e.jsxs("select",{value:c?"1":"0",onChange:a=>f(a.target.value==="1"),children:[e.jsx("option",{value:"1",children:t("tiff.yesLabel")}),e.jsx("option",{value:"0",children:t("tiff.noLabel")})]})]}),U&&e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"form-row",children:[e.jsxs("div",{className:"form-group",children:[e.jsx("label",{children:t("tiff.font")}),e.jsx("select",{value:g,onChange:a=>T(a.target.value),children:le.map(a=>e.jsx("option",{value:a,children:a},a))})]}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{children:t("tiff.fontSize")}),e.jsx("select",{value:w,onChange:a=>h(Number(a.target.value)),children:oe.map(a=>e.jsx("option",{value:a,children:a},a))})]})]}),e.jsxs("div",{className:"form-row",children:[e.jsxs("div",{className:"form-group",children:[e.jsx("label",{children:t("tiff.bold")}),e.jsxs("select",{value:m?"1":"0",onChange:a=>p(a.target.value==="1"),children:[e.jsx("option",{value:"1",children:t("tiff.yes")}),e.jsx("option",{value:"0",children:t("tiff.no")})]})]}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{children:t("tiff.italic")}),e.jsxs("select",{value:v?"1":"0",onChange:a=>x(a.target.value==="1"),children:[e.jsx("option",{value:"0",children:t("tiff.no")}),e.jsx("option",{value:"1",children:t("tiff.yes")})]})]})]}),e.jsxs("div",{className:"form-row",children:[e.jsxs("div",{className:"form-group",children:[e.jsx("label",{children:t("tiff.marginLeft")}),e.jsx("input",{type:"number",value:l,onChange:a=>r(a.target.value),min:0,max:200})]}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{children:t("tiff.marginTop")}),e.jsx("input",{type:"number",value:d,onChange:a=>o(a.target.value),min:0,max:200})]})]}),e.jsxs("div",{className:"form-row",children:[e.jsxs("div",{className:"form-group",children:[e.jsx("label",{children:t("tiff.paddingX")}),e.jsx("input",{type:"number",value:S,onChange:a=>u(a.target.value),min:0,max:50})]}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{children:t("tiff.paddingY")}),e.jsx("input",{type:"number",value:j,onChange:a=>b(a.target.value),min:0,max:50})]})]}),e.jsxs("div",{className:"form-row",children:[e.jsxs("div",{className:"form-group",children:[e.jsx("label",{children:t("tiff.backgroundOpacity")}),e.jsx("select",{value:N,onChange:a=>R(a.target.value),children:[{label:t("tiff.opaque"),value:255},{label:t("tiff.semiTransparent"),value:210},{label:t("tiff.moreTransparent"),value:128},{label:t("tiff.transparent"),value:0}].map(a=>e.jsx("option",{value:a.value,children:a.label},a.value))})]}),e.jsxs("div",{className:"form-group",children:[e.jsx("label",{children:t("tiff.quality")}),e.jsx("select",{value:D,onChange:a=>C(Number(a.target.value)),children:ce.map(a=>e.jsx("option",{value:a,children:a},a))})]})]})]}),e.jsx("button",{className:"btn btn-primary btn-full",onClick:L,disabled:s||n,style:{marginTop:4},children:t(s?"tiff.converting":n?"tiff.chooseFirst":"tiff.convert")})]})}function he(){const{t:i}=k(),[s,n]=$.useState(null),[t,c]=$.useState(!1),[f,g]=$.useState(i("tiff.converting")),[T,w]=$.useState(null),h=async()=>{const l=await V({directory:!0});if(l){const r=l.replace(/\\/g,"/").split("/"),d=r[r.length-1]||l;n({name:d,path:l})}},m=async l=>{if(s){c(!0),w(0),g(i("tiff.prepare"));try{const r=await ne(s.path,l,(d,o)=>{w(o>0?Math.round(d/o*100):0),g(`${i("tiff.converting")} (${d}/${o})...`)});w(100),r.failed<0?y(i("tiff.failed"),"error"):r.ok===0&&r.failed===0?y(i("tiff.noFiles"),"info"):r.failed>0?y(i("tiff.summary",{ok:r.ok,failed:r.failed}),"info"):y(i("tiff.complete",{count:r.ok}),"success"),r.watermarkSkipped&&y(i("tiff.watermarkSkipped"),"info")}catch(r){y(`${i("tiff.failed")}: ${r instanceof Error?r.message:String(r)}`,"error")}finally{c(!1),w(null)}}},p=l=>{const r=l[0];if(!r)return;const d=r.replace(/\\/g,"/").split("/"),o=d[d.length-1]||r;n({name:o,path:r})},{dropRef:v,isDragOver:x}=H(p);return e.jsxs("div",{className:"page-shell page-shell--wide",children:[e.jsx(q,{visible:t,text:f,progress:T}),e.jsxs("div",{className:"panel-header",children:[e.jsx("div",{className:"panel-icon",style:{background:"#34c759"},children:e.jsx(Y,{size:18,color:"white",stroke:1.75})}),e.jsxs("div",{className:"panel-title",children:[e.jsx("h2",{children:i("tiff.title")}),e.jsx("p",{children:i("tiff.subtitle")})]}),e.jsx("div",{className:"panel-actions",children:e.jsx(Q,{children:l=>e.jsx(Z,{onClose:l})})})]}),e.jsxs("div",{className:"card-grid card-grid--2",children:[e.jsxs("div",{className:"card",children:[e.jsxs("div",{className:"card-title",children:[e.jsx(P,{size:14,stroke:1.75}),e.jsx("span",{children:i("tiff.source")})]}),e.jsxs("div",{className:"card-body",children:[e.jsxs("div",{ref:v,className:`file-display${x?" file-display--drag":""}`,children:[e.jsx("div",{className:"file-icon",style:{background:"#34c759"},children:e.jsx(P,{size:20,color:"white",stroke:1.75})}),e.jsxs("div",{className:"file-info",children:[e.jsx("div",{className:"file-name",children:s?s.name:i("tiff.noFolder")}),e.jsx("div",{className:"file-path",children:s?s.path:i("tiff.folderHint")})]}),x&&e.jsx("span",{className:"drop-hint",children:i("tiff.drop")})]}),e.jsx("button",{className:"btn btn-primary btn-full",onClick:h,children:i(s?"tiff.changeFolder":"tiff.chooseFolder")})]})]}),e.jsxs("div",{className:"card",children:[e.jsxs("div",{className:"card-title",children:[e.jsx(ee,{size:14,stroke:1.75}),e.jsx("span",{children:i("tiff.options")})]}),e.jsx("div",{className:"card-body",children:e.jsx(de,{onConvert:m,loading:t,disabled:!s})})]})]})]})}export{he as default};
