/**
 * Installer overlay for `installer.nsi`.
 *
 * This file is loaded by the NSIS template via `!include`.
 * It overrides specific MUI constants and adds custom pages.
 *
 * Design approach (ZCode-inspired modern minimal):
 * - Clean sidebar with brand gradient + logo
 * - No version numbers on images
 * - Modern pill-style version badge in the main content area
 * - Simplified welcome/finish text
 */

; ── Brand Colors ─────────────────────────────────────────────────────────────
!define COLOR_PRIMARY    "227CFF"
!define COLOR_DEEP       "0B5FE0"
!define COLOR_ACCENT     "5BA1FF"
!define COLOR_PURPLE     "722ED1"
!define COLOR_BG_DARK    "1a1a2e"

; ── Override MUI Bitmaps ─────────────────────────────────────────────────────
; Sidebar image used on Welcome and Finish pages (164x314)
!define MUI_WELCOMEFINISHPAGE_BITMAP "${SIDEBARIMAGE}"

; Header image used on inner pages (150x57)
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "${HEADERIMAGE}"

; ── Custom Finish Page Text ──────────────────────────────────────────────────
; Replace the default "Mynx has been installed on your computer." with cleaner text
!define MUI_FINISHPAGE_TITLE "$(^Name) 安装完成"
!define MUI_FINISHPAGE_TEXT "感谢选择 $(^Name)！\r\n\r\n点击「完成」退出安装程序。"

; ── Welcome Page Custom Text ─────────────────────────────────────────────────
!define MUI_WELCOMEPAGE_TITLE "欢迎安装 $(^Name)"
!define MUI_WELCOMEPAGE_TEXT "本向导将引导您完成 $(^Name) 的安装。\r\n\r\n\
  $(^Name) 是一款轻量高效的 qPCR 分析工具，\
  支持数据转换、相对表达量计算和图表生成。\r\n\r\n\
  点击「下一步」继续。"

; ── Remove default branding text ────────────────────────────────────────────
BrandingText " "

; ── Hook to customize installer behavior ────────────────────────────────────
!macro NSIS_HOOK_POSTINSTALL
  ; Nothing extra for now
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; Nothing extra for now
!macroend
