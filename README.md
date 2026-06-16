# ToolBox

基于 Electron 的万能工具箱，采用 Apple Human Interface Guidelines 设计风格。

## 安装与运行

```bash
cd electron-qpcr
npm install
npm start
```

## 功能

- **qPCR Tools** - 实时荧光定量 PCR 数据分析
  - 数据转换：Target/Sample/Cq → 转置表格
  - qPCR 计算：2^(-ΔCt) 相对表达量 + 图表

## 设计特点

- Apple HIG 设计语言
- 深色/浅色主题
- 窗口置顶功能
- 原生 macOS 风格窗口控制

## 技术栈

- Electron 28
- SheetJS (xlsx)
- 原生 Canvas 图表

---

访问：[www.fanguanghan.homes](https://www.fanguanghan.homes)
