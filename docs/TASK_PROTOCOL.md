# TASK_PROTOCOL — Mynx 3.x 任务与事件协议

> 所有任务事件、日志、错误与结果文档带 `v`（= 1）版本字段。
> 契约来源：`src-tauri/crates/mynx-contracts`；TS 绑定由 ts-rs 生成。

## 任务状态机

```
queued ──▶ running ──▶ succeeded
   │          │    ├──▶ failed
   │          │    └──▶ cancelled
   └──────────┴───（cancel 请求：协作 token + 硬杀钩子）
```

- `TaskRecord { v, id, kind, label, status, createdAtMs, startedAtMs?,
  finishedAtMs?, progress?, detail?, error?, outputDir? }`
- `TaskKind`: imageConvert | qpcrPlot | qpcrExcel | rnaseqRun | chartRun |
  rInstall | rDependencyCheck
- 任务中心快照：`invoke("tasks_list")`；实时更新：事件 `mynx://task-changed`。
- 取消：`invoke("tasks_cancel", { id })` → JobManager 触发该任务的
  取消 token 与硬杀钩子（R 进程树 `taskkill /PID x /T /F`）。

## 命令面（摘要）

### 通用
| 命令 | 参数 → 返回 |
| --- | --- |
| settings_load / settings_save | () → SettingsDoc / (doc) → () |
| settings_migrate_legacy | (LegacySettings) → ()（幂等） |
| tasks_list / tasks_cancel | () → TaskRecord[] / (id) → bool |
| app_info | () → { version, exePath, isPortable } |
| open_path | (path) → bool（资源管理器打开输出目录） |
| resource_r_path | (script) → string（resourceDir()/r/…） |
| cleanup_update_bak | () → () |

### R 运行时
| 命令 | 说明 |
| --- | --- |
| r_status | Rscript 发现状态（缓存） |
| r_check_dependencies | 包安装检测（不加载包） |
| r_install_runtime | winget/brew 安装 R（任务；日志事件 mynx://r-install-log） |
| r_install_packages | CRAN + Bioconductor 安装（任务；Channel + 事件） |

### 图片转换
| 命令 | 说明 |
| --- | --- |
| image_collect_files | 文件/文件夹展开为支持格式列表 |
| image_convert_start | 启动批量转换；进度走 Channel<ConvertEvent>；返回 job id |
| image_convert_cancel | 取消（= tasks_cancel） |
| image_thumbnail | 缩略图（base64 PNG data URL） |

ConvertEvent（tag = kind，字段 camelCase，与 legacy 逐字节兼容）：
`started { total }` → 每文件 `item { index, total, source, status, outputs,
error?, originalBytes, outputBytes }` → `finished { status: completed|cancelled,
ok, failed, totalInput, totalOutput, watermarkApplied }`。

### qPCR
| 命令 | 说明 |
| --- | --- |
| qpcr_transform | SheetSnapshot → TransformResult（WorkbookPatch + 基因/组名） |
| qpcr_calculate | CalcRequest → CalcResult（Summary/基因表 patch + chart_series） |
| qpcr_plot_run | QpcrPlotRunConfig → QpcrPlotRunResult；日志 Channel<LogLine>；任务化可取消；错误哨兵 QPCR_PLOT_CANCELLED |

qPCR Excel 流程：前端 ExcelJS 兼容 worker 提取 SheetSnapshot（值 + 黄色填补
标记）→ Rust 计算返回 WorkbookPatch → worker 哑渲染写回并保存。数学与输出
结构 100% 来自 Rust（golden fixture 对比锁定行为）。

### RNA-seq
| 命令 | 说明 |
| --- | --- |
| rnaseq_default_config | 默认 RnaSeqConfig（Rust 单一来源） |
| rnaseq_merge_config | deepMerge 历史 params.json 到默认配置 |
| rnaseq_import_counts | counts 导入（csv/tsv/xlsx/featureCounts/htseq） |
| rnaseq_run | 启动 rnaseq_engine.R；Channel<LogLine>；Windows 非 ASCII 输出目录 ASCII 暂存 |
| rnaseq_cancel / rnaseq_list_runs / rnaseq_load_params / rnaseq_read_de_summary / rnaseq_list_result_files | 历史/结果目录操作 |

### 科研绘图
| 命令 | 说明 |
| --- | --- |
| charts_import_data | CSV/TSV/XLSX → ChartImportedData（列 + 行预览） |
| charts_run | ChartRunConfig → ChartRunResult；chart_event JSON 行解析为 ChartRunEvent（stage/level/message/progress）；任务化可取消 |
| charts_read_manifest | 读 r/chart-templates/<id>/manifest.json |
| charts_export_zip | 图表包/模板包 ZIP 导出 |
| charts_install_template_package | 模板包导入安装 |

## 日志协议

`LogLine { v, tsMs, level: info|warning|error|success, message }` 经 Tauri
Channel 流式发送。R 输出行分类与 legacy 一致：
`^Error|Error in|Execution halted|[ERROR]` → error；`^Warning|[WARN]` →
warning；`[OK]|[DONE]` → success；其余 info。

## 错误协议

命令错误统一序列化为 `MynxError { v, code, message }`（code: io | validation |
notFound | cancelled | process | internal）。前端 `tauri.ts` 把拒绝的调用映射
为 CommandError，`localizeErrorMessage` 按语言映射错误文案（legacy 行为）。

## 取消语义（不变量）

- 取消必须触达真实进程：R → 进程树终止；图片转换 → 管线标志位。
- 取消后已生成文件保留；临时 params/输入副本清理。
- RNA-seq：status → cancelled，`已取消(退出码 N);已生成的文件保留在输出目录`。
- qPCR 绘图：error = QPCR_PLOT_CANCELLED 哨兵（前端据此显示取消状态）。
- 图片转换：finished.status = cancelled。
