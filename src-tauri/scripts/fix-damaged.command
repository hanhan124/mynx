#!/bin/bash
#
# fix-damaged.command — Mynx macOS Gatekeeper 修复脚本
#
# 未签名的 DMG 下载后会被 macOS 打上 com.apple.quarantine 隔离属性，
# 导致双击 Mynx.app 时提示「已损坏，无法打开」。本脚本自动清除该属性，
# 并通过原生对话框引导用户，无需手动输入终端命令。
#
# 用法：在 DMG 中右键本文件 → 打开 → 弹窗确认「打开」即可。
#
# 注意：不使用 set -e，因为我们需要在失败时弹出图形提示而非直接退出。

APP_NAME="Mynx.app"
APP_DISPLAY="Mynx"

# ── 原生对话框 ────────────────────────────────────────────────────────────
# 通过 osascript 弹出带图标和按钮的对话框。消息文本经双引号转义，避免
# 路径中的特殊字符导致 AppleScript 语法错误。
show_dialog() {
    local icon="$1" message="$2" title="$3"
    # 转义双引号和反斜杠，防止注入 AppleScript
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
            # 规范化为绝对路径
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

# ── 清除隔离属性 ───────────────────────────────────────────────────────────
echo "正在修复 ${APP_DISPLAY} …"
echo "目标: ${APP_PATH}"
echo ""

if xattr -cr "$APP_PATH" 2>/dev/null; then
    echo "✓ 隔离属性已清除"
    show_dialog information \
        "${APP_DISPLAY} 已修复！现在可以关闭此窗口，双击「应用程序」里的 ${APP_DISPLAY} 正常使用了。" \
        "修复成功"
else
    echo "✗ 清除失败"
    show_dialog stop \
        "修复未能完成。请尝试手动在终端运行：xattr -cr \"${APP_PATH}\"" \
        "修复失败"
fi

echo ""
echo "按回车键关闭此窗口…"
read -r
