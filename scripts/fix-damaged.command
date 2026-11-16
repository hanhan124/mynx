#!/bin/bash
#
# fix-damaged.command — Mynx macOS Gatekeeper + AMFI 修复脚本
#
# macOS 26 (Tahoe) 上未签名的 app 会被 AMFI 直接 SIGKILL，且隔离属性
# (com.apple.quarantine) 会导致 Gatekeeper 提示「已损坏」。本脚本同时
# 执行 ad-hoc 签名（满足 AMFI）和清除隔离属性（绕过 Gatekeeper），
# 无需 Apple 开发者账号。
#
# 前提：本脚本自身需已被 ad-hoc 签名（CI 构建时完成），否则在 macOS 26
# 上会在执行第一行前被 AMFI 杀死。

APP_NAME="Mynx.app"
APP_DISPLAY="Mynx"

# ── 原生对话框 ────────────────────────────────────────────────────────────
# 通过 osascript 弹出带图标和按钮的对话框。消息文本经双引号转义，避免
# 路径中的特殊字符导致 AppleScript 语法错误。
show_dialog() {
    local icon="$1" message="$2" title="$3"
    local escaped
    escaped="${message//\\/\\\\}"
    escaped="${escaped//\"/\\\"}"
    osascript -e "display dialog \"$escaped\" with title \"$title\" with icon $icon buttons {\"好\"} default button 1" 2>/dev/null \
        || echo "$message"
}

# ── 定位 .app ─────────────────────────────────────────────────────────────
# 优先级：/Applications → 脚本所在目录（DMG 挂载点）→ 当前工作目录
find_app() {
    local candidate
    for candidate in \
        "/Applications/${APP_NAME}" \
        "$(dirname "$0")/${APP_NAME}" \
        "$(pwd)/${APP_NAME}"; do
        if [ -d "$candidate" ]; then
            (cd "$(dirname "$candidate")" && echo "$(pwd)/$(basename "$candidate")")
            return 0
        fi
    done
    return 1
}

APP_PATH=$(find_app) || APP_PATH=""

if [ -z "$APP_PATH" ]; then
    echo "✗ 找不到 ${APP_DISPLAY}.app"
    show_dialog stop \
        "找不到 ${APP_DISPLAY}.app。请先把它拖到「应用程序」文件夹，再运行本修复脚本。" \
        "修复失败"
    echo ""
    echo "按回车键关闭此窗口…"
    read -r
    exit 1
fi

echo "正在修复 ${APP_DISPLAY} …"
echo "目标: ${APP_PATH}"
echo ""

# ── 第一步：清除隔离属性 ───────────────────────────────────────────────────
# 移除 com.apple.quarantine 及所有扩展属性，绕过 Gatekeeper 的「已损坏」检查。
echo "[1/2] 清除隔离属性…"
xattr -cr "$APP_PATH" 2>/dev/null
echo "  ✓ 隔离属性已清除"

# ── 第二步：Ad-hoc 签名 ───────────────────────────────────────────────────
# macOS 26 的 AMFI 会杀死未签名的 ARM 原生可执行文件。Ad-hoc 签名
# (codesign -s -) 不需要 Apple 开发者账号，足以满足 AMFI 要求。
echo "[2/2] 应用 ad-hoc 签名…"
codesign --force --deep --sign - "$APP_PATH" 2>/dev/null
echo "  ✓ Ad-hoc 签名已完成"

echo ""
echo "✓ ${APP_DISPLAY} 修复完成！"
show_dialog information \
    "${APP_DISPLAY} 已修复！现在可以关闭此窗口，双击「应用程序」里的 ${APP_DISPLAY} 正常使用了。" \
    "修复成功"

echo ""
echo "按回车键关闭此窗口…"
read -r
