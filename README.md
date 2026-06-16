# ToolBox

桌面端多功能工具箱，当前包含 qPCR 数据分析和 TIFF 批量转 JPG 两个工具。

## 下载

从 [Releases](https://github.com/fanguanghan/electron-toolbox/releases) 页面下载最新安装包，双击 `ToolBox-x.x.x-setup.exe` 安装即可。应用内会自动检测新版本并提示更新。

## 从源码运行

```bash
git clone https://github.com/fanguanghan/electron-toolbox.git
cd electron-toolbox
npm install
npm start
```

## 打包

```bash
npm run build
```

生成的安装包位于 `dist/` 目录。

## 功能

### qPCR Tools

实时荧光定量 PCR 数据分析工具。

1. 打开 Excel 文件（.xlsx），选择工作表
2. **数据转换** — 将 Target/Sample/Cq 列转置为标准格式，缺失值自动填充并标黄
3. **qPCR 计算** — 基于参考基因计算 2^(-ΔCt) 相对表达量，按基因分 sheet 输出，自动生成柱状图（需安装 Excel）

### TIFF 转 JPG

批量将 TIFF 图片转换为 JPG，支持自定义文字水印（字体、字号、粗斜体、边距、背景透明度）和输出质量。

## 特性

- 深色 / 浅色主题切换
- 窗口置顶
- 中英文切换
- 自动更新（GitHub Releases 推送）

## 技术栈

- Electron 28
- SheetJS (xlsx) / ExcelJS
- electron-builder
- electron-updater

---

作者：[fanguanghan](https://www.fanguanghan.homes)
