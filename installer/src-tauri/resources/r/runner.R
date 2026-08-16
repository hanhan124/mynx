# =============================================================================
# runner.R — 发表级 RNA-seq 分析统一入口(参数化,GUI 后端)
# =============================================================================
# 用法:Rscript runner.R <params.json>
#
# 方法论(继承自 old/1.DEG_analysis.R):
#   单重复(任一组 <2 个样本)→ edgeR + 固定 BCV(edgeR 用户指南 §2.10)
#   多重复(每组 ≥2 个样本)  → 标准 DESeq2
#
# 作图代码严格对齐 old/ 目录原脚本格式,仅把硬编码参数改为从 JSON 读取。
# 输出:<output_dir>/<run_name>/plots/*.svg (+可选 pdf) + RNAseq_Analysis_Results.xlsx
# =============================================================================

# ─── 0. 读配置 ──────────────────────────────────────────────────────────────
args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 1) stop("用法:Rscript runner.R <params.json>")
params_file <- normalizePath(args[1], mustWork = TRUE)

suppressPackageStartupMessages({
  library(jsonlite)
})
# %||% 运算符(避免依赖 rlang):NULL 时取后备值
`%||%` <- function(x, y) if (is.null(x) || length(x) == 0) y else x

cfg <- fromJSON(params_file, simplifyVector = TRUE)

# 便捷别名(沿用旧脚本变量名,便于对照)
data_file      <- cfg$data_file
output_base    <- cfg$output_dir
run_name       <- if (is.null(cfg$run_name) || cfg$run_name == "auto" || cfg$run_name == "")
                    format(Sys.time(), "RNA_seq_%Y%m%d_%H%M%S") else cfg$run_name
output_dir     <- file.path(output_base, run_name)
plots_dir      <- file.path(output_dir, "plots")
excel_file     <- file.path(output_dir, "RNAseq_Analysis_Results.xlsx")

group_info     <- as.list(cfg$groups)                # list(组名 = c(样本...))
group_display  <- cfg$group_display
group_order    <- cfg$group_order
selected_groups<- cfg$selected_groups
comparisons    <- lapply(seq_len(nrow(cfg$comparisons)),
                         function(i) as.character(cfg$comparisons[i, ]))
marker_genes   <- as.character(cfg$marker_genes)
gene_clusters  <- as.list(cfg$gene_clusters)
excluded_genes <- as.character(cfg$excluded_genes)

p              <- cfg$params
bcv            <- as.numeric(p$bcv)
log2fc_th      <- as.numeric(p$log2fc_th)
fdr_th         <- as.numeric(p$fdr_th)
basemean_th    <- as.numeric(p$basemean_th)
top_n_label    <- as.numeric(p$top_n_label)
pvalue_cap     <- as.numeric(p$pvalue_cap)
# 引擎选择:auto(单重复→edgeR 固定 BCV;多重复→DESeq2)/ deseq2 / edger_qlf
engine         <- tolower(as.character(p$engine %||% "auto"))
if (!engine %in% c("auto", "deseq2", "edger_qlf")) engine <- "auto"
# 低表达过滤阈值(可调;写入 Meta 与报告)
filter_min_count <- as.numeric(p$filter_min_count %||% 5)   # edgeR filterByExpr min.count
filter_rowsum    <- as.numeric(p$filter_rowsum %||% 10)     # DESeq2/edgeR QLF rowSums 下限

# 批次信息(可选):list(批次名 = c(样本...)),用于 ~ batch + condition 设计
batch_info <- as.list(cfg$batches)

steps          <- cfg$steps
# 默认 PNG;空/缺失时回退,避免无格式可写
plot_formats   <- cfg$plot_formats
if (is.null(plot_formats) || length(plot_formats) == 0 || !any(nzchar(as.character(plot_formats)))) {
  plot_formats <- "png"
}
plot_formats <- unique(as.character(plot_formats))
po             <- cfg$plot_options
size_mode      <- cfg$size_mode %||% "auto"   # auto / manual
font_family    <- cfg$font_family %||% "sans"  # 发表字体:sans/Arial/Helvetica/Times
# 快速预览:仅 PNG + 低 DPI,二次调参时显著缩短出图时间
preview_mode   <- isTRUE(cfg$preview_mode)
preview_dpi    <- as.integer(cfg$preview_dpi %||% 120L)
if (is.na(preview_dpi) || preview_dpi < 72L) preview_dpi <- 120L
if (preview_mode) {
  plot_formats <- "png"
  message(sprintf("[runner] 快速预览模式 ON (png @ %d dpi)", preview_dpi))
}
plot_dpi <- if (preview_mode) preview_dpi else 300L
deg_cache_rds  <- file.path(output_dir, "deg_cache.rds")

# 统一 sheet 名(与旧脚本契约一致)
sheet_normalized <- "Normalized_Matrix"
sheet_candidates <- "Candidate_Genes"
sheet_meta       <- "Analysis_Meta"

# 可视化样本→分组标签映射(沿用旧脚本)
sample_to_group <- unlist(lapply(names(group_info), function(g)
  setNames(rep(g, length(group_info[[g]])), group_info[[g]])))

# ─── 创建目录 ───────────────────────────────────────────────────────────────
dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
dir.create(plots_dir,  recursive = TRUE, showWarnings = FALSE)

# ─── 依赖包:按步骤懒加载(单图重绘时跳过 edgeR/DESeq2/ComplexHeatmap 等重包)──
ensure_pkgs <- function(pkgs) {
  pkgs <- unique(pkgs)
  for (pkg in pkgs) {
    if (!requireNamespace(pkg, quietly = TRUE)) {
      stop(sprintf("缺少 R 包:%s。请先安装。", pkg))
    }
  }
  suppressPackageStartupMessages({
    for (pkg in pkgs) library(pkg, character.only = TRUE)
  })
  invisible(TRUE)
}

need_deg_step  <- "deg" %in% steps
need_heatmap   <- any(c("heatmap", "select_heatmap") %in% steps)
need_venn      <- "venn" %in% steps
# Excel 仅:跑 DEG 写表,或无 RDS 时回退读表
need_xlsx      <- need_deg_step || !file.exists(deg_cache_rds)

message("[runner] 加载核心依赖...")
ensure_pkgs(c("dplyr", "tibble", "tidyr", "ggplot2", "ggrepel",
              "paletteer", "ggsci", "svglite"))
if (need_deg_step) {
  message("[runner] 加载 DEG 依赖 (edgeR/DESeq2/...)...")
  ensure_pkgs(c("edgeR", "DESeq2", "openxlsx", "pheatmap",
                "ComplexHeatmap", "circlize"))
} else {
  if (need_xlsx) {
    message("[runner] 加载 openxlsx(读 DEG Excel 缓存)...")
    ensure_pkgs("openxlsx")
  } else {
    message("[runner] 使用 deg_cache.rds,跳过 openxlsx")
  }
  if (need_heatmap) {
    message("[runner] 加载 ComplexHeatmap...")
    ensure_pkgs(c("ComplexHeatmap", "circlize"))
  }
  # 选定基因热图在缓存路径下按所选样本重算 log2CPM,依赖 edgeR(DGEList/cpm);
  # DEG 走 DESeq2 时 edgeR 不会随 DEG 步骤加载,单图重绘必须显式加载,否则
  # "could not find function DGEList" 退出码 1
  if ("select_heatmap" %in% steps) {
    message("[runner] 加载 edgeR(选定基因热图重算 log2CPM)...")
    ensure_pkgs("edgeR")
  }
  if (need_venn) ensure_pkgs("ggvenn")
}

# ─── 工具:智能尺寸(默认对齐 old/ 固定尺寸,极端维度时按数据扩展)─────────────
# size_mode: "auto"(old/ 基准 + 数据扩展)/ "manual"(用户值)
# old/ 基准:火山 6×5 / 热图 5×7 / 选定基因热图 7×2 / PCA 6×4 / Venn 5×5 / MA 6×5
auto_size <- function(plot_type, n_genes = 0, n_samples = 0, n_comparisons = 0, n_clusters = 0, n_sets = 0) {
  switch(plot_type,
    # old/2: Heatmap 5×7;基因极多时加高(上限 25in)
    "heatmap" = list(w = max(5, n_samples * 0.8), h = max(7, min(n_genes * 0.04, 25))),
    # old/4: 选定基因热图基准 4.5×5(竖版);基因/样本多时放大
    "select_heatmap" = list(w = max(4.5, n_samples * 0.3 + 3), h = max(5, n_genes * 0.16 + 1.8)),
    # old/2: PCA 6×4
    "pca" = list(w = 6, h = 4),
    # old/5: 火山图 6×5
    "volcano" = list(w = 6, h = 5),
    "ma" = list(w = 6, h = 5),
    "boxplot" = list(w = max(6, n_samples * 0.5), h = 5),
    "deg_bar" = list(w = max(6, n_comparisons * 1.2), h = 5),
    "top_genes" = list(w = 7, h = max(3, min(n_genes * 0.25, 12))),
    # old/2: Venn ≤4集 5×5
    "venn" = list(w = if (n_sets <= 4) 5 else 7, h = if (n_sets <= 4) 5 else 7),
    "dendrogram" = list(w = max(6, n_samples * 0.3), h = 5),
    "correlation" = list(w = max(5, n_samples * 0.6), h = max(5, n_samples * 0.6)),
    list(w = 6, h = 5)  # 兜底
  )
}

# ─── 工具:构建统一 ggplot 主题(减少重复,支持全量参数)──────────────────────────
# opts:含 gg_theme/base_size(原生主题)+ show_legend/legend_position/show_title/
#       show_xlab/show_ylab/show_grid/title_size/axis_text_size/axis_title_size/
#       title_hjust/title_color/axis_text_color/axis_title_color/panel_border/
#       panel_fill/plot_background/legend_title_size/legend_text_size/
#       show_axis_ticks/plot_margin/square
# gg_theme 默认 "bw"(theme_bw);可选 classic/minimal/gray/void/light/dark/linedraw
build_theme <- function(opts) {
  sq <- isTRUE(opts$square %||% FALSE)
  show_grid <- isTRUE(opts$show_grid %||% FALSE)
  show_legend <- isTRUE(opts$show_legend %||% TRUE)
  legend_pos <- opts$legend_position %||% "right"
  base_sz <- as.numeric(opts$base_size %||% 11)
  if (is.na(base_sz) || base_sz <= 0) base_sz <- 11
  t_size <- as.numeric(opts$title_size %||% 13)
  a_text_sz <- as.numeric(opts$axis_text_size %||% 10)
  a_title_sz <- as.numeric(opts$axis_title_size %||% 11)
  t_hjust <- as.numeric(opts$title_hjust %||% 0.5)
  t_color <- opts$title_color %||% "black"
  a_text_col <- opts$axis_text_color %||% "black"
  a_title_col <- opts$axis_title_color %||% "black"
  # panel_border:NULL/"auto" 保留 theme_* 自带边框(theme_bw 为实线框);
  # "none"/"solid"/"dashed" 为用户显式覆盖
  p_border_raw <- opts$panel_border
  p_border <- if (is.null(p_border_raw) || !nzchar(as.character(p_border_raw)[1]) ||
                  tolower(as.character(p_border_raw)[1]) %in% c("auto", "default", "inherit"))
    "auto" else tolower(as.character(p_border_raw)[1])
  p_fill <- opts$panel_fill %||% "white"
  p_bg <- opts$plot_background %||% "white"
  leg_t_sz <- as.numeric(opts$legend_title_size %||% 10)
  leg_text_sz <- as.numeric(opts$legend_text_size %||% 9)
  show_ticks <- isTRUE(opts$show_axis_ticks %||% TRUE)
  p_margin <- opts$plot_margin  # c(t,r,b,l) 或 "10,10,10,10" 或 NULL
  if (is.character(p_margin) && nzchar(p_margin)) {
    p_margin <- suppressWarnings(as.numeric(strsplit(p_margin, "[,，\\s]+")[[1]]))
  }

  margin_el <- if (!is.null(p_margin) && length(p_margin) == 4)
    margin(t = p_margin[1], r = p_margin[2], b = p_margin[3], l = p_margin[4], unit = "pt")
  else NULL

  # 原生 ggplot2 主题选择(默认 theme_bw)
  theme_name <- tolower(as.character(opts$gg_theme %||% "bw"))
  base_theme <- switch(theme_name,
    "classic"  = theme_classic(base_size = base_sz, base_family = font_family),
    "minimal"  = theme_minimal(base_size = base_sz, base_family = font_family),
    "gray"     = theme_gray(base_size = base_sz, base_family = font_family),
    "grey"     = theme_gray(base_size = base_sz, base_family = font_family),
    "void"     = theme_void(base_size = base_sz, base_family = font_family),
    "light"    = theme_light(base_size = base_sz, base_family = font_family),
    "dark"     = theme_dark(base_size = base_sz, base_family = font_family),
    "linedraw" = theme_linedraw(base_size = base_sz, base_family = font_family),
    theme_bw(base_size = base_sz, base_family = font_family)  # bw / 未知 → theme_bw
  )

  # 边框:auto 不覆盖 theme_*(theme_bw 保留完整黑框);显式值才改写
  border_override <- switch(p_border,
    "solid"  = element_rect(color = "black", fill = NA, linewidth = 0.5),
    "dashed" = element_rect(color = "grey50", fill = NA, linewidth = 0.5, linetype = "dashed"),
    "none"   = element_blank(),
    NULL
  )

  th <- theme(
      text = element_text(family = font_family),
      plot.title    = if (isTRUE(opts$show_title %||% TRUE))
                        element_text(hjust = t_hjust, size = t_size, face = "bold", color = t_color, family = font_family)
                      else element_blank(),
      plot.subtitle = if (isTRUE(opts$show_subtitle %||% FALSE))
                        element_text(hjust = t_hjust, size = t_size - 2, family = font_family)
                      else element_blank(),
      axis.title    = element_text(size = a_title_sz, color = a_title_col, family = font_family),
      axis.text     = element_text(size = a_text_sz, color = a_text_col, family = font_family),
      axis.ticks    = if (show_ticks) element_line(color = "grey50") else element_blank(),
      legend.position  = if (show_legend) legend_pos else "none",
      legend.title  = element_text(size = leg_t_sz, face = "bold", family = font_family),
      legend.text   = element_text(size = leg_text_sz, family = font_family),
      legend.direction = opts$legend_direction %||% "vertical",
      panel.background = element_rect(fill = p_fill, color = NA),
      panel.grid.minor = if (show_grid) element_line(color = "grey90", linewidth = 0.2) else element_blank(),
      panel.grid.major = if (show_grid) element_line(color = "grey85", linewidth = 0.3) else element_blank(),
      plot.background = element_rect(fill = p_bg, color = NA),
      plot.margin  = margin_el %||% margin(5.5, 5.5, 5.5, 5.5),
      aspect.ratio = if (sq) 1 else NULL
    )
  if (!is.null(border_override)) {
    th <- th + theme(panel.border = border_override)
  }
  base_theme + th
}

# ─── 工具:获取配色(支持 ggsci 调色板名)──────────────────────────────────────
get_palette <- function(palette_name = "category10_d3", n) {
  # 支持:category10_d3 / npg / jco / nejm / lancet / startrek / simpsons
  # paletteer_d("package::palette", n) 直接返回 n 个颜色向量
  full <- paste0("ggsci::", palette_name)
  tryCatch(
    paletteer_d(full, n),
    error = function(e) paletteer_d("ggsci::category10_d3", n)
  )
}

# ─── 工具:获取热图渐变色(支持 grDevices 连续色阶)──────────────────────────────
# old/ 用 grDevices::Blue-Red 2;支持 Blue-Red 2/RdBu/Viridis/Inferno/Magma/Plasma/Spectral
get_heat_palette <- function(palette_name = "Blue-Red 2", n = 100) {
  # Catppuccin Mocha 是离散分类色,用于 Cluster 注释,走 get_palette
  if (palette_name == "Catppuccin Mocha") {
    return(pal_iterm("Catppuccin Mocha")(n))
  }
  full <- paste0("grDevices::", palette_name)
  cols <- tryCatch(
    paletteer_c(full, n),
    error = function(e) paletteer_c("grDevices::Blue-Red 2", n)
  )
  cols
}

# ─── 工具:读取尺寸(auto 模式用启发式,manual 用用户值)─────────────────────────
get_size <- function(plot_type, opts, n_genes = 0, n_samples = 0, n_comparisons = 0, n_sets = 0) {
  size_mode <- cfg$size_mode %||% "auto"
  if (size_mode == "manual") {
    return(list(w = as.numeric(opts$width %||% 6), h = as.numeric(opts$height %||% 5)))
  }
  # auto:启发式计算;manual 字段里的值(默认即各图基准尺寸)作为下限,
  # 数据量大时自动放大(此前直接覆盖导致 auto 永远不生效)
  sz <- auto_size(plot_type, n_genes = n_genes, n_samples = n_samples,
                  n_comparisons = n_comparisons, n_sets = n_sets)
  if (!is.null(opts$width)  && as.numeric(opts$width)  > 0) sz$w <- max(sz$w, as.numeric(opts$width))
  if (!is.null(opts$height) && as.numeric(opts$height) > 0) sz$h <- max(sz$h, as.numeric(opts$height))
  sz
}

# ─── 工具:per-plot 子集选择(空=沿用全局 selected_groups / comparisons)──────────
# po[[type]]$groups / po[[type]]$comparisons 由前端设置;缺失或空 → 返回全局。
plot_groups <- function(type) {
  g <- po[[type]]$groups
  if (!is.null(g)) g <- as.character(g)
  g <- g[g %in% selected_groups]   # 防御:仅保留有效组
  if (length(g) == 0) selected_groups else g
}
plot_comparisons <- function(type) {
  cs <- po[[type]]$comparisons
  if (is.null(cs) || length(cs) == 0) return(comparisons)
  # JSON 反序列化可能是 matrix(n×2) 或 list;统一为 list(c(treat, ctrl))
  if (is.matrix(cs)) {
    cs_list <- lapply(seq_len(nrow(cs)), function(i) as.character(cs[i, ]))
  } else {
    cs_list <- lapply(cs, function(x) as.character(x))
  }
  # 仅保留与全局 comparisons 匹配的项(顺序遵循子集配置)
  global_str <- sapply(comparisons, function(x) paste0(x[1], "||", x[2]))
  cs_str <- sapply(cs_list, function(x) paste0(x[1], "||", x[2]))
  cs_list[cs_str %in% global_str]
}
# 某图比较对应的 cname 向量(treat_vs_ctrl)
plot_cnames <- function(type) {
  vapply(plot_comparisons(type), function(x) paste0(x[1], "_vs_", x[2]), character(1))
}
# 按组子集取样本(并集,保留 selected_groups 顺序)
plot_samples <- function(type) {
  unlist(group_info[plot_groups(type)])
}

# ─── 工具:per-plot 组顺序(列顺序)──────────────────────────────────────────
# po[[type]]$column_group_order 由前端拖拽设置(完整组顺序数组);
# 缺失或空 → 退回全局 group_order → 再退回 selected_groups。
# 返回的顺序只包含该图实际用到的组(plot_groups(type)),且遵循用户排列。
plot_group_order <- function(type) {
  g <- po[[type]]$column_group_order
  if (!is.null(g)) g <- as.character(g)
  # 过滤为该图实际用到的组(与 plot_groups 一致),仅保留有效组
  active <- plot_groups(type)
  g <- g[g %in% active]
  # 补齐用户未列出的组(排到末尾,保持 active 的相对顺序)
  missing <- setdiff(active, g)
  if (length(missing) > 0) g <- c(g, missing)
  if (length(g) == 0) {
    # 退回全局 group_order → selected_groups
    go <- group_order
    g <- go[go %in% active]
    if (length(g) == 0) g <- active
  }
  g
}

# 按组顺序排样本(用于热图列顺序;组内样本保持 group_info 定义顺序)
ordered_samples_by_group <- function(type) {
  go <- plot_group_order(type)
  samples <- unlist(group_info[go])
  # 仅保留实际存在于数据的样本(调用方进一步过滤列名)
  samples
}

# ─── 工具:统一保存(支持 svg/pdf 多格式,注入发表字体)──────────────────────
save_plot <- function(plot_fn, base_name, width, height) {
  for (fmt in plot_formats) {
    f <- file.path(plots_dir, paste0(base_name, ".", fmt))
    if (fmt == "svg") {
      svglite::svglite(f, width = width, height = height)
      plot_fn(); dev.off()
    } else if (fmt == "pdf") {
      pdf(f, width = width, height = height, family = font_family)
      plot_fn(); dev.off()
    } else if (fmt == "png") {
      grDevices::png(f, width = width * plot_dpi, height = height * plot_dpi,
                    res = plot_dpi, family = font_family)
      plot_fn(); dev.off()
    }
  }
}
# ggplot 对象专用(对齐 old/:ggsave 默认 pdf 设备;PDF 显式设 family 保发表字体)
save_ggplot <- function(ggobj, base_name, width, height) {
  for (fmt in plot_formats) {
    f <- file.path(plots_dir, paste0(base_name, ".", fmt))
    if (fmt == "svg") {
      svglite::svglite(f, width = width, height = height)
      print(ggobj); dev.off()
    } else if (fmt == "pdf") {
      # old/: ggsave 默认走 pdf() 设备;设 family 注入发表字体(Nature 要求 Arial)
      ggsave(f, ggobj, width = width, height = height, device = "pdf", family = font_family)
    } else if (fmt == "png") {
      ggsave(f, ggobj, width = width, height = height, device = "png", dpi = plot_dpi)
    }
  }
}

# ═══════════════════════════════════════════════════════════════════════════
# DEG 公共工具:regulation 判定 / 候选表重建 / 设计矩阵构建
# ═══════════════════════════════════════════════════════════════════════════

# regulation 判定统一入口:DEG 运行时与缓存重绘时共用,保证改动阈值后单图导出
# 与全量结果一致。判定用未收缩 LFC(log2FoldChange_unshrunk 优先):
# lfcShrink 会把低 count 基因的 LFC 收缩向 0,用收缩值做 |log2FC|>th 硬阈值
# 会系统性丢失低表达真阳性(DESeq2 文档建议阈值判定用未收缩估计)。
classify_regulation <- function(df) {
  lfc_col <- if ("log2FoldChange_unshrunk" %in% colnames(df)) "log2FoldChange_unshrunk" else "log2FoldChange"
  df$.lfc <- df[[lfc_col]]
  df <- df %>% mutate(regulation = case_when(
    !is.na(padj) & !is.na(.lfc) & !is.na(baseMean) &
      padj < fdr_th & .lfc >  log2fc_th & baseMean > basemean_th ~ "up",
    !is.na(padj) & !is.na(.lfc) & !is.na(baseMean) &
      padj < fdr_th & .lfc < -log2fc_th & baseMean > basemean_th ~ "down",
    TRUE ~ "no_sig"))
  df$.lfc <- NULL
  df
}

rebuild_cand_df <- function(results_list) {
  bind_rows(lapply(names(results_list), function(nm) {
    results_list[[nm]] %>% filter(regulation %in% c("up", "down")) %>% mutate(Comparison = nm)
  }))
}

# 构建设计矩阵并做满秩/混淆检测。
# has_batch=TRUE 时手动拼接:condition 全水平展开(列名=组安全名,makeContrasts 可
# 直接引用 X - Y)+ batch 展开后去掉最后一水平(等价于以该批次为参照,打破
# 全展开两因子带来的完全共线性;R 公式 ~0+batch+condition 会对第二个因子做
# 参照编码导致 ctrl 水平无列)。批次与分组完全混淆时 qr 秩亏 → 明确报错。
build_design <- function(colData, has_batch) {
  design <- if (has_batch) {
    cond_dm <- model.matrix(~ 0 + condition, data = colData)
    colnames(cond_dm) <- levels(colData$condition)
    batch_dm <- model.matrix(~ 0 + batch, data = colData)
    if (ncol(batch_dm) > 1) batch_dm <- batch_dm[, -ncol(batch_dm), drop = FALSE]
    cbind(cond_dm, batch_dm)
  } else {
    d <- model.matrix(~ 0 + condition, data = colData)
    colnames(d) <- levels(colData$condition)
    d
  }
  if (qr(design)$rank < ncol(design)) {
    stop("设计矩阵不满秩:批次(batch)与分组(condition)完全混淆,或样本数不足以同时估计两者。",
         "请调整批次分配(每组内需覆盖多个批次),或清空批次设置后重跑。")
  }
  design
}

# 对比 → 对照矩阵表达式(两种设计的 condition 列名均为组安全名)
contrast_expr <- function(treat, ctrl, has_batch) paste0(treat, " - ", ctrl)

# 公式满秩检查(DESeq2 分支在构建 dds 前调用,给出可读的中文报错,
# 避免 DESeq2 checkFullRank 的英文错误先触发)
assert_full_rank <- function(formula, data) {
  dm <- model.matrix(formula, data = data)
  if (qr(dm)$rank < ncol(dm))
    stop("设计矩阵不满秩:批次(batch)与分组(condition)完全混淆,或样本数不足以同时估计两者。",
         "请调整批次分配(每组内需覆盖多个批次),或清空批次设置后重跑。", call. = FALSE)
  invisible(TRUE)
}

# ═══════════════════════════════════════════════════════════════════════════
# Step 1: DEG 分析(搬 old/1.DEG_analysis.R,逻辑原样保留)
# ═══════════════════════════════════════════════════════════════════════════
run_deg <- function() {
  message("\n========== Step 1: DEG 分析 ==========")

  # ─── 1. 读入并清洗计数 ──────────────────────────────────────────────────
  count_raw <- read.csv(data_file, check.names = FALSE, stringsAsFactors = FALSE)
  gene_col  <- colnames(count_raw)[1]

  countData <- count_raw %>%
    filter(!is.na(!!sym(gene_col)), trimws(!!sym(gene_col)) != "")
  # 重复基因名:按原始计数求和合并(DESeq2 vignette 推荐做法),不静默丢行
  dup_n <- sum(duplicated(countData[[gene_col]]))
  if (dup_n > 0) {
    message("  重复基因名 ", dup_n, " 行,按原始计数求和合并")
    num_cols <- setdiff(colnames(countData), gene_col)
    countData <- countData %>%
      group_by(!!sym(gene_col)) %>%
      summarise(across(all_of(num_cols), ~ sum(suppressWarnings(as.numeric(.x)), na.rm = TRUE)), .groups = "drop") %>%
    as.data.frame()
  }
  rownames(countData) <- countData[[gene_col]]
  countData[[gene_col]] <- NULL
  countData[] <- lapply(countData, function(x) as.integer(round(x)))

  # 仅保留所选组样本
  selected_samples <- unlist(group_info[selected_groups])
  selected_samples <- selected_samples[selected_samples %in% colnames(countData)]
  missing <- setdiff(unlist(group_info[selected_groups]), colnames(countData))
  if (length(missing) > 0) warning("缺失样本:", paste(missing, collapse = ", "))
  countData_sub <- countData[, selected_samples, drop = FALSE]

  # 组名 sanitization:makeContrasts 要求 levels 为合法 R 名称(组名可能含空格/特殊字符)
  # 用 G1/G2... 作内部安全名,建双向映射,结果与日志再换回原名
  safe_levels <- setNames(make.names(selected_groups, unique = TRUE), selected_groups)
  safe_to_orig <- setNames(names(safe_levels), safe_levels)  # 安全名 -> 原名
  comp_safe <- lapply(comparisons, function(cmp) {
    c(safe_levels[[cmp[1]]], safe_levels[[cmp[2]]])
  })

  # colData(用安全名作 condition)
  colData <- data.frame(
    row.names = selected_samples,
    condition = factor(rep(safe_levels[selected_groups],
                           sapply(group_info[selected_groups], length)),
                       levels = as.character(safe_levels[selected_groups]))
  )

  # 批次列(可选):要求所有纳入分析的样本都已分配批次且一一对应
  has_batch <- length(batch_info) > 0
  if (has_batch) {
    b_map <- unlist(lapply(names(batch_info), function(b)
      setNames(rep(make.names(b), length(batch_info[[b]])), batch_info[[b]])))
    if (anyDuplicated(names(b_map)))
      stop("批次设置有误:同一样本被分配到多个批次,请修正后重试。")
    missing_b <- setdiff(selected_samples, names(b_map))
    if (length(missing_b) > 0)
      stop("以下样本已纳入分析但未分配批次: ", paste(missing_b, collapse = ", "),
           "。请在批次设置中为它们分配批次,或清空批次设置。")
    colData$batch <- factor(unname(b_map[selected_samples]))
    message("批次变量(", nlevels(colData$batch), " 水平): ",
            paste(levels(colData$batch), collapse = ", "),
            " → 设计公式 ~ batch + condition")
  }

  # ─── 2. 分流判定 ────────────────────────────────────────────────────────
  reps             <- table(colData$condition)
  use_edgeR_single <- min(reps) < 2
  use_edger_qlf    <- !use_edgeR_single && engine == "edger_qlf"
  if (use_edgeR_single && engine == "deseq2")
    message("[WARN] 存在单重复组:DESeq2 无法从 0 残差自由度估计离散度,自动回退 edgeR 单重复模式")
  message("\n样本重复情况:\n"); print(reps)
  message(if (use_edgeR_single) paste0("→ 单重复模式:edgeR + 固定 BCV = ", bcv)
          else if (use_edger_qlf) "→ 多重复模式:edgeR QL F-test(用户指定引擎)"
          else "→ 多重复模式:标准 DESeq2")

  # ─── 3a. edgeR 公共准备 + 两套引擎 ──────────────────────────────────────
  # prep:过滤 + TMM + 设计矩阵 + 归一化矩阵(单重复 BCV 与 QLF 共用)
  prep_edger <- function() {
    y <- DGEList(counts = countData_sub, group = colData$condition)
    keep <- filterByExpr(y, group = colData$condition, min.count = filter_min_count)
    y <- y[keep, , keep.lib.sizes = FALSE]
    message("过滤后保留基因:", sum(keep), " / ", length(keep))
    # edgeR ≥3.27.1:calcNormFactors 已更名为 normLibSizes(旧名仍兼容但会 warning)
    if ("normLibSizes" %in% getNamespaceExports("edgeR")) {
      y <- normLibSizes(y, method = "TMM")
    } else {
      y <- calcNormFactors(y, method = "TMM")
    }
    design <- build_design(colData, has_batch)
    norm_mat <- cpm(y, normalized.lib.sizes = TRUE, log = TRUE, prior.count = 2)
    baseMean_cpm <- rowMeans(cpm(y, normalized.lib.sizes = TRUE, log = FALSE))
    list(y = y, design = design, norm_mat = norm_mat, baseMean_cpm = baseMean_cpm)
  }

  # 结果表组装(edgeR 系):baseMean 为 mean CPM(注意与 DESeq2 的 normalized counts 单位不同)
  edger_res_df <- function(tt, baseMean_cpm, analysis_mode_, warning_) {
    res_df <- data.frame(
      GeneSymbol = rownames(tt),
      baseMean   = unname(baseMean_cpm[rownames(tt)]),
      log2FoldChange = tt$logFC,
      logCPM     = tt$logCPM,
      pvalue     = tt$PValue,
      padj       = tt$FDR,
      stringsAsFactors = FALSE
    )
    classify_regulation(res_df) %>%
      mutate(analysis_mode = analysis_mode_, warning = warning_)
  }

  # 单重复:固定 BCV + TREAT(edgeR 用户指南 §2.10)
  run_edgeR <- function() {
    message("\n========== edgeR 分析(单重复,固定 BCV + TREAT) ==========")
    e <- prep_edger()
    fit <- glmFit(e$y, e$design, dispersion = bcv^2)
    results_list <- list()
    for (i in seq_along(comp_safe)) {
      cmp <- comp_safe[[i]]; treat <- cmp[1]; ctrl <- cmp[2]
      orig_treat <- safe_to_orig[[treat]]; orig_ctrl <- safe_to_orig[[ctrl]]
      cname <- paste0(orig_treat, "_vs_", orig_ctrl)
      message("  比较:", cname)
      con <- makeContrasts(contrasts = contrast_expr(treat, ctrl, has_batch), levels = e$design)
      tr  <- glmTreat(fit, contrast = con[, 1], lfc = log2fc_th)
      tt  <- topTags(tr, n = Inf, sort.by = "none")$table
      results_list[[cname]] <- edger_res_df(tt, e$baseMean_cpm,
        paste0("edgeR_BCV", bcv),
        paste0("SINGLE_REPLICATE: P-values approximate (fixed dispersion). ",
               "TREAT tests H0: |log2FC| <= ", log2fc_th,
               " (p-value semantics differ from DESeq2 Wald)"))
    }
    list(norm_mat = e$norm_mat, results_list = results_list,
         mode_flag = paste0("edgeR_BCV", bcv), is_single = TRUE, is_treat = TRUE)
  }

  # 多重复:edgeR QL F-test(edgeR 官方推荐的重复数据分析方法)
  run_edger_qlf <- function() {
    message("\n========== edgeR 分析(QL F-test,多重复) ==========")
    e <- prep_edger()
    y <- estimateDisp(e$y, e$design, robust = TRUE)
    message("离散度估计:common BCV = ", signif(y$common.dispersion^0.5, 3))
    fit <- glmQLFit(y, e$design, robust = TRUE)
    results_list <- list()
    for (i in seq_along(comp_safe)) {
      cmp <- comp_safe[[i]]; treat <- cmp[1]; ctrl <- cmp[2]
      orig_treat <- safe_to_orig[[treat]]; orig_ctrl <- safe_to_orig[[ctrl]]
      cname <- paste0(orig_treat, "_vs_", orig_ctrl)
      message("  比较:", cname)
      con <- makeContrasts(contrasts = contrast_expr(treat, ctrl, has_batch), levels = e$design)
      qlf <- glmQLFTest(fit, contrast = con[, 1])
      tt  <- topTags(qlf, n = Inf, sort.by = "none")$table
      results_list[[cname]] <- edger_res_df(tt, e$baseMean_cpm, "edgeR_QLF", "")
    }
    list(norm_mat = e$norm_mat, results_list = results_list,
         mode_flag = "edgeR_QLF", is_single = FALSE, is_treat = FALSE)
  }

  # ─── 3b. DESeq2 分支 ────────────────────────────────────────────────────
  run_deseq2 <- function() {
    message("\n========== DESeq2 分析 ==========")
    if (has_batch) assert_full_rank(~ batch + condition, colData)
    dds <- DESeqDataSetFromMatrix(countData_sub, colData,
            design = if (has_batch) ~ batch + condition else ~ condition)
    dds <- dds[rowSums(counts(dds)) >= filter_rowsum, ]
    dds <- DESeq(dds, quiet = TRUE)
    # VST 归一化:vst 需足够基因数(nsub 默认 1000);基因少时回退到标准 VST(无子采样)
    n_genes <- nrow(dds)
    vsd <- tryCatch(
      vst(dds, blind = FALSE),
      error = function(e) {
        message("  vst 失败(", conditionMessage(e), "),回退 nsub=", min(n_genes, 1000))
        vst(dds, blind = FALSE, nsub = min(n_genes, 1000))
      }
    )
    norm_mat <- assay(vsd)

    results_list <- list()
    for (i in seq_along(comp_safe)) {
      cmp <- comp_safe[[i]]; treat <- cmp[1]; ctrl <- cmp[2]
      orig_treat <- safe_to_orig[[treat]]; orig_ctrl <- safe_to_orig[[ctrl]]
      cname <- paste0(orig_treat, "_vs_", orig_ctrl)
      message("  比较:", cname)
      # 未收缩 Wald 结果:regulation 判定与 log2FoldChange 列的依据
      res_raw <- results(dds, contrast = c("condition", treat, ctrl))
      # lfcShrink:ashr 优先(支持 contrast);不可用时回退 normal;均失败则不收缩。
      # 收缩估计仅作为效应量参考列(log2FC_shrunk),不参与阈值判定。
      shrink_note <- ""
      lfc_shrunk <- tryCatch(
        lfcShrink(dds, contrast = c("condition", treat, ctrl), type = "ashr")$log2FoldChange,
        error = function(e1) {
          tryCatch(
            lfcShrink(dds, contrast = c("condition", treat, ctrl), type = "normal")$log2FoldChange,
            error = function(e2) { shrink_note <<- "lfcShrink failed; log2FC_shrunk unavailable"; rep(NA_real_, length(res_raw$log2FoldChange)) }
          )
        }
      )
      if (shrink_note == "") shrink_note <- "shrunk(ashr)"
      res_df <- data.frame(
        GeneSymbol = rownames(res_raw),
        baseMean   = res_raw$baseMean,
        log2FoldChange = res_raw$log2FoldChange,
        log2FC_shrunk  = unname(lfc_shrunk),
        lfcSE      = res_raw$lfcSE,
        stat       = res_raw$stat,
        pvalue     = res_raw$pvalue,
        padj       = res_raw$padj,
        stringsAsFactors = FALSE
      )
      res_df <- classify_regulation(res_df) %>%
        mutate(
          # DESeq2 无 logCPM 概念;留 NA 避免与 edgeR 的 logCPM 混淆
          logCPM = NA_real_,
          analysis_mode = "DESeq2_standard",
          warning = if (grepl("^shrunk", shrink_note)) "" else shrink_note
        )
      results_list[[cname]] <- res_df
    }
    list(norm_mat = norm_mat, results_list = results_list,
         mode_flag = "DESeq2_standard", is_single = FALSE, is_treat = FALSE)
  }

  # ─── 4. 执行 ────────────────────────────────────────────────────────────
  res_env <- if (use_edgeR_single) run_edgeR()
             else if (use_edger_qlf) run_edger_qlf()
             else run_deseq2()
  norm_mat      <- res_env$norm_mat
  results_list  <- res_env$results_list
  mode_flag     <- res_env$mode_flag
  is_single     <- res_env$is_single
  is_treat      <- isTRUE(res_env$is_treat)
  use_edgeR     <- use_edgeR_single || use_edger_qlf  # 兼容旧引用(Meta/报告/缓存)

  # ─── 5. 写 Excel ────────────────────────────────────────────────────────
  wb <- createWorkbook()
  addWorksheet(wb, sheet_normalized)
  writeData(wb, sheet_normalized, norm_mat, rowNames = TRUE, colNames = TRUE)

  cand_df <- bind_rows(
    lapply(names(results_list), function(nm) {
      results_list[[nm]] %>%
        filter(regulation %in% c("up", "down")) %>%
        mutate(Comparison = nm)
    })
  )
  addWorksheet(wb, sheet_candidates)
  writeData(wb, sheet_candidates, cand_df)

  for (nm in names(results_list)) {
    safe <- gsub("[^a-zA-Z0-9_-]", "_", nm)
    addWorksheet(wb, paste0(safe, "_All"))
    writeData(wb, paste0(safe, "_All"), results_list[[nm]])
    sig <- results_list[[nm]] %>% filter(regulation %in% c("up", "down"))
    addWorksheet(wb, paste0(safe, "_DEGs"))
    writeData(wb, paste0(safe, "_DEGs"), sig)
    write.csv(results_list[[nm]], file.path(output_dir, paste0(safe, "_All.csv")), row.names = FALSE)
    write.csv(sig,            file.path(output_dir, paste0(safe, "_DEGs.csv")), row.names = FALSE)
  }

  # 输入文件校验和(精确复现用;MD5 来自 base R tools 包)
  input_md5 <- tryCatch({
    m <- tools::md5sum(normalizePath(data_file, mustWork = FALSE))
    sprintf("%s (%s)", unname(m), basename(data_file))
  }, error = function(e) "unavailable")

  meta_df <- data.frame(
    Parameter = c("Analysis_mode", "R_package", "Engine_setting", "BCV", "Normalization",
                  "Pre_filtering", "IndependentFiltering", "lfcShrink_method",
                  "log2FC_threshold", "FDR_threshold", "FDR_method",
                  "baseMean_threshold", "Regulation_basis", "baseMean_unit",
                  "P_value_semantics", "Design_formula", "Batch_levels",
                  "N_groups", "N_samples", "N_comparisons",
                  "Normalized_matrix_type", "Single_replicate", "Input_file_md5", "Date"),
    Value = c(mode_flag,
              ifelse(use_edgeR, "edgeR", "DESeq2"),
              engine,
              ifelse(use_edgeR_single, bcv,
                     ifelse(use_edger_qlf, "estimated (robust)", "NA (estimated)")),
              ifelse(use_edgeR, "TMM", "DESeq2 size factors (median ratio)"),
              ifelse(use_edgeR, paste0("filterByExpr(min.count=", filter_min_count, ")"),
                     paste0("rowSums(counts)>=", filter_rowsum)),
              ifelse(use_edgeR, "N/A (edgeR 在过滤后基因集上做 BH)",
                     "DESeq2 默认独立过滤(IHW 前置)"),
              ifelse(use_edger_qlf, "N/A (QLF, logFC 未收缩)",
                     ifelse(use_edgeR_single, "N/A (TREAT)",
                            "ashr (contrast); reported as log2FC_shrunk, not used for thresholding")),
              log2fc_th, fdr_th, "Benjamini-Hochberg",
              basemean_th,
              "padj < FDR_th & |log2FoldChange| > log2FC_th & baseMean > baseMean_th (unshrunk LFC)",
              ifelse(use_edgeR, "mean CPM (TMM-normalized)", "mean normalized counts (DESeq2 size factors)"),
              ifelse(use_edgeR_single, "TREAT: H0 |log2FC| <= log2FC_th (differs from Wald)",
                     ifelse(use_edger_qlf, "QL F-test: H0 log2FC = 0",
                            "Wald test: H0 log2FC = 0")),
              if (has_batch) "~ batch + condition (DESeq2) / ~ 0 + batch + condition (edgeR)" else "~ condition",
              if (has_batch) nlevels(colData$batch) else 0L,
              length(selected_groups), ncol(countData_sub),
              length(comparisons),
              ifelse(use_edgeR, "log2-CPM (prior.count=2)", "VST (blind=FALSE)"),
              is_single, input_md5, as.character(Sys.Date()))
  )
  addWorksheet(wb, sheet_meta)
  writeData(wb, sheet_meta, meta_df)
  saveWorkbook(wb, excel_file, overwrite = TRUE)
  message("\n[OK] Excel 已保存:", normalizePath(excel_file))

  # 二进制缓存:单图重绘时跳过 openxlsx 读表,显著加速二次出图
  # deg_params:DEG 相关参数指纹。单图导出加载缓存时对比当前参数,
  # 不一致则按当前阈值重算 regulation(保证图表与参数一致,见 refresh_deg_cache)。
  tryCatch({
    saveRDS(list(
      norm_mat = norm_mat,
      results_list = results_list,
      cand_df = cand_df,
      mode_flag = mode_flag,
      is_single = is_single,
      is_treat = is_treat,
      use_edgeR = use_edgeR,
      deg_params = list(
        fdr_th = fdr_th, log2fc_th = log2fc_th, basemean_th = basemean_th,
        engine = engine, groups = selected_groups,
        comparisons = lapply(comparisons, function(x) paste0(x[1], "_vs_", x[2]))
      ),
      saved_at = as.character(Sys.time())
    ), deg_cache_rds, compress = "gzip")
    message("[OK] DEG RDS 缓存已保存:", normalizePath(deg_cache_rds))
  }, error = function(e) {
    message("[WARN] 写 deg_cache.rds 失败:", conditionMessage(e))
  })

  # ─── 6. QC:样本相关性热图(旧 1.DEG_analysis.R 末尾)──────────────────────
  cor_mat <- cor(norm_mat, method = "pearson")
  # 相关性数值落盘(审稿常索要的 QC 表)
  tryCatch({
    cor_df <- as.data.frame(cor_mat)
    cor_df$Sample <- rownames(cor_df)
    write.csv(cor_df[, c("Sample", setdiff(colnames(cor_df), "Sample"))],
              file.path(output_dir, "sample_correlation.csv"), row.names = FALSE)
    message("[OK] 样本相关性矩阵已写出:sample_correlation.csv")
  }, error = function(e) message("[WARN] 写 sample_correlation.csv 失败:", conditionMessage(e)))
  # 组内生物学重复低相关警告:log 归一化矩阵 Pearson r < 0.8 建议核查
  # (跨组样本低相关属正常,不提示)
  warned <- 0
  for (pr in combn(colnames(cor_mat), 2, simplify = FALSE)) {
    r <- cor_mat[pr[1], pr[2]]
    g1 <- sample_to_group[[pr[1]]]; g2 <- sample_to_group[[pr[2]]]
    if (!is.na(r) && r < 0.8 && !is.na(g1) && identical(g1, g2)) {
      message("[WARN] 组内样本相关性偏低:", pr[1], " ~ ", pr[2],
              " r = ", sprintf("%.2f", r), "(建议核查样本质量/是否离群)")
      warned <- warned + 1
    }
  }
  if (warned == 0) message("[OK] 组内生物学重复相关性均 >= 0.8")
  ann_col <- data.frame(Group = sample_to_group[rownames(cor_mat)],
                        row.names = rownames(cor_mat))
  ann_colors <- list(Group = setNames(
    paletteer::paletteer_d("ggsci::category10_d3")[seq_along(selected_groups)],
    selected_groups))
  save_plot(function() {
    pheatmap(cor_mat, display_numbers = TRUE, number_format = "%.2f",
             annotation_col = ann_col, annotation_colors = ann_colors,
             fontsize_number = 8, main = "Sample Correlation (Normalized Matrix)")
  }, "sample_correlation", width = 6, height = 5)
  message("[OK] sample_correlation 已生成")

  # 单重复警告文件
  if (is_single) {
    notice <- file.path(output_dir, "SINGLE_REPLICATE_NOTICE.txt")
    writeLines(c(
      "==================================================================",
      "NOTICE: SINGLE-REPLICATE ANALYSIS (edgeR, fixed BCV)",
      "==================================================================",
      "", paste0("Mode: ", mode_flag),
      paste0("BCV (fixed): ", bcv),
      "", "BCV guidance (edgeR User's Guide sec 2.10):",
      "  - 0.40  : human / genetically diverse samples (default)",
      "  - 0.10  : isogenic / genetically identical (e.g. same cell line)",
      "  - 0.01  : sequencing of technical replicates only",
      "Adjust BCV in 'Analysis Parameters' to match your sample type.",
      "",
      "Reference: edgeR User's Guide, section 2.10; Chen et al. (2008).",
      "",
      "P-values are APPROXIMATE (variance is fixed, not estimated from",
      "replicates). Use for candidate screening only. Reported FDR is BH-",
      "adjusted on the filtered gene set.", "",
      "REQUIRED before publication: validate key genes with qPCR or",
      "biological replicates. Reviewers typically require >=3 bio reps.",
      "=================================================================="
    ), notice)
    message("[WARN]  单重复警告已生成:", notice)
  }

  # ─── 7. 可重复性:sessionInfo + Markdown 分析报告(期刊要求报告软件版本)──
  tryCatch({
    writeLines(capture.output(sessionInfo()), file.path(output_dir, "session_info.txt"))
    message("[OK] 软件版本已写出:session_info.txt")
  }, error = function(e) message("[WARN] 写 session_info.txt 失败:", conditionMessage(e)))

  tryCatch({
    n_tested <- if (length(results_list) > 0) nrow(results_list[[1]]) else NA
    engine_desc <- if (use_edgeR_single) {
      paste0("edgeR (single-replicate mode; fixed BCV = ", bcv,
             "; TMM normalization; glmTREAT TREAT test, H0: |log2FC| <= ", log2fc_th,
             " — note: TREAT p-values are NOT equivalent to Wald p-values)")
    } else if (use_edger_qlf) {
      "edgeR (QL F-test, robust dispersion estimation; TMM normalization)"
    } else {
      "DESeq2 (Wald test; median-of-ratios normalization; ash r-shrunken LFC reported as log2FC_shrunk; regulation judged on unshrunk Wald LFC)"
    }
    design_desc <- if (has_batch) "~ batch + condition (batch as covariate)" else "~ condition (single factor)"  # edgeR 实现为 ~0+batch+condition,等价参数化
    filter_desc <- if (use_edgeR) paste0("edgeR filterByExpr(min.count = ", filter_min_count, ")")
                   else paste0("DESeq2 pre-filter rowSums(counts) >= ", filter_rowsum)
    group_lines <- paste0("- **", selected_groups, "**: ",
                          sapply(group_info[selected_groups], length), " 样本 (",
                          sapply(group_info[selected_groups], paste, collapse = ", "), ")")
    deg_rows <- lapply(names(results_list), function(nm) {
      r <- results_list[[nm]]
      paste0("| ", nm, " | ", sum(r$regulation == "up"), " | ",
             sum(r$regulation == "down"), " | ", sum(r$regulation == "no_sig"), " |")
    })
    pkg_ver <- function(pkg) tryCatch(as.character(utils::packageVersion(pkg)),
                                      error = function(e) "?")
    engine_pkg <- if (use_edgeR) "edgeR" else "DESeq2"
    methods_en <- paste0(
      "Differential expression was analysed with ", engine_pkg, " v", pkg_ver(engine_pkg),
      " in R v", paste(R.version$major, R.version$minor, sep = "."), ". ",
      "Genes were pre-filtered (", filter_desc,
      "); library sizes were normalized by ",
      if (use_edgeR) "the TMM method" else "the median-of-ratios method (DESeq2 size factors)",
      ". A negative-binomial generalized linear model was fitted with the design `",
      if (has_batch) "~ batch + condition" else "~ condition",
      "` and per-group contrasts were tested (", engine_desc, "). ",
      if (use_edgeR_single) paste0("Because at least one group had a single replicate, dispersion was fixed at BCV = ", bcv, ". ") else "",
      "P-values were adjusted for multiple testing with the Benjamini-Hochberg procedure; ",
      "genes with adjusted P < ", fdr_th, ", |log2 Fold Change| > ", log2fc_th,
      " (unshrunk estimate) and mean expression > ", basemean_th, " were considered differentially expressed. ",
      "Gene-set enrichment analysis (GSEA) was performed with clusterProfiler v", pkg_ver("clusterProfiler"),
      " on all tested genes ranked by ", if (use_edgeR) "sign(log2FC) x (-log10 P)" else "the Wald statistic",
      ". Full software versions are listed in session_info.txt."
    )
    report <- c(
      "# RNA-seq Analysis Report",
      "",
      paste0("- **Run**: ", basename(output_dir)),
      paste0("- **Date**: ", format(Sys.time(), "%Y-%m-%d %H:%M:%S")),
      paste0("- **Input**: ", data_file),
      paste0("- **Input MD5**: ", input_md5),
      paste0("- **Engine**: ", engine_desc),
      paste0("- **Design**: ", design_desc),
      paste0("- **Filtering**: ", filter_desc),
      paste0("- **DEG thresholds**: |log2FC| > ", log2fc_th,
             ", FDR (BH) < ", fdr_th, ", baseMean > ", basemean_th,
             " (judged on unshrunk LFC)"),
      paste0("- **Genes tested**: ", n_tested),
      "- **Duplicate gene symbols**: collapsed by summing raw counts (DESeq2 vignette)",
      "",
      "## Groups",
      group_lines,
      "",
      "## DEG counts per comparison",
      "| Comparison | Up | Down | Not significant |",
      "|---|---|---|---|",
      deg_rows,
      "",
      "## Output files",
      "- `RNAseq_Analysis_Results.xlsx` (normalized matrix, candidate genes, per-comparison results, metadata)",
      "- `<Comparison>_All.csv` / `<Comparison>_DEGs.csv` per comparison",
      "- `sample_correlation.csv` (sample correlation QC matrix)",
      "- `session_info.txt` (R and package versions, for the Methods section)",
      "- `plots/` (all figures)",
      "",
      "",
      "## Methods (auto-generated, for manuscript)",
      "",
      methods_en,
      "",
      "See `session_info.txt` for exact software versions to report in the Methods section."
    )
    writeLines(unlist(report), file.path(output_dir, "Analysis_Report.md"))
    message("[OK] 分析报告已写出:Analysis_Report.md")
  }, error = function(e) message("[WARN] 写 Analysis_Report.md 失败:", conditionMessage(e)))

  # 返回给后续步骤用
  list(norm_mat = norm_mat, results_list = results_list,
       mode_flag = mode_flag, is_single = is_single, is_treat = is_treat,
       use_edgeR = use_edgeR, cand_df = cand_df,
       deg_params = list(
         fdr_th = fdr_th, log2fc_th = log2fc_th, basemean_th = basemean_th,
         engine = engine, groups = selected_groups,
         comparisons = lapply(comparisons, function(x) paste0(x[1], "_vs_", x[2]))
       ))
}

# ═══════════════════════════════════════════════════════════════════════════
# Step 2: 整体热图 + PCA + Venn(搬 old/2.Heatmap_PCA_Venn.R)
# ═══════════════════════════════════════════════════════════════════════════
run_heatmap_pca_venn <- function(deg_env) {
  # 仅当 heatmap/pca/venn 任一在 steps 中才执行(避免仅跑 deg 时空跑)
  if (!any(c("heatmap","pca","venn") %in% steps)) {
    return(invisible(NULL))
  }
  message("\n========== Step 2: 热图/PCA/Venn ==========")
  norm_full <- as.data.frame(deg_env$norm_mat)
  cand_df   <- deg_env$cand_df

  # 排除基因
  deg_genes <- unique(cand_df$GeneSymbol)
  deg_genes <- setdiff(deg_genes, excluded_genes)

  # 整体热图:使用其组子集的样本(空=全部 selected)
  hm_groups <- plot_groups("heatmap")
  hm_selected_samples <- unlist(group_info[hm_groups])

  # 整体热图:可选择使用所有基因(不过滤)或仅候选基因
  # 若无候选基因(如单重复无显著 DEG),自动回退到全基因模式
  use_all <- isTRUE(po$heatmap$use_all_genes)
  if (!use_all && length(deg_genes) == 0) {
    message("[WARN] 无候选基因,自动回退到全基因模式(排除 excluded_genes)")
    use_all <- TRUE
  }
  if (use_all) {
    hm_data <- as.matrix(norm_full[setdiff(rownames(norm_full), excluded_genes), hm_selected_samples, drop = FALSE])
    message("使用所有基因(不过滤):", nrow(hm_data), " 基因 x ", ncol(hm_data), " 样本")
  } else {
    hm_data <- as.matrix(norm_full[rownames(norm_full) %in% deg_genes, hm_selected_samples, drop = FALSE])
    message("候选基因:", length(deg_genes), " | 热图矩阵:", nrow(hm_data), " 基因 x ", ncol(hm_data), " 样本")
  }

  # hm_data 仅在以下步骤需要:heatmap / venn(by sample)
  # PCA 使用独立的 pca_data(全基因谱),不依赖 hm_data
  needs_hm <- ("heatmap" %in% steps) ||
              (("venn" %in% steps) && (po$venn$by %||% "sample") == "sample")
  if (needs_hm) {
    if (nrow(hm_data) == 0) {
      stop("热图/Venn 所需矩阵为空:无候选基因命中归一化矩阵。",
           " 若仅导出本图,请先运行完整 DEG 分析以生成缓存;",
           " 或在热图选项中勾选『使用所有基因』。")
    }
    if (ncol(hm_data) < 2) {
      stop("热图/Venn 所需样本数 < 2,无法计算。请在配置中选定至少 2 组样本。")
    }
  }

  # ─── 基因排序与聚类(旧 get_order_clusters,参数化 k)────────────────────────
  # 仅在热图需要聚类顺序时执行(pca/venn 不依赖聚类结果)
  if ("heatmap" %in% steps) {
  k_clust <- as.integer(po$heatmap$k_clusters %||% 3)
  scaled <- t(scale(t(hm_data)))
  hc <- hclust(dist(scaled, method = "euclidean"), method = "ward.D2")
  order_genes <- rownames(hm_data)[hc$order]
  base_cl <- cutree(hc, k = k_clust)
  cl_pos <- aggregate(position ~ cluster,
                      data = data.frame(position = seq_along(order_genes),
                                        cluster = base_cl[order_genes]), median) |>
    arrange(position)
  new_lab <- setNames(paste0("Cluster_", seq_len(nrow(cl_pos))),
                      as.character(cl_pos$cluster))
  cl_df <- data.frame(
    GeneSymbol = names(base_cl),
    Original_Cluster = factor(new_lab[as.character(base_cl)],
                             levels = paste0("Cluster_", 1:k_clust)),
    stringsAsFactors = FALSE)
  rownames(cl_df) = cl_df$GeneSymbol
  final_order <- order_genes
  cluster_mode <- "auto"  # auto / cluster_aware / pure_manual

  # ─── 手动基因排序回读(old/2:72-117)──────────────────────────────────────
  # 用户可手动编辑以下文件覆盖自动聚类顺序(发表级常需手动调序):
  #   gene_cluster_order.csv:簇感知(列 GeneSymbol, Target_Cluster 可选),保留簇结构
  #   gene_order_manual.csv :纯手动(列 GeneSymbol),完全自定义顺序
  # 注意:本脚本每次运行也会写出 gene_cluster_order.csv(自动结果);
  #       回读仅在文件存在且含基因时生效,用户编辑后下次运行即按用户顺序。
  manual_cluster_file <- file.path(output_dir, "gene_cluster_order_user.csv")
  manual_pure_file    <- file.path(output_dir, "gene_order_manual.csv")
  if (file.exists(manual_pure_file)) {
    m <- read.csv(manual_pure_file, stringsAsFactors = FALSE, check.names = FALSE)
    gcol <- if ("GeneSymbol" %in% colnames(m)) "GeneSymbol" else 1
    mg <- na.omit(as.character(m[[gcol]])); mg <- mg[mg %in% rownames(hm_data)]
    if (length(mg) > 0) {
      cluster_mode <- "pure_manual"
      final_order <- c(mg, setdiff(rownames(hm_data), mg))
      cl_df <- data.frame(GeneSymbol = final_order,
                          Original_Cluster = factor(rep("Manual", length(final_order))),
                          stringsAsFactors = FALSE)
      rownames(cl_df) <- cl_df$GeneSymbol
      message("[INFO] 检测到 gene_order_manual.csv → 纯手动排序(", length(mg), " 基因)")
    }
  } else if (file.exists(manual_cluster_file)) {
    m <- read.csv(manual_cluster_file, stringsAsFactors = FALSE, check.names = FALSE)
    gcol <- if ("GeneSymbol" %in% colnames(m)) "GeneSymbol" else 1
    mg <- na.omit(as.character(m[[gcol]])); mg <- mg[mg %in% rownames(hm_data)]
    if (length(mg) > 0) {
      cluster_mode <- "cluster_aware"
      final_order <- c(mg, setdiff(rownames(hm_data), mg))
      cl_df <- cl_df[final_order, , drop = FALSE]
      # 可选 Target_Cluster 列:覆盖基因所属簇
      if ("Target_Cluster" %in% colnames(m)) {
        for (i in seq_len(min(nrow(m), length(mg)))) {
          g <- m[[gcol]][i]; nc <- m$Target_Cluster[i]
          if (g %in% rownames(cl_df) && !is.na(nc) && nzchar(nc))
            cl_df[g, "Original_Cluster"] <- as.character(nc)
        }
        cl_df$Original_Cluster <- factor(cl_df$Original_Cluster,
                                         levels = unique(cl_df$Original_Cluster))
      }
      message("[INFO] 检测到 gene_cluster_order_user.csv → 簇感知手动排序(", length(mg), " 基因)")
    }
  }

  export_df <- data.frame(GeneSymbol = final_order,
                          Original_Cluster = as.character(cl_df$Original_Cluster),
                          stringsAsFactors = FALSE)
  write.csv(export_df, file.path(output_dir, "gene_cluster_order.csv"), row.names = FALSE)

  hm_data <- hm_data[final_order, , drop = FALSE]

  # ─── 整体热图(旧 plot_heatmap,作图代码原样)──────────────────────────────
  if ("heatmap" %in% steps) {
    message("绘制整体热图...")
    hopt <- po$heatmap
    show_mark <- isTRUE(hopt$show_marker_labels)
    hm_w <- as.numeric(hopt$width %||% 5)
    hm_h <- as.numeric(hopt$height %||% 7)
    show_hm_legend <- isTRUE(hopt$show_legend %||% TRUE)
    hm_legend_side <- hopt$legend_position %||% "right"
    show_col_names <- isTRUE(hopt$show_column_names %||% TRUE)
    col_names_rot <- as.numeric(hopt$column_names_rot %||% 0)
    show_row_names <- isTRUE(hopt$show_row_names %||% FALSE)

    # 列(样本)顺序:按用户排列的组顺序(column_group_order)→全局 group_order;
    # 组内样本保持 group_info 定义顺序。允许 per-plot 调整列顺序。
    sample_order <- ordered_samples_by_group("heatmap")
    sample_order <- sample_order[sample_order %in% colnames(hm_data)]
    hm_data_h <- hm_data[, sample_order, drop = FALSE]
    ann_col <- data.frame(Group = sample_to_group[colnames(hm_data_h)],
                          row.names = colnames(hm_data_h))
    glv <- unique(ann_col$Group)
    gcols <- setNames(paletteer_d("ggsci::category10_d3")[seq_along(glv)], glv)
    # 热图渐变色 + Z-score 范围(old/: Blue-Red 2, ±2)
    heat_palette <- hopt$heatmap_palette %||% "Blue-Red 2"
    z_min <- as.numeric(hopt$zscore_min %||% -2)
    z_max <- as.numeric(hopt$zscore_max %||% 2)
    heat_cols <- get_heat_palette(heat_palette, n = 100)
    mat <- t(scale(t(hm_data_h)))
    col_fun <- colorRamp2(seq(z_min, z_max, length.out = 100), heat_cols)
    # Z-score 图例刻度(基于范围动态生成 5 档)
    z_at <- round(seq(z_min, z_max, length.out = 5), 1)
    ha_col <- HeatmapAnnotation(Group = ann_col$Group, col = list(Group = gcols),
                                annotation_name_side = "left", show_annotation_name = FALSE,
                                simple_anno_size = unit(2,"mm"),
                                show_legend = show_hm_legend)
    # Cluster 注释:配色方案 + 显示开关(old/2: Catppuccin Mocha)
    show_cl_ann <- isTRUE(hopt$show_cluster_annotation %||% TRUE)
    cluster_pal <- hopt$cluster_palette %||% "Catppuccin Mocha"
    ann_row <- data.frame(Cluster = cl_df$Original_Cluster, row.names = rownames(hm_data_h))
    ucl <- levels(cl_df$Original_Cluster)
    ccols <- setNames(get_heat_palette(cluster_pal, length(ucl)), ucl)
    ha_row <- if (show_cl_ann) rowAnnotation(Cluster = ann_row$Cluster, col = list(Cluster = ccols),
                            annotation_name_side = "top",
                            annotation_name_gp = gpar(fontsize = 0, fontfamily = font_family),
                            simple_anno_size = unit(2,"mm"),
                            show_legend = show_hm_legend) else NULL
    ha_mark <- NULL
    if (show_mark) {
      valid <- marker_genes[marker_genes %in% rownames(mat)]
      if (length(valid) > 0)
        ha_mark <- rowAnnotation(mark = anno_mark(at = match(valid, rownames(mat)), labels = valid,
                                 which = "row", side = "left",
                                 labels_gp = gpar(fontsize = 6, fontface = "bold.italic", fontfamily = font_family),
                                 link_gp = gpar(col = "#333", lwd = 1),
                                 padding = unit(4, "mm"), extend = unit(10, "mm")))
    }
    ht <- Heatmap(mat, name = "Z-score", col = col_fun,
                  heatmap_legend_param = if (show_hm_legend) list(title = "Z-score", at = z_at,
                                              legend_height = unit(5, "cm"),
                                              title_gp = gpar(fontsize = 10, fontfamily = font_family),
                                              labels_gp = gpar(fontsize = 9, fontfamily = font_family)) else list(show = FALSE),
                  cluster_rows = FALSE, cluster_columns = FALSE,
                  cluster_row_slices = FALSE, show_row_names = show_row_names,
                  show_column_names = show_col_names,
                  column_labels = if (show_col_names) ann_col$Group else NULL,
                  column_names_rot = col_names_rot,
                  column_names_gp = gpar(fontsize = 9, fontface = "bold", col = "black", fontfamily = font_family),
                  column_names_side = "bottom", column_names_centered = TRUE,
                  row_dend_width = unit(0,"mm"), column_dend_height = unit(0,"mm"),
                  left_annotation = ha_mark, right_annotation = ha_row,
                  top_annotation = ha_col, border = NA, rect_gp = gpar(col = NA),
                  row_split = if (!is.null(ha_row)) cl_df$Original_Cluster else NULL, row_title = NULL,
                  row_gap = unit(1, "mm"), use_raster = nrow(mat) > 500)
    save_plot(function() {
      draw(ht, merge_legends = TRUE,
           heatmap_legend_side = hm_legend_side,
           annotation_legend_side = hm_legend_side)
    }, "heatmap", width = hm_w, height = hm_h)
    message("[OK] Heatmap 已生成")
  }
  } # end if ("heatmap" %in% steps) —— 聚类+热图

  # ─── PCA(正方形,全量参数)──────────────────────────────────────────────────
  if ("pca" %in% steps) {
    message("绘制 PCA...")
    o <- po$pca
    # PCA 应基于全基因归一化矩阵(仅排除 excluded_genes),而非候选基因矩阵;
    # 候选基因矩阵(hm_data)仅适用于热图。PCA 反映样本整体表达谱分布。
    pca_groups <- plot_groups("pca")
    pca_samples <- unlist(group_info[pca_groups])
    pca_samples <- pca_samples[pca_samples %in% colnames(norm_full)]
    pca_data <- as.matrix(norm_full[setdiff(rownames(norm_full), excluded_genes), pca_samples, drop = FALSE])
    if (nrow(pca_data) == 0) stop("PCA 所需矩阵为空:归一化矩阵无可用基因。")
    if (ncol(pca_data) < 2) stop("PCA 所需样本数 < 2,无法计算。")
    message("PCA 矩阵:", nrow(pca_data), " 基因 x ", ncol(pca_data), " 样本(全基因谱)")
    sz <- get_size("pca", o, n_samples = ncol(pca_data))
    do_label <- isTRUE(o$label_repel)
    label_text <- o$label_text %||% "group"

    # scale_genes:VST/log2CPM 已方差稳定,默认不再按基因标准化(scale.=FALSE,
    # DESeq2 vignette 惯例);用户可显式开启
    do_scale <- isTRUE(o$scale_genes %||% FALSE)
    message("PCA scale.=", do_scale)
    pca <- prcomp(t(pca_data), scale. = do_scale)
    ve <- round(100 * pca$sdev^2 / sum(pca$sdev^2), 2)
    df <- data.frame(PC1 = pca$x[,1], PC2 = pca$x[,2],
                     Sample = colnames(pca_data),
                     Group = sample_to_group[colnames(pca_data)])
    glv <- unique(df$Group)
    pal_name <- o$color_palette %||% "category10_d3"
    gcols <- setNames(get_palette(pal_name, length(glv)), glv)
    mr <- signif(max(abs(df$PC1), abs(df$PC2)) * 1.12, 2)

    # 色盲友好:默认 color+shape 双编码分组;提供 point_shape 时退回单形状
    shape_by_group <- isTRUE(o$shape_by_group %||% TRUE)
    p <- ggplot(df, aes(PC1, PC2, color = Group))
    if (shape_by_group) p <- ggplot(df, aes(PC1, PC2, color = Group, shape = Group))
    if (isTRUE(o$show_crosshair %||% TRUE))
      p <- p + geom_hline(yintercept = 0, linetype = "dashed", color = "grey60", linewidth = 0.5) +
               geom_vline(xintercept = 0, linetype = "dashed", color = "grey60", linewidth = 0.5)
    p <- p + geom_point(size = as.numeric(o$point_size %||% 4),
                        alpha = as.numeric(o$point_alpha %||% 0.9))
    if (shape_by_group) {
      gshapes <- c(15:19, 0:9, 21:25, 3:4)  # 前 20 组:实心/空心/三角/圆形
      p <- p + scale_shape_manual(values = gshapes[seq_along(glv)])
    } else {
      p <- p + scale_shape_manual(values = setNames(rep(as.numeric(o$point_shape %||% 19), length(glv)), glv))
    }
    if (do_label && label_text != "none") {
      lbl <- if (label_text == "sample") "Sample" else "Group"
      p <- p + geom_text_repel(aes(label = .data[[lbl]]), size = 3, max.overlaps = 30, box.padding = 0.6)
    }
    # 各组样本量(审稿要求报告 n)
    n_tab <- table(df$Group)
    n_text <- paste(paste0(glv, " (n=", as.integer(n_tab[glv]), ")"), collapse = ", ")
    lab_list <- list(color = o$legend_title %||% "Group")
    if (shape_by_group) lab_list$shape <- o$legend_title %||% "Group"
    if (isTRUE(o$show_n %||% TRUE)) lab_list$subtitle <- paste0("n: ", n_text)
    if (isTRUE(o$show_xlab %||% TRUE)) lab_list$x <- paste0("PC1 (", ve[1], "%)")
    if (isTRUE(o$show_ylab %||% TRUE)) lab_list$y <- paste0("PC2 (", ve[2], "%)")
    pt <- o$title %||% "PCA"; if (isTRUE(o$show_title %||% TRUE) && nchar(pt) > 0) lab_list$title <- pt
    # 自定义坐标范围
    xl <- o$xlim; yl <- o$ylim
    xl_ok <- !is.null(xl) && length(xl) >= 2 && !any(is.na(as.numeric(xl[1:2])))
    yl_ok <- !is.null(yl) && length(yl) >= 2 && !any(is.na(as.numeric(yl[1:2])))
    coord_args <- list(xlim = if (xl_ok) c(as.numeric(xl[1]), as.numeric(xl[2])) else c(-mr, mr),
                       ylim = if (yl_ok) c(as.numeric(yl[1]), as.numeric(yl[2])) else c(-mr, mr))
    p <- p + do.call(coord_cartesian, coord_args) +
      do.call(labs, lab_list) +
      scale_color_manual(values = gcols) +
      build_theme(o)
    save_ggplot(p, "pca", width = sz$w, height = sz$h)
    message("[OK] pca 已生成")
  }

  # ─── Venn(旧 plot_venn)────────────────────────────────────────────────────
  if ("venn" %in% steps) {
    message("绘制 Venn...")
    # 默认按比较的 DEG 集合(方法学上可解释);by=sample 为每样本高于中位数的基因,
    # 仅作探索用途保留
    vby <- po$venn$by %||% "comparison"
    if (vby == "sample") {
      sets <- list()
      for (s in colnames(hm_data)) {
        active <- rownames(hm_data)[hm_data[, s] > median(hm_data[, s])]
        sets[[paste0(s, " (", sample_to_group[s], ")")]] <- active
      }
    } else {
      # 按比较的 DEG 集合(仅 venn 子集选中的比较,空=全部)
      venn_cmps <- plot_comparisons("venn")
      venn_cnames <- vapply(venn_cmps, function(x) paste0(x[1], "_vs_", x[2]), character(1))
      venn_res <- deg_env$results_list[intersect(venn_cnames, names(deg_env$results_list))]
      sets <- lapply(venn_res, function(r)
        r$GeneSymbol[r$regulation %in% c("up","down")])
      sets <- sets[sapply(sets, length) > 0]
    }
    if (length(sets) >= 2) {
      vcols <- setNames(paletteer_d("ggsci::category10_d3")[seq_along(sets)], names(sets))
      max_sets <- as.integer(po$venn$max_sets %||% 4)
      if (length(sets) <= max_sets) {
        pv <- ggvenn(sets, fill_color = vcols, stroke_size = 0.5,
                     set_name_size = 3, text_size = 2.5, show_stats = "cp") +
          ggtitle(ifelse(vby=="sample", "Gene Overlap - By Sample", "DEG Overlap - By Comparison")) +
          theme(plot.title = element_text(hjust = 0.5, size = 10, face = "bold"))
        save_ggplot(pv, "venn", width = 5, height = 5)
        message("[OK] venn 已生成")
      } else {
        for (pair in combn(names(sets), 2, simplify = FALSE)) {
          pn <- paste(gsub(" .*", "", pair), collapse = "_vs_")
          pv <- ggvenn(sets[pair], fill_color = vcols[pair], stroke_size = 0.5,
                       set_name_size = 3, text_size = 2.5) +
            ggtitle(paste("Overlap:", paste(pair, collapse = " vs ")))
          save_ggplot(pv, paste0("venn_", pn), width = 6, height = 6)
        }
        message("[OK] 两两 Venn 已生成")
      }
    } else {
      message("[WARN] 集合不足,跳过 Venn")
    }
  }
}

# ═══════════════════════════════════════════════════════════════════════════
# Step 3: 选定基因功能簇热图(搬 old/4.Select_Genes_Heatmap.R)
# ═══════════════════════════════════════════════════════════════════════════
run_select_heatmap <- function() {
  if (!("select_heatmap" %in% steps)) return(invisible(NULL))
  message("\n========== Step 3: 选定基因热图 ==========")

  # 从原始计数读取 + edgeR TMM 标准化(不过滤,旧逻辑)
  raw <- read.csv(data_file, check.names = FALSE, stringsAsFactors = FALSE)
  gene_col <- colnames(raw)[1]
  raw <- raw[!duplicated(raw[[gene_col]]), ]
  rownames(raw) <- raw[[gene_col]]
  raw[[gene_col]] <- NULL
  raw[] <- lapply(raw, as.integer)

  sel_samples <- unlist(group_info[plot_groups("select_heatmap")])
  sel_samples <- sel_samples[sel_samples %in% colnames(raw)]
  counts_sel <- as.matrix(raw[, sel_samples, drop = FALSE])

  y <- DGEList(counts = counts_sel, group = sample_to_group[colnames(counts_sel)])
  if ("normLibSizes" %in% getNamespaceExports("edgeR")) {
    y <- normLibSizes(y, method = "TMM")
  } else {
    y <- calcNormFactors(y, method = "TMM")
  }
  log2cpm <- cpm(y, normalized.lib.sizes = TRUE, log = TRUE, prior.count = 0.5)
  norm_full <- as.data.frame(log2cpm)

  valid_clusters <- lapply(gene_clusters, function(g) intersect(g, rownames(norm_full)))
  valid_clusters <- valid_clusters[sapply(valid_clusters, length) > 0]
  gene_order <- unlist(valid_clusters)
  if (length(gene_order) == 0) { message("[WARN] 没有有效基因,跳过选定基因热图"); return(invisible(NULL)) }

  all_marker <- unlist(gene_clusters)
  missing <- setdiff(all_marker, rownames(norm_full))
  if (length(missing) > 0) message("[WARN] 缺失基因:", paste(missing, collapse=", "))
  message("有效基因:", length(gene_order), " | 功能类别:", length(valid_clusters))

  cluster_vec <- rep(names(valid_clusters), sapply(valid_clusters, length))
  names(cluster_vec) <- gene_order

  # 样本显示名映射 + 按 group_order 排列(group_display 为空时用内部组名)
  sample_to_display <- unlist(lapply(names(group_info), function(g) {
    disp <- group_display[[g]] %||% g
    setNames(rep(disp, length(group_info[[g]])), group_info[[g]])
  }))
  # 列(样本)顺序:优先 per-plot column_group_order → 全局 group_order;
  # 仅含该图实际用到的组(plot_groups),未列出者补到末尾。
  go_valid <- plot_group_order("select_heatmap")
  desired_samples <- unlist(group_info[go_valid])
  desired_samples <- desired_samples[desired_samples %in% colnames(norm_full)]
  hm_data <- norm_full[gene_order, desired_samples, drop = FALSE]
  mat <- t(scale(t(hm_data)))

  display_groups <- sample_to_display[colnames(mat)]
  # 显示名 factor levels:用 group_display 的值,按 group_order(内部名)顺序
  disp_levels <- unlist(lapply(go_valid, function(g) group_display[[g]] %||% g))
  disp_levels <- if (length(disp_levels) > 0) as.character(disp_levels) else unique(as.character(display_groups))
  display_groups <- factor(display_groups, levels = disp_levels)
  gcols <- setNames(paletteer_d("ggsci::category10_d3")[seq_along(disp_levels)], disp_levels)

  # 读取选定基因热图参数(P0:此前误删导致 Step 3 崩溃)
  sh_opt <- po$select_heatmap

  cl_levels <- names(valid_clusters)
  # Cluster 配色(old/4: pal_npg;可切换)
  cluster_pal_sh <- sh_opt$cluster_palette %||% "npg"
  ccols <- setNames(get_palette(cluster_pal_sh, length(cl_levels)), cl_levels)

  # 热图渐变色 + Z-score 范围(old/: Blue-Red 2, ±2)
  heat_palette_sh <- sh_opt$heatmap_palette %||% "Blue-Red 2"
  z_min_sh <- as.numeric(sh_opt$zscore_min %||% -2)
  z_max_sh <- as.numeric(sh_opt$zscore_max %||% 2)
  heat_cols <- get_heat_palette(heat_palette_sh, n = 100)
  col_fun <- colorRamp2(seq(z_min_sh, z_max_sh, length.out = 100), heat_cols)
  z_at_sh <- round(seq(z_min_sh, z_max_sh, length.out = 5), 1)

  # 竖向布局(基因=行/纵向,样本=列/横向;不再转置)
  row_split_v <- factor(cluster_vec[rownames(mat)], levels = names(valid_clusters))

  show_sh_legend <- isTRUE(sh_opt$show_legend %||% TRUE)
  sh_legend_side <- sh_opt$legend_position %||% "right"
  show_gene_names <- isTRUE(sh_opt$show_gene_names %||% TRUE)
  show_group_names <- isTRUE(sh_opt$show_group_names %||% TRUE)
  show_cl_ann_sh <- isTRUE(sh_opt$show_cluster_annotation %||% TRUE)
  gene_rot <- as.numeric(sh_opt$gene_label_rot %||% 0)

  # 顶部列注释:Group(样本所属组)
  ann_col_grp <- data.frame(Group = as.character(display_groups),
                            row.names = colnames(mat))
  ha_col_grp <- HeatmapAnnotation(Group = ann_col_grp$Group, col = list(Group = gcols),
                                  show_annotation_name = FALSE, simple_anno_size = unit(4,"mm"),
                                  annotation_legend_param = list(Group = list(order = 1,
                                    title = "Group", title_gp = gpar(fontsize=10, face="bold", fontfamily = font_family),
                                    labels_gp = gpar(fontsize=9, fontfamily = font_family))))

  # 右侧行注释:Cluster(基因功能簇)—— 可关闭
  ann_row_cl <- data.frame(Cluster = cluster_vec[rownames(mat)], row.names = rownames(mat))
  ha_row_cl <- if (show_cl_ann_sh) rowAnnotation(Cluster = ann_row_cl$Cluster, col = list(Cluster = ccols),
                             show_annotation_name = FALSE, simple_anno_size = unit(2,"mm"),
                             annotation_legend_param = list(Cluster = list(order = 2,
                               title = "Cluster", title_gp = gpar(fontsize=10, face="bold", fontfamily = font_family),
                               labels_gp = gpar(fontsize=9, fontfamily = font_family),
                               grid_height = unit(3,"mm"), grid_width = unit(3,"mm"),
                               at = cl_levels, labels = cl_levels))) else NULL

  # 基因名:italic bold
  gene_labels_expr <- lapply(rownames(mat), function(x) bquote(bolditalic(.(x))))
  # 列标签:组名(同组只显示一次);颜色按所属组着色
  col_labels_grp <- as.character(display_groups)
  col_labels_grp[duplicated(col_labels_grp)] <- ""

  ht <- Heatmap(mat, name = "Z-score", col = col_fun,
                heatmap_legend_param = if (show_sh_legend) list(title = "Z-score", at = z_at_sh,
                                             legend_height = unit(4,"cm"),
                                             title_gp = gpar(fontsize=10, fontfamily = font_family),
                                             labels_gp = gpar(fontsize=9, fontfamily = font_family), order = 3) else list(show = FALSE),
                cluster_rows = FALSE, cluster_columns = FALSE,
                row_split = if (!is.null(ha_row_cl)) row_split_v else NULL, row_gap = unit(1,"mm"), row_title = NULL,
                show_row_names = show_gene_names, row_names_side = "left",
                row_names_gp = gpar(fontsize = 6, col = "black", fontfamily = font_family),
                row_names_rot = 0,
                row_labels = if (show_gene_names) as.expression(gene_labels_expr) else NULL,
                show_column_names = show_group_names, column_names_side = "top",
                column_names_centered = TRUE, column_names_rot = gene_rot,
                column_names_gp = gpar(fontsize = 9, fontface = "bold",
                                       col = gcols[as.character(display_groups)], fontfamily = font_family),
                column_labels = if (show_group_names) col_labels_grp else NULL,
                right_annotation = ha_row_cl,
                top_annotation = if (show_sh_legend || show_group_names) ha_col_grp else NULL,
                border = NA, rect_gp = gpar(col = "white", lwd = 0.5))

  # 竖向尺寸:窄而高(基因纵向排列)
  sz <- get_size("select_heatmap", sh_opt, n_genes = length(gene_order), n_samples = ncol(mat))
  save_plot(function() {
    draw(ht, merge_legends = TRUE,
         heatmap_legend_side = sh_legend_side,
         annotation_legend_side = sh_legend_side)
  }, "heatmap_selected_genes", width = sz$w, height = sz$h)
  message("[OK] heatmap_selected_genes 已生成")
}

# ═══════════════════════════════════════════════════════════════════════════
# Step 4: 火山图(搬 old/5.volcano_QC.R,遍历 comparisons,正方形可选)
# ═══════════════════════════════════════════════════════════════════════════
run_volcano <- function(deg_env) {
  if (!("volcano" %in% steps)) return(invisible(NULL))
  message("\n========== Step 4: 火山图 ==========")
  o <- po$volcano
  vtop <- as.numeric(o$top_n %||% top_n_label)
  vlabel_size <- as.numeric(o$label_size %||% 2)
  show_th <- isTRUE(o$show_threshold_lines %||% TRUE)  # old/5: 默认画阈值虚线
  pt_alpha <- as.numeric(o$point_alpha %||% 0.6)
  pt_size  <- as.numeric(o$point_size %||% 1.5)
  pt_shape <- as.numeric(o$point_shape %||% 19)
  # 颜色:支持自定义或调色板
  up_col   <- o$up_color %||% "#E41A1C"
  down_col <- o$down_color %||% "#377EB8"
  ns_col   <- o$ns_color %||% "grey70"
  # 标注策略(old/: top_n,上下调均标)
  label_strategy <- o$label_strategy %||% "top_n"
  label_up <- isTRUE(o$label_up_only %||% TRUE)
  label_down <- isTRUE(o$label_down_only %||% TRUE)

  for (cmp in plot_comparisons("volcano")) {
    cname <- paste0(cmp[1], "_vs_", cmp[2])
    safe  <- gsub("[^a-zA-Z0-9_-]", "_", cname)
    res_df <- deg_env$results_list[[cname]]
    if (is.null(res_df)) { message("[WARN] 跳过(无结果):", cname); next }
    message("绘制火山图:", cname, " (", nrow(res_df), " 基因)")
    n_genes <- nrow(res_df)

    plot_data <- res_df %>%
      filter(!is.na(padj), !is.na(log2FoldChange)) %>%
      mutate(
        plot_padj_raw = ifelse(padj == 0, .Machine$double.xmin, padj),
        plot_padj = if (pvalue_cap > 0) pmax(plot_padj_raw, pvalue_cap) else plot_padj_raw,
        logP = -log10(plot_padj),
        significance = case_when(
          regulation == "up"   ~ "Up-regulated",
          regulation == "down" ~ "Down-regulated",
          TRUE ~ "Not significant"
        ),
        # 标注策略:top_n(显著 top-N,old/) / marker(标记基因) / both(并集) / none
        is_labeled = case_when(
          label_strategy == "none" ~ FALSE,
          label_strategy == "marker" ~ GeneSymbol %in% marker_genes,
          label_strategy == "both" ~ (significance != "Not significant" & rank(-logP) <= vtop) | (GeneSymbol %in% marker_genes),
          TRUE ~ significance != "Not significant" & rank(-logP) <= vtop  # top_n(默认)
        ),
        # 上下调分别控制是否标注
        is_labeled = is_labeled & (significance != "Up-regulated"   | label_up) &
                                  (significance != "Down-regulated" | label_down),
        label = ifelse(is_labeled, GeneSymbol, "")
      )

    up_n   <- sum(plot_data$significance == "Up-regulated",   na.rm = TRUE)
    down_n <- sum(plot_data$significance == "Down-regulated", na.rm = TRUE)
    subtitle_text <- paste0("Up: ", up_n, ", Down: ", down_n,
                            " | padj<", fdr_th, ", |log2FC|>", log2fc_th)
    y_max   <- max(plot_data$logP, na.rm = TRUE)
    y_limit <- y_max * 1.15

    sz <- get_size("volcano", o, n_genes = n_genes)
    volcano <- ggplot(plot_data, aes(x = log2FoldChange, y = logP)) +
      geom_point(aes(color = significance), alpha = pt_alpha, size = pt_size, shape = pt_shape) +
      scale_color_manual(values = c("Up-regulated"=up_col, "Down-regulated"=down_col, "Not significant"=ns_col))
    if (show_th)
      volcano <- volcano +
        geom_vline(xintercept = c(-log2fc_th, log2fc_th), linetype = "dashed", color = "grey40") +
        geom_hline(yintercept = -log10(fdr_th), linetype = "dashed", color = "grey40")

    lab_list <- list(color = "Regulation")
    tt <- o$title %||% ""
    if (isTRUE(o$show_title %||% TRUE)) lab_list$title <- if (nchar(tt) > 0) tt else cname
    if (isTRUE(o$show_subtitle %||% TRUE)) lab_list$subtitle <- subtitle_text
    if (isTRUE(o$show_xlab %||% TRUE)) lab_list$x <- o$xlab %||% "log2 Fold Change"
    if (isTRUE(o$show_ylab %||% TRUE)) lab_list$y <- o$ylab %||% "-log10 Adjusted P-value"

    yl <- o$ylim
    yl_ok <- !is.null(yl) && length(yl) >= 2 && !any(is.na(as.numeric(yl[1:2])))
    volcano <- volcano +
      coord_cartesian(ylim = if (yl_ok) c(as.numeric(yl[1]), as.numeric(yl[2])) else c(0, y_limit)) +
      scale_y_continuous(expand = expansion(mult = c(0, 0.05))) +
      do.call(labs, lab_list) +
      build_theme(o)

    if (sum(plot_data$is_labeled) > 0) {
      volcano <- volcano +
        geom_text_repel(data = subset(plot_data, is_labeled), aes(label = label),
          size = vlabel_size, box.padding = 0.4, point.padding = 0.3,
          segment.color = "black", segment.size = 0.5, segment.alpha = 0.6,
          max.overlaps = 30, min.segment.length = 0,
          arrow = arrow(length = unit(0.01, "npc")), force = 2, force_pull = 1)
    }
    save_ggplot(volcano, paste0("volcano_", safe), width = sz$w, height = sz$h)
    message("  Up=", up_n, ", Down=", down_n, " → volcano_", safe)
  }
}

# ═══════════════════════════════════════════════════════════════════════════
# Step 5: 新增图 — MA / 箱线 / DEG柱 / Top基因 / 树状图
# ═══════════════════════════════════════════════════════════════════════════
run_extra_plots <- function(deg_env) {
  norm_mat <- deg_env$norm_mat
  results_list <- deg_env$results_list

  # ─── MA 图(每比较,全量参数)────────────────────────────────────────────────
  if ("ma" %in% steps) {
    message("\n绘制 MA 图...")
    o <- po$ma
    pt_sz <- as.numeric(o$point_size %||% 1.5)
    pt_alpha <- as.numeric(o$point_alpha %||% 0.5)
    pt_shape <- as.numeric(o$point_shape %||% 19)
    up_col <- o$up_color %||% "#E41A1C"; down_col <- o$down_color %||% "#377EB8"; ns_col <- o$ns_color %||% "grey70"
    ma_cnames <- plot_cnames("ma")
    ma_cnames <- intersect(ma_cnames, names(results_list))
    for (nm in ma_cnames) {
      res_df <- results_list[[nm]]
      safe <- gsub("[^a-zA-Z0-9_-]", "_", nm)
      pd <- res_df %>% filter(!is.na(log2FoldChange), !is.na(baseMean)) %>%
        mutate(A = log2(baseMean + 1),
               significance = case_when(regulation=="up"~"Up", regulation=="down"~"Down", TRUE~"NS"))
      sz <- get_size("ma", o, n_genes = nrow(pd))
      pma <- ggplot(pd, aes(A, log2FoldChange, color = significance)) +
        geom_point(alpha = pt_alpha, size = pt_sz, shape = pt_shape) +
        scale_color_manual(values = c("Up"=up_col,"Down"=down_col,"NS"=ns_col))
      if (isTRUE(o$show_threshold_line %||% TRUE))
        pma <- pma + geom_hline(yintercept = 0, color = "grey40", linetype = "dashed")
      # LOESS 趋势线(DESeq2 plotMA 标配;old/ 无,默认关闭)
      if (isTRUE(o$show_loess %||% FALSE))
        pma <- pma + geom_smooth(method = "loess", se = FALSE, color = "grey30",
                                 linewidth = 0.5, formula = y ~ x)
      lab_list <- list(color = "")
      if (isTRUE(o$show_title %||% TRUE)) lab_list$title <- paste0("MA: ", nm)
      if (isTRUE(o$show_xlab %||% TRUE))  lab_list$x <- o$xlab %||% "log2(mean expression + 1)"
      if (isTRUE(o$show_ylab %||% TRUE))  lab_list$y <- o$ylab %||% "log2 Fold Change"
      pma <- pma + do.call(labs, lab_list) + build_theme(o)
      save_ggplot(pma, paste0("ma_", safe), width = sz$w, height = sz$h)
    }
    message("[OK] MA 图已生成")
  }

  # ─── 表达分布箱线图(全量参数)──────────────────────────────────────────────
  if ("boxplot" %in% steps) {
    message("绘制表达分布箱线图...")
    o <- po$boxplot
    box_groups <- plot_groups("boxplot")
    sample_order <- names(sample_to_group)[names(sample_to_group) %in% colnames(norm_mat) &
                                           sample_to_group %in% box_groups]
    long_df <- do.call(rbind, lapply(sample_order, function(s) {
      data.frame(Sample = s, Group = sample_to_group[s],
                 log2expr = norm_mat[, s], stringsAsFactors = FALSE)
    }))
    long_df$Sample <- factor(long_df$Sample, levels = sample_order)
    long_df$Group <- factor(long_df$Group, levels = group_order)
    glv <- unique(as.character(long_df$Group))
    pal_name <- o$color_palette %||% "category10_d3"
    gcols <- setNames(get_palette(pal_name, length(glv)), glv)
    sz <- get_size("boxplot", o, n_samples = length(sample_order))
    x_ang <- as.numeric(o$x_text_angle %||% 45)
    pb <- ggplot(long_df, aes(Sample, log2expr, fill = Group)) +
      geom_boxplot(outlier.size = as.numeric(o$outlier_size %||% 0.3),
                   linewidth = as.numeric(o$box_line_width %||% 0.3),
                   alpha = as.numeric(o$box_alpha %||% 0.8)) +
      scale_fill_manual(values = gcols)
    lab_list <- list(fill = o$legend_title %||% "Group")
    if (isTRUE(o$show_title %||% TRUE)) lab_list$title <- o$title %||% "Expression Distribution"
    if (isTRUE(o$show_xlab %||% TRUE))  lab_list$x <- o$xlab %||% "Sample"
    if (isTRUE(o$show_ylab %||% TRUE))  lab_list$y <- o$ylab %||% "Expression (log2)"
    pb <- pb + do.call(labs, lab_list) + build_theme(o) +
      theme(axis.text.x = element_text(angle = x_ang, hjust = if(x_ang>0) 1 else 0.5))
    save_ggplot(pb, "expression_boxplot", width = sz$w, height = sz$h)
    message("[OK] expression_boxplot 已生成")
  }

  # ─── DEG 统计柱状图(全量参数)──────────────────────────────────────────────
  if ("deg_bar" %in% steps) {
    message("绘制 DEG 统计柱状图...")
    o <- po$deg_bar
    db_cnames <- intersect(plot_cnames("deg_bar"), names(results_list))
    n_cmp <- length(db_cnames)
    stat_df <- bind_rows(lapply(db_cnames, function(nm) {
      r <- results_list[[nm]]
      data.frame(Comparison = nm, Up = sum(r$regulation == "up"), Down = sum(r$regulation == "down"))
    }))
    long_stat <- stat_df %>% tidyr::pivot_longer(c(Up, Down), names_to = "Direction", values_to = "Count")
    long_stat$Comparison <- factor(long_stat$Comparison, levels = stat_df$Comparison)
    bar_pos <- o$bar_position %||% "stack"
    up_col <- o$up_color %||% "#E41A1C"; down_col <- o$down_color %||% "#377EB8"
    sz <- get_size("deg_bar", o, n_comparisons = n_cmp)
    x_ang <- as.numeric(o$x_text_angle %||% 30)
    pbar <- ggplot(long_stat, aes(Comparison, Count, fill = Direction)) +
      geom_col(position = bar_pos, width = as.numeric(o$bar_width %||% 0.7)) +
      scale_fill_manual(values = c("Up"=up_col,"Down"=down_col))
    if (isTRUE(o$show_values %||% FALSE))
      pbar <- pbar + geom_text(aes(label = Count),
        position = if (bar_pos=="stack") position_stack(vjust=0.5) else position_dodge(width=0.9), size = 3)
    lab_list <- list(fill = o$legend_title %||% "Direction")
    if (isTRUE(o$show_title %||% TRUE)) lab_list$title <- o$title %||% "DEG Counts per Comparison"
    if (isTRUE(o$show_xlab %||% FALSE)) lab_list$x <- o$xlab %||% ""
    if (isTRUE(o$show_ylab %||% TRUE))  lab_list$y <- o$ylab %||% "Number of DEGs"
    pbar <- pbar + do.call(labs, lab_list) + build_theme(o) +
      theme(axis.text.x = element_text(angle = x_ang, hjust = if(x_ang>0) 1 else 0.5))
    save_ggplot(pbar, "deg_barplot", width = sz$w, height = sz$h)
    message("[OK] deg_barplot 已生成")
  }

  # ─── Top 基因条形图(每比较,全量参数)──────────────────────────────────────
  if ("top_genes" %in% steps) {
    message("绘制 Top 基因条形图...")
    o <- po$top_genes
    tn <- as.numeric(o$n %||% 20)
    up_col <- o$up_color %||% "#E41A1C"; down_col <- o$down_color %||% "#377EB8"
    gene_italic <- isTRUE(o$gene_italic %||% TRUE)
    tg_cnames <- intersect(plot_cnames("top_genes"), names(results_list))
    for (nm in tg_cnames) {
      res_df <- results_list[[nm]]
      safe <- gsub("[^a-zA-Z0-9_-]", "_", nm)
      top <- res_df %>% filter(!is.na(padj)) %>% arrange(padj) %>% head(tn) %>%
        mutate(GeneSymbol = factor(GeneSymbol, levels = rev(GeneSymbol)),
               Direction = ifelse(log2FoldChange > 0, "Up", "Down"))
      if (nrow(top) == 0) next
      sz <- get_size("top_genes", o, n_genes = nrow(top))
      ptg <- ggplot(top, aes(log2FoldChange, GeneSymbol, fill = Direction)) +
        geom_col(width = as.numeric(o$bar_width %||% 0.7)) +
        scale_fill_manual(values = c("Up"=up_col,"Down"=down_col))
      if (isTRUE(o$show_threshold_line %||% TRUE))
        ptg <- ptg + geom_vline(xintercept = 0, color = "grey40")
      lab_list <- list(fill = o$legend_title %||% "Direction")
      if (isTRUE(o$show_title %||% TRUE)) lab_list$title <- paste0("Top ", tn, " genes: ", nm)
      if (isTRUE(o$show_xlab %||% TRUE))  lab_list$x <- o$xlab %||% "log2 Fold Change"
      if (isTRUE(o$show_ylab %||% TRUE))  lab_list$y <- o$ylab %||% ""
      ptg <- ptg + do.call(labs, lab_list) + build_theme(o)
      if (gene_italic)
        ptg <- ptg + theme(axis.text.y = element_text(face = "italic"))
      save_ggplot(ptg, paste0("top_genes_", safe), width = sz$w, height = sz$h)
    }
    message("[OK] Top 基因图已生成")
  }

  # ─── 样本相关性树状图(全量参数)────────────────────────────────────────────
  if ("dendrogram" %in% steps) {
    message("绘制样本聚类树状图...")
    o <- po$dendrogram
    dend_groups <- plot_groups("dendrogram")
    sample_order <- names(sample_to_group)[names(sample_to_group) %in% colnames(norm_mat) &
                                           sample_to_group %in% dend_groups]
    n_samp <- length(sample_order)
    cor_mat <- cor(norm_mat[, sample_order, drop = FALSE], method = "pearson")
    dist_mat <- as.dist(1 - cor_mat)
    hc <- hclust(dist_mat, method = o$method %||% "ward.D2")
    dend <- as.dendrogram(hc)
    glv <- unique(sample_to_group[sample_order])
    pal_name <- o$color_palette %||% "category10_d3"
    gcols <- setNames(get_palette(pal_name, length(glv)), glv)
    leaf_cols <- gcols[sample_to_group[labels(dend)]]
    has_dendextend <- requireNamespace("dendextend", quietly = TRUE)
    label_cex <- as.numeric(o$label_cex %||% 0.8)
    hang <- as.numeric(o$hang %||% -1)
    sz <- get_size("dendrogram", o, n_samples = n_samp)
    main_t <- if (isTRUE(o$show_title %||% TRUE)) (o$title %||% "Sample Clustering Dendrogram") else ""
    xlab_t <- if (isTRUE(o$show_xlab %||% FALSE)) (o$xlab %||% "") else ""
    ylab_t <- if (isTRUE(o$show_ylab %||% TRUE)) (o$ylab %||% "Distance (1 - Pearson r)") else ""
    save_plot(function() {
      par(mar = c(7, 4, 3, 2))
      if (has_dendextend) {
        dend2 <- dendextend::set(dend, "labels_colors", value = leaf_cols)
        dend2 <- dendextend::set(dend2, "labels_cex", label_cex)
        plot(dend2, main = main_t, xlab = xlab_t, sub = "", ylab = ylab_t, hang = hang,
             cex.axis = as.numeric(o$cex_axis %||% 1))
      } else {
        plot(dend, main = main_t, xlab = xlab_t, sub = "", ylab = ylab_t, hang = hang,
             cex = label_cex, cex.axis = as.numeric(o$cex_axis %||% 1))
      }
    }, "sample_dendrogram", width = sz$w, height = sz$h)
    message("[OK] sample_dendrogram 已生成")
  }

  # ─── 单基因表达小提琴图(全量参数)──────────────────────────────────────────
  if ("violin" %in% steps) {
    message("绘制单基因小提琴图...")
    o <- po$violin
    # 取指定基因(空=用 marker_genes)
    genes_to_plot <- o$genes
    if (is.null(genes_to_plot) || length(genes_to_plot) == 0)
      genes_to_plot <- marker_genes
    genes_to_plot <- intersect(genes_to_plot, rownames(norm_mat))
    if (length(genes_to_plot) == 0) {
      message("[WARN] 无有效基因,跳过小提琴图")
    } else {
      message("  绘制 ", length(genes_to_plot), " 个基因")
      viol_groups <- plot_groups("violin")
      sample_order <- names(sample_to_group)[names(sample_to_group) %in% colnames(norm_mat) &
                                             sample_to_group %in% viol_groups]
      long_df <- do.call(rbind, lapply(genes_to_plot, function(g) {
        data.frame(Gene = g, Sample = sample_order,
                   Group = sample_to_group[sample_order],
                   expr = norm_mat[g, sample_order], stringsAsFactors = FALSE)
      }))
      long_df$Group <- factor(long_df$Group, levels = group_order)
      long_df$Gene <- factor(long_df$Gene, levels = genes_to_plot)
      glv <- unique(as.character(long_df$Group))
      pal_name <- o$color_palette %||% "category10_d3"
      gcols <- setNames(get_palette(pal_name, length(glv)), glv)
      sz <- get_size("violin", o, n_genes = length(genes_to_plot), n_samples = length(sample_order))
      pv <- ggplot(long_df, aes(Group, expr, fill = Group)) +
        geom_violin(alpha = as.numeric(o$violin_alpha %||% 0.6), linewidth = 0.3) +
        geom_jitter(width = 0.15, size = 0.6, alpha = 0.5) +
        scale_fill_manual(values = gcols) +
        facet_wrap(~Gene, scales = "free_y", ncol = as.integer(o$ncol %||% 4))
      lab_list <- list(fill = o$legend_title %||% "Group")
      if (isTRUE(o$show_title %||% TRUE)) lab_list$title <- o$title %||% "Gene Expression (violin)"
      if (isTRUE(o$show_xlab %||% TRUE))  lab_list$x <- o$xlab %||% "Group"
      if (isTRUE(o$show_ylab %||% TRUE))  lab_list$y <- o$ylab %||% "Expression (log2)"
      pv <- pv + do.call(labs, lab_list) + build_theme(o)
      save_ggplot(pv, "violin", width = sz$w, height = sz$h)
      message("[OK] violin 已生成")
    }
  }

  # ─── 表达密度图(全量参数)────────────────────────────────────────────────────
  if ("density" %in% steps) {
    message("绘制表达密度图...")
    o <- po$density
    by_var <- o$by %||% "group"
    dens_groups <- plot_groups("density")
    sample_order <- names(sample_to_group)[names(sample_to_group) %in% colnames(norm_mat) &
                                           sample_to_group %in% dens_groups]
    long_df <- do.call(rbind, lapply(sample_order, function(s) {
      data.frame(Sample = s, Group = sample_to_group[s],
                 expr = norm_mat[, s], stringsAsFactors = FALSE)
    }))
    if (by_var == "sample") {
      long_df$FillVar <- long_df$Sample
    } else {
      long_df$FillVar <- long_df$Group
    }
    long_df$FillVar <- factor(long_df$FillVar)
    flevels <- levels(long_df$FillVar)
    pal_name <- o$color_palette %||% "category10_d3"
    fcols <- setNames(get_palette(pal_name, length(flevels)), flevels)
    sz <- get_size("density", o, n_samples = length(sample_order))
    pd <- ggplot(long_df, aes(expr, fill = FillVar)) +
      geom_density(alpha = as.numeric(o$alpha %||% 0.4), linewidth = 0.4) +
      scale_fill_manual(values = fcols)
    lab_list <- list(fill = if (by_var == "sample") "Sample" else "Group")
    if (isTRUE(o$show_title %||% TRUE)) lab_list$title <- o$title %||% "Expression density"
    if (isTRUE(o$show_xlab %||% TRUE))  lab_list$x <- o$xlab %||% "Expression (log2)"
    if (isTRUE(o$show_ylab %||% TRUE))  lab_list$y <- o$ylab %||% "density"
    pd <- pd + do.call(labs, lab_list) + build_theme(o)
    save_ggplot(pd, "density", width = sz$w, height = sz$h)
    message("[OK] Density 已生成")
  }
}

# ═══════════════════════════════════════════════════════════════════════════
# 主流程
# ═══════════════════════════════════════════════════════════════════════════

# source 富集分析模块(需要时才加载,包检查在各函数内)
# 解析顺序:工作目录 r/modules → 脚本自身所在目录的 modules(runner.R 同级) → params.json 同级 r/modules
modules_dir <- "r/modules"
if (!dir.exists(modules_dir)) {
  ca <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)
  script_dir <- if (length(ca) > 0) dirname(normalizePath(sub("^--file=", "", ca[1]), mustWork = FALSE)) else getwd()
  modules_dir <- file.path(script_dir, "modules")
  if (!dir.exists(modules_dir)) {
    modules_dir <- file.path(dirname(normalizePath(params_file, mustWork = FALSE)), "r", "modules")
  }
}
for (mod in c("enrich.R", "gsea.R")) {
  mod_path <- file.path(modules_dir, mod)
  if (file.exists(mod_path)) {
    source(mod_path)
  } else {
    message("[WARN] 未找到富集模块文件:", mod_path, "(enrich/gsea 将被跳过)")
  }
}
message("\n============================================================")
message("[runner] 启动分析 | run_name=", run_name)
message("[runner] 输出目录: ", output_dir)
message("[runner] 步骤: ", paste(steps, collapse=", "))
message("[runner] 图格式: ", paste(plot_formats, collapse=", "))
if (preview_mode) message("[runner] preview_mode=TRUE dpi=", plot_dpi)
message("============================================================\n")

load_deg_from_excel <- function() {
  if (!file.exists(excel_file)) {
    stop(paste0("无法导出本图:未找到 DEG 缓存 Excel。\n",
                "单图导出依赖先运行过完整 DEG 分析。\n",
                "请先在『分析』页执行完整流程(含 DEG 步骤),再导出本图。\n",
                "期望路径: ", excel_file))
  }
  ensure_pkgs("openxlsx")
  message("[runner] 从 Excel 读取 DEG 缓存...")
  norm_full <- read.xlsx(excel_file, sheet = sheet_normalized, rowNames = TRUE)
  sheets <- getSheetNames(excel_file)
  results_list <- list()
  for (cmp in comparisons) {
    cname <- paste0(cmp[1], "_vs_", cmp[2])
    safe <- gsub("[^a-zA-Z0-9_-]", "_", cname)
    sall <- paste0(safe, "_All")
    if (sall %in% sheets) results_list[[cname]] <- read.xlsx(excel_file, sheet = sall)
  }
  cand_df <- if (sheet_candidates %in% sheets) read.xlsx(excel_file, sheet = sheet_candidates) else data.frame()
  list(norm_mat = as.matrix(norm_full), results_list = results_list,
       cand_df = cand_df, mode_flag = "from_excel", is_single = NA)
}

load_deg_from_rds <- function() {
  message("[runner] 从 RDS 快速加载 DEG 缓存...")
  t0 <- proc.time()[["elapsed"]]
  obj <- readRDS(deg_cache_rds)
  if (is.null(obj$norm_mat) || is.null(obj$results_list)) {
    stop("deg_cache.rds 结构无效,将回退 Excel")
  }
  dt <- round(proc.time()[["elapsed"]] - t0, 2)
  message(sprintf("[runner] RDS 加载完成 (%.2fs) mode=%s", dt, obj$mode_flag %||% "?"))
  list(
    norm_mat = obj$norm_mat,
    results_list = obj$results_list,
    cand_df = if (!is.null(obj$cand_df)) obj$cand_df else data.frame(),
    mode_flag = obj$mode_flag %||% "from_rds",
    is_single = obj$is_single %||% NA,
    is_treat = obj$is_treat %||% NA,
    use_edgeR = obj$use_edgeR %||% NA,
    deg_params = obj$deg_params
  )
}

# 缓存刷新:单图导出复用 DEG 缓存时,若当前阈值与缓存运行时不同,用当前阈值
# 重算 regulation(判定仅依赖 padj / log2FoldChange / baseMean 三列,重算即与
# 全量重跑一致);候选基因表同步重建。TREAT 模式下 log2FC 阈值参与检验本身
# (glmTreat 的 H0 即 |log2FC|<=th),改动后仅重算分类不等同于重新检验,提示重跑。
refresh_deg_cache <- function(deg_env) {
  dp <- deg_env$deg_params
  changed <- character(0)
  cur_cmps <- vapply(comparisons, function(x) paste0(x[1], "_vs_", x[2]), character(1))
  if (is.null(dp)) {
    changed <- c(changed, "缓存无参数指纹(旧版本缓存)")
  } else {
    if (!isTRUE(all.equal(as.numeric(dp$fdr_th %||% NA), as.numeric(fdr_th))))
      changed <- c(changed, sprintf("FDR %s→%s", dp$fdr_th, fdr_th))
    if (!isTRUE(all.equal(as.numeric(dp$log2fc_th %||% NA), as.numeric(log2fc_th))))
      changed <- c(changed, sprintf("log2FC %s→%s", dp$log2fc_th, log2fc_th))
    if (!isTRUE(all.equal(as.numeric(dp$basemean_th %||% NA), as.numeric(basemean_th))))
      changed <- c(changed, sprintf("baseMean %s→%s", dp$basemean_th, basemean_th))
    if (!identical(sort(unlist(dp$comparisons)), sort(cur_cmps)))
      changed <- c(changed, "比较设置已变化(缓存中缺失的比较将跳过)")
    if (!identical(sort(as.character(dp$groups)), sort(as.character(selected_groups))))
      message("[WARN] 分组设置与缓存运行时不同:差异检验结果不会自动重算,",
              "归一化矩阵仍为缓存时纳入的样本;如需完整一致请重跑 DEG")
  }
  if (length(changed) > 0) {
    message("[WARN] DEG 缓存参数与当前配置不一致: ", paste(changed, collapse = "; "))
    if (isTRUE(grepl("edgeR_BCV", deg_env$mode_flag %||% "")) && any(grepl("log2FC", changed)))
      message("[WARN] TREAT 模式的 p 值本身依赖 log2FC 阈值(H0: |log2FC|<=th),",
              "仅重算分类不等同于重新检验,建议重跑 DEG 分析")
    deg_env$results_list <- lapply(deg_env$results_list, classify_regulation)
    deg_env$cand_df <- rebuild_cand_df(deg_env$results_list)
    message("[INFO] 已按当前阈值(fdr=", fdr_th, ", log2FC=", log2fc_th,
            ", baseMean=", basemean_th, ")重算 regulation 与候选基因表")
  }
  deg_env
}

deg_env <- NULL
if ("deg" %in% steps) {
  deg_env <- run_deg()
} else if (file.exists(deg_cache_rds)) {
  # 快路径:二进制缓存(调参重绘优先);加载后按当前参数刷新 regulation
  deg_env <- tryCatch(
    load_deg_from_rds(),
    error = function(e) {
      message("[WARN] RDS 加载失败,回退 Excel: ", conditionMessage(e))
      load_deg_from_excel()
    }
  )
  deg_env <- refresh_deg_cache(deg_env)
  } else {
    # 兼容旧 run:仅有 Excel 时读表,刷新后顺手写 RDS 供下次加速
    deg_env <- load_deg_from_excel()
    deg_env <- refresh_deg_cache(deg_env)
    tryCatch({
      saveRDS(list(
        norm_mat = deg_env$norm_mat,
        results_list = deg_env$results_list,
        cand_df = deg_env$cand_df,
        mode_flag = deg_env$mode_flag %||% "from_excel",
        is_single = deg_env$is_single,
        is_treat = deg_env$is_treat %||% NA,
        use_edgeR = deg_env$use_edgeR,
        deg_params = list(
          fdr_th = fdr_th, log2fc_th = log2fc_th, basemean_th = basemean_th,
          engine = engine, groups = selected_groups,
          comparisons = lapply(comparisons, function(x) paste0(x[1], "_vs_", x[2]))
        ),
        saved_at = as.character(Sys.time())
      ), deg_cache_rds, compress = "gzip")
      message("[OK] 已从 Excel 生成 deg_cache.rds,下次重绘将更快")
    }, error = function(e) {
      message("[WARN] 生成 deg_cache.rds 失败:", conditionMessage(e))
    })
  }

if (!is.null(deg_env)) {
  run_heatmap_pca_venn(deg_env)
  run_select_heatmap()
  run_volcano(deg_env)
  run_extra_plots(deg_env)
  if (exists("run_enrich"))  run_enrich(deg_env)
  if (exists("run_gsea"))   run_gsea(deg_env)
}

message("\n============================================================")
message("[DONE] 全流程完成!输出目录:", normalizePath(output_dir))
message("   Excel :", normalizePath(excel_file))
message("   Plots :", normalizePath(plots_dir))
message("============================================================")
