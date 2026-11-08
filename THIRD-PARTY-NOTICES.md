# THIRD-PARTY NOTICES / 第三方组件声明

Mynx 使用以下第三方开源组件。各组件版权归其各自作者所有,本文件仅作汇总声明;
完整许可证文本以各组件官方仓库为准。

## 一、Rust 依赖(随应用编译打包)

| 组件 | 许可证 | 用途 |
|---|---|---|
| tauri 及 tauri-plugin-\*(dialog/fs/os/process/shell/store/updater) | MIT OR Apache-2.0 | 应用框架与系统能力 |
| serde / serde_json / thiserror | MIT OR Apache-2.0 | 序列化与错误处理 |
| tokio | MIT | 异步运行时 |
| reqwest | MIT OR Apache-2.0 | HTTP 客户端(更新检查) |
| image-rs(image) | MIT | 图片解码/编码(tiff/webp/bmp/gif/ico/tga/pnm/qoi/dds/jpeg/png) |
| oxipng | MIT | PNG 无损优化 |
| png | MIT | PNG 原生读写 |
| color_quant | MIT | NeuQuant 调色板量化(有损压缩) |
| tiff | MIT | 多页 TIFF 解码/编码 |
| resvg | **MPL-2.0** | SVG 渲染 |
| kamadak-exif | MIT OR Apache-2.0 | EXIF 读取 |
| imageproc / ab_glyph | MIT / Apache-2.0 | 文字水印 |
| rayon | MIT OR Apache-2.0 | 并行处理 |
| base64 | MIT OR Apache-2.0 | 编解码 |

> **resvg(MPL-2.0)说明**:Mynx 未修改 resvg 源码,原样编译使用;
> 其源码见 https://github.com/linebender/resvg 。MPL-2.0 仅对该库自身源文件
> 有开源要求,不影响 Mynx 其余代码。

## 二、前端依赖(随应用打包)

| 组件 | 许可证 | 用途 |
|---|---|---|
| react / react-dom | MIT | UI 框架 |
| react-router-dom | MIT | 路由 |
| exceljs | MIT | Excel 读写(qPCR / 科研绘图) |
| jszip | MIT OR GPL-3(选用 MIT) | 压缩包处理 |
| @tabler/icons-react | MIT | 图标库 |

## 三、运行时依赖(不随应用分发,由用户机器自行安装)

| 组件 | 许可证 | 用途 |
|---|---|---|
| R(R Foundation) | GPL-2/3 | 统计计算引擎 |
| DESeq2 | GPL-3 | RNA-seq 差异表达 |
| edgeR | GPL(≥2) | RNA-seq 差异表达 / 精确检验 |
| ComplexHeatmap | Artistic-2.0 | 热图 |
| ggplot2 / ggrepel / ragg 等 | MIT / GPL 系 | 绘图与图形设备 |
| ddCt / tidyqpcr 等可选参考 | Apache-2.0 系 | qPCR 方法参考 |

以上 R 包由用户通过 CRAN / Bioconductor 自行安装,Mynx 以独立进程(Rscript)
方式调用,不进行再分发;各包遵循其原始许可证。

## 四、其它

- 应用图标与界面素材为 Mynx 原创内容。
- 本项目自身代码以 Apache License 2.0 发布,详见 [LICENSE](./LICENSE)。
