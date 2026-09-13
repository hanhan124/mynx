# =============================================================================
# runner.R — 发表级 RNA-seq 分析统一入口(参数化,GUI 后端)
# =============================================================================
# 用法:Rscript runner.R <params.json>
#
# 方法论(继承自 old/1.DEG_analysis.R):
#   单重复(任一参与组 <2 个样本)→ edgeR + 固定 BCV(edgeR 用户指南 §2.10)
#   多重复(每组 ≥2 个样本)  → 标准 DESeq2
#
# 作图代码严格对齐 old/ 目录原脚本格式,仅把硬编码参数改为从 JSON 读取。
# 输出:<output_dir>/<run_name>/plots/*.svg (+可选 pdf) + RNAseq_Analysis_Results.xlsx
# =============================================================================

# ─── 0. 读配置 ──────────────────────────────────────────────────────────────
args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 1) stop("用法:Rscript runner.R <params.json>")
params_file <- normalizePath(args[1], mustWork = TRUE)
script_arg <- commandArgs()[grep("^--file=", commandArgs())][1]
script_dir <- if (!is.na(script_arg)) dirname(normalizePath(sub("^--file=", "", script_arg), mustWork = FALSE)) else getwd()

suppressPackageStartupMessages({
  library(jsonlite)
})
source(file.path(script_dir, "modules", "config.R"), local = TRUE)
source(file.path(script_dir, "modules", "io.R"), local = TRUE)
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
comparison_raw <- cfg$comparisons
if (is.null(comparison_raw) || length(comparison_raw) == 0) {
  comparisons <- list()
} else if (is.matrix(comparison_raw) || is.data.frame(comparison_raw)) {
  comparisons <- lapply(seq_len(nrow(comparison_raw)),
                        function(i) as.character(comparison_raw[i, ]))
} else {
  comparisons <- lapply(comparison_raw, as.character)
}
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
filter_min_count <- as.numeric(p$filter_min_count %||% 10)  # 附件基线:最小原始计数
filter_min_samples <- as.integer(p$filter_min_samples %||% 2L) # 附件基线:达到最小计数的样本数
filter_rowsum    <- as.numeric(p$filter_rowsum %||% 0)      # 仅兼容旧配置；0=不追加过滤
# 计数型模型只接受原始整数 counts。默认拒绝小数输入；用户可明确选择
# round（例如上游计数器产生了极少量小数）并在元数据中留下审计记录。
count_rounding   <- tolower(as.character(p$count_rounding %||% "stop")[1])
if (!count_rounding %in% c("stop", "round")) count_rounding <- "stop"
# 富集映射使用的输入 ID 类型；auto 会识别 Ensembl gene ID，其余按 Symbol。
gene_id_type     <- tolower(as.character(p$gene_id_type %||% "auto")[1])
if (!gene_id_type %in% c("auto", "symbol", "ensembl")) gene_id_type <- "auto"
batch_info       <- as.list(cfg$batches)

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
need_qc        <- "qc" %in% steps
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
  # 单独导出样本 QC 时仍需 pheatmap 生成相关性与距离热图。
  if (need_qc) ensure_pkgs("pheatmap")
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
    # 参考发表预设：PCA / MDS 均为 7×6 in
    "pca" = list(w = 7, h = 6),
    "mds" = list(w = 7, h = 6),
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
  if (identical(palette_name, "reference")) {
    return(rep(c("#1F77B4", "#FF7F0E", "#2CA02C", "#D62728", "#9467BD",
                 "#8C564B", "#E377C2", "#7F7F7F", "#BCBD22", "#17BECF"), length.out = n))
  }
  if (identical(palette_name, "Catppuccin Mocha")) {
    return(rep(c("#89B4FA", "#CBA6F7", "#A6E3A1", "#FAB387", "#F38BA8",
                 "#94E2D5", "#F9E2AF", "#B4BEFE", "#74C7EC", "#F5C2E7"), length.out = n))
  }
  # 支持:category10_d3 / npg / jco / nejm / lancet / startrek / simpsons
  # paletteer_d("package::palette", n) 直接返回 n 个颜色向量
  full <- paste0("ggsci::", palette_name)
  tryCatch(
    paletteer_d(full, n),
    error = function(e) paletteer_d("ggsci::category10_d3", n)
  )
}

# ─── 工具:获取热图渐变色(支持 grDevices 连续色阶)──────────────────────────────
# 前端 HEAT_PALETTES 中的 ID 均由 paletteer 的 grDevices 连续色阶提供；
# Magma 由 viridisLite 原生提供。未识别的旧配置仍安全回退至 Blue-Red 2。
get_heat_palette <- function(palette_name = "Blue-Red 2", n = 100) {
  # Catppuccin Mocha 是离散分类色,用于 Cluster 注释,走 get_palette
  if (palette_name == "Catppuccin Mocha") {
    return(get_palette("Catppuccin Mocha", n))
  }
  if (palette_name == "Magma") {
    if (requireNamespace("viridisLite", quietly = TRUE)) return(viridisLite::magma(n))
    warning("Magma 需要 viridisLite；已回退为 Blue-Red 2", call. = FALSE)
    return(paletteer_c("grDevices::Blue-Red 2", n))
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
save_plot <- function(plot_fn, base_name, width, height, required = TRUE) {
  saved_any <- FALSE
  for (fmt in plot_formats) {
    if (!fmt %in% c("svg", "pdf", "png")) next
    f <- file.path(plots_dir, paste0(base_name, ".", fmt))
    # 先写临时文件，绘图失败时不留下零字节/损坏的正式文件。
    tmp <- paste0(f, ".tmp-", Sys.getpid(), "-", sample.int(1e9, 1))
    device_open <- FALSE
    ok <- FALSE
    tryCatch({
      if (fmt == "svg") {
        svglite::svglite(tmp, width = width, height = height)
      } else if (fmt == "pdf") {
        pdf(tmp, width = width, height = height, family = font_family)
      } else {
        grDevices::png(tmp, width = width * plot_dpi, height = height * plot_dpi,
                      res = plot_dpi, family = font_family)
      }
      device_open <- TRUE
      plot_fn()
      dev.off()
      device_open <- FALSE
      if (file.exists(f)) unlink(f)
      ok <- file.rename(tmp, f)
      if (!ok) {
        file.copy(tmp, f, overwrite = TRUE)
        unlink(tmp)
        ok <- file.exists(f)
      }
      if (!ok) stop("无法将临时图文件移动到目标路径")
      saved_any <- TRUE
    }, error = function(e) {
      if (device_open) try(grDevices::dev.off(), silent = TRUE)
      if (file.exists(tmp)) unlink(tmp)
      message(sprintf("[WARN] 写图 %s.%s 失败: %s", base_name, fmt, conditionMessage(e)))
    })
  }
  if (!saved_any && isTRUE(required)) {
    stop("图『", base_name, "』未能写出任何所选格式；请查看上方写图错误。", call. = FALSE)
  }
  invisible(saved_any)
}
# ggplot 对象专用(沿用统一保存器,避免绘图失败留下空文件)
save_ggplot <- function(ggobj, base_name, width, height, required = TRUE) {
  save_plot(function() print(ggobj), base_name, width, height, required = required)
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
      # 不能把无法解析的计数静默视作 0；任何一行含非数值值时保留 NA，
      # 由下面统一输入校验中止分析并报告问题。
      summarise(across(all_of(num_cols), ~ {
        vals <- suppressWarnings(as.numeric(.x))
        if (anyNA(vals)) NA_real_ else sum(vals)
      }), .groups = "drop") %>%
    as.data.frame()
  }
  rownames(countData) <- countData[[gene_col]]
  countData[[gene_col]] <- NULL

  if (ncol(countData) == 0 || nrow(countData) == 0)
    stop("Counts 矩阵为空:请确认第 1 列为基因名,其余列为样本原始整数计数。", call. = FALSE)
  countData[] <- lapply(countData, function(x) suppressWarnings(as.numeric(x)))
  count_matrix <- as.matrix(countData)
  if (anyNA(count_matrix) || any(!is.finite(count_matrix)) || any(count_matrix < 0))
    stop("Counts 矩阵含有非数值、缺失值或负数。RNA-seq 差异分析必须使用非负整数原始计数,不能直接使用 TPM/FPKM。", call. = FALSE)
  fractional <- abs(count_matrix - round(count_matrix)) > 1e-8
  fractional_count_n <- sum(fractional)
  if (any(fractional) && identical(count_rounding, "stop")) {
    stop("Counts 矩阵含有 ", fractional_count_n, " 个小数值。DESeq2/edgeR 的计数模型需要原始整数 counts，",
         "请检查输入是否为 TPM/FPKM、归一化或其他非整数数据；仅在确认是计数器小数舍入误差时，",
         "才可在分析参数中改为『四舍五入并记录』。", call. = FALSE)
  }
  if (any(fractional)) {
    message("[WARN] 检测到 ", fractional_count_n,
            " 个小数 Counts，按用户明确设置四舍五入为整数后进入计数模型；该处理已记录在 Analysis_Meta。")
  }
  countData[] <- lapply(countData, function(x) as.integer(round(x)))

  # 仅保留所选组样本
  selected_samples <- unlist(group_info[selected_groups])
  selected_samples <- selected_samples[selected_samples %in% colnames(countData)]
  missing <- setdiff(unlist(group_info[selected_groups]), colnames(countData))
  if (length(missing) > 0) warning("缺失样本:", paste(missing, collapse = ", "))
  countData_sub <- countData[, selected_samples, drop = FALSE]
  if (length(selected_samples) == 0)
    stop("选定分组没有匹配到输入文件中的样本列,请检查样本名。", call. = FALSE)

  # 与附件流程一致的统一预过滤：至少在 N 个样本中达到最小原始计数。
  # 目标基因/功能簇基因可保留，以支持后续确认性可视化。
  # 表达过滤所需样本数不能高于最小组的生物学重复数。否则单重复设计会
  # 错误地要求基因在两组都表达，从而丢弃只在处理组表达的真正候选基因。
  group_n <- vapply(selected_groups, function(g) sum(group_info[[g]] %in% selected_samples), integer(1))
  min_group_n <- min(group_n[group_n > 0L])
  effective_filter_min_samples <- max(1L, min(as.integer(filter_min_samples), min_group_n))
  if (effective_filter_min_samples != filter_min_samples) {
    message("[INFO] 表达过滤的样本数由 ", filter_min_samples, " 调整为 ",
            effective_filter_min_samples, "（最小组重复数 = ", min_group_n, "）")
  }
  forced_genes <- unique(c(marker_genes, unlist(gene_clusters, use.names = FALSE)))
  prefilter_keep <- rowSums(countData_sub >= filter_min_count) >= effective_filter_min_samples |
    rownames(countData_sub) %in% forced_genes
  countData_sub <- countData_sub[prefilter_keep, , drop = FALSE]
  if (nrow(countData_sub) < 10L)
    stop("统一低表达过滤后基因少于 10 个。请检查 Counts 输入，或下调最小计数/样本数。", call. = FALSE)
  message("统一低表达过滤: >=", filter_min_count, " counts in >=", effective_filter_min_samples,
          " samples；保留 ", nrow(countData_sub), " 个基因")

  # 组名 sanitization:makeContrasts 要求 levels 为合法 R 名称(组名可能含空格/特殊字符)
  # 用 G1/G2... 作内部安全名,建双向映射,结果与日志再换回原名
  safe_levels <- setNames(make.names(selected_groups, unique = TRUE), selected_groups)
  safe_to_orig <- setNames(names(safe_levels), safe_levels)  # 安全名 -> 原名
  comp_safe <- lapply(comparisons, function(cmp) {
    c(safe_levels[[cmp[1]]], safe_levels[[cmp[2]]])
  })
  invalid_comparisons <- which(vapply(comp_safe, function(cmp) {
    length(cmp) != 2L || any(is.na(cmp)) || any(!nzchar(cmp)) || identical(cmp[1], cmp[2])
  }, logical(1)))
  if (length(invalid_comparisons) > 0L) {
    bad <- vapply(comparisons[invalid_comparisons], function(x) paste(x, collapse = " vs "), character(1))
    stop("比较设置包含无效组名或相同组: ", paste(bad, collapse = "; "), call. = FALSE)
  }
  if (length(comp_safe) == 0L)
    stop("至少需要 1 个有效的差异比较后才能运行 RNA-seq 分析。", call. = FALSE)

  # colData(用安全名作 condition)
  actual_groups <- rep(selected_groups, sapply(group_info[selected_groups], function(x)
    sum(x %in% selected_samples)))
  colData <- data.frame(
    row.names = selected_samples,
    condition = factor(safe_levels[actual_groups],
                       levels = as.character(safe_levels[selected_groups]))
  )

  # 批次作为可选协变量；要求所有纳入样本均有且仅有一个批次归属。
  has_batch <- length(batch_info) > 0L
  if (has_batch) {
    b_map <- unlist(lapply(names(batch_info), function(b)
      setNames(rep(make.names(b), length(batch_info[[b]])), batch_info[[b]])))
    if (anyDuplicated(names(b_map)))
      stop("批次设置有误:同一样本被分配到多个批次,请修正后重试。", call. = FALSE)
    missing_b <- setdiff(selected_samples, names(b_map))
    if (length(missing_b) > 0L)
      stop("以下样本已纳入分析但未分配批次: ", paste(missing_b, collapse = ", "),
           "。请在批次设置中为它们分配批次,或清空批次设置。", call. = FALSE)
    colData$batch <- factor(unname(b_map[selected_samples]))
    if (nlevels(colData$batch) < 2L) {
      message("[INFO] 批次设置只有一个水平，不作为协变量使用")
      colData$batch <- NULL
      has_batch <- FALSE
    } else {
      message("批次变量(", nlevels(colData$batch), " 水平): ",
              paste(levels(colData$batch), collapse = ", "),
              " → 设计公式含 batch")
    }
  }

  # ─── 2. 分流判定 ────────────────────────────────────────────────────────
  reps <- table(colData$condition)
  # 每个比较独立判定：只要任一参与组没有生物学重复，就不能当作常规
  # DESeq2/QL 验证性比较，须走固定 BCV 的探索性 edgeR exactTest。
  single_comp_idx <- which(vapply(comp_safe, function(cmp) any(reps[cmp] < 2), logical(1)))
  regular_comp_idx <- setdiff(seq_along(comp_safe), single_comp_idx)
  use_edgeR_single <- length(single_comp_idx) > 0
  use_edger_qlf <- length(regular_comp_idx) > 0 && engine == "edger_qlf"
  use_deseq2 <- length(regular_comp_idx) > 0 && !use_edger_qlf
  single_replicate_warning <- paste0(
    "SINGLE_REPLICATE: P-values approximate (fixed dispersion). ",
    "edgeR exactTest with TMM normalization; formal replication is required for confirmation.",
    if (has_batch) " Batch cannot be estimated or adjusted when a comparison contains a singleton group." else ""
  )
  message("\n样本重复情况:\n"); print(reps)
  message(if (use_edgeR_single) paste0("→ ", length(single_comp_idx), " 个单重复比较: edgeR + 固定 BCV = ", bcv) else "")
  message(if (use_deseq2) paste0("→ ", length(regular_comp_idx), " 个有生物学重复比较: DESeq2 Wald")
          else if (use_edger_qlf) paste0("→ ", length(regular_comp_idx), " 个有生物学重复比较: edgeR QL F-test")
          else "")
  if (use_edgeR_single && has_batch)
    message("[WARN] 含单重复组的比较无法估计或校正批次效应；该比较仅可作为未校正的探索性线索")

  # ─── 3a. edgeR 公共准备 + 两套引擎 ──────────────────────────────────────
  # prep:过滤 + TMM + 设计矩阵 + 归一化矩阵(QL 分支使用；统一预过滤已在前面完成)
  prep_edger <- function() {
    y <- DGEList(counts = countData_sub, group = colData$condition)
    design <- build_design(colData, has_batch)
    # edgeR QL 使用设计感知过滤；附件默认 auto 不进入该可选高级分支。
    keep <- filterByExpr(y, design = design, min.count = filter_min_count)
    y <- y[keep, , keep.lib.sizes = FALSE]
    message("过滤后保留基因:", sum(keep), " / ", length(keep))
    # edgeR ≥3.27.1:calcNormFactors 已更名为 normLibSizes(旧名仍兼容但会 warning)
    if ("normLibSizes" %in% getNamespaceExports("edgeR")) {
      y <- normLibSizes(y, method = "TMM")
    } else {
      y <- calcNormFactors(y, method = "TMM")
    }
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

  # 含单重复组:固定 BCV + exactTest（结果明确标记为探索性）。
  run_edgeR <- function(comp_indexes) {
    message("\n========== edgeR 分析(含单重复组,固定 BCV + exactTest) ==========")
    y_all <- DGEList(counts = countData_sub, group = colData$condition)
    y_all <- if ("normLibSizes" %in% getNamespaceExports("edgeR")) normLibSizes(y_all, method = "TMM") else calcNormFactors(y_all, method = "TMM")
    results_list <- list()
    for (i in comp_indexes) {
      cmp <- comp_safe[[i]]; treat <- cmp[1]; ctrl <- cmp[2]
      orig_treat <- safe_to_orig[[treat]]; orig_ctrl <- safe_to_orig[[ctrl]]
      cname <- paste0(orig_treat, "_vs_", orig_ctrl)
      message("  比较:", cname)
      cmp_idx <- colData$condition %in% c(treat, ctrl)
      y_cmp <- DGEList(counts = countData_sub[, cmp_idx, drop = FALSE],
                       group = factor(colData$condition[cmp_idx], levels = c(ctrl, treat)))
      y_cmp <- if ("normLibSizes" %in% getNamespaceExports("edgeR")) normLibSizes(y_cmp, method = "TMM") else calcNormFactors(y_cmp, method = "TMM")
      et <- exactTest(y_cmp, pair = c(treat, ctrl), dispersion = bcv^2)
      tt <- topTags(et, n = Inf, sort.by = "none")$table
      baseMean_cpm <- rowMeans(cpm(y_cmp, normalized.lib.sizes = TRUE, log = FALSE))
      results_list[[cname]] <- edger_res_df(tt, baseMean_cpm,
        paste0("edgeR_BCV", bcv),
        single_replicate_warning)
    }
    list(norm_mat = cpm(y_all, normalized.lib.sizes = TRUE, log = TRUE, prior.count = 2), results_list = results_list,
         mode_flag = paste0("edgeR_BCV", bcv), is_single = TRUE, is_treat = FALSE)
  }

  # 多重复:edgeR QL F-test(edgeR 官方推荐的重复数据分析方法)
  run_edger_qlf <- function(comp_indexes) {
    message("\n========== edgeR 分析(QL F-test,多重复) ==========")
    e <- prep_edger()
    y <- estimateDisp(e$y, e$design, robust = TRUE)
    message("离散度估计:common BCV = ", signif(y$common.dispersion^0.5, 3))
    fit <- glmQLFit(y, e$design, robust = TRUE)
    results_list <- list()
    for (i in comp_indexes) {
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
  run_deseq2 <- function(comp_indexes) {
    message("\n========== DESeq2 分析 ==========")
    if (has_batch) assert_full_rank(~ batch + condition, colData)
    dds <- DESeqDataSetFromMatrix(countData_sub, colData,
            design = if (has_batch) ~ batch + condition else ~ condition)
    if (filter_rowsum > 0) dds <- dds[rowSums(counts(dds)) >= filter_rowsum, ]
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
    for (i in comp_indexes) {
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
  edge_single_env <- if (use_edgeR_single) run_edgeR(single_comp_idx) else NULL
  edger_qlf_env <- if (use_edger_qlf) run_edger_qlf(regular_comp_idx) else NULL
  deseq2_env <- if (use_deseq2) run_deseq2(regular_comp_idx) else NULL
  result_envs <- Filter(Negate(is.null), list(edge_single_env, edger_qlf_env, deseq2_env))
  results_list <- unlist(lapply(result_envs, `[[`, "results_list"), recursive = FALSE)
  # DESeq2 VST remains the preferred visualization transform whenever it was
  # fitted; single-replicate-only runs retain edgeR TMM log2-CPM.
  norm_mat <- if (!is.null(deseq2_env)) deseq2_env$norm_mat else result_envs[[1]]$norm_mat
  mode_flag <- if (length(result_envs) == 1) result_envs[[1]]$mode_flag else "mixed_by_comparison"
  is_single <- use_edgeR_single
  is_treat <- FALSE
  use_edgeR <- use_edgeR_single || use_edger_qlf

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

  mixed_methods <- use_edgeR && use_deseq2
  package_summary <- if (mixed_methods) "DESeq2 + edgeR (selected per comparison)"
                     else if (use_edgeR) "edgeR" else "DESeq2"
  normalization_summary <- if (mixed_methods) "DESeq2 median-of-ratios (DESeq2 contrasts); TMM (edgeR contrasts)"
                           else if (use_edgeR) "TMM" else "DESeq2 size factors (median ratio)"
  filtering_summary <- paste0("at least ", filter_min_count, " raw counts in ", effective_filter_min_samples,
                              " sample(s)",
                              if (use_edger_qlf) paste0("; edgeR QL filterByExpr(min.count=", filter_min_count, ")") else "",
                              if (filter_rowsum > 0) paste0("; DESeq2 rowSums>=", filter_rowsum) else "")
  pvalue_summary <- if (mixed_methods) "Wald for replicated DESeq2 contrasts; edgeR exactTest with fixed BCV for contrasts containing a singleton group"
                    else if (use_edgeR_single) "edgeR exactTest with fixed BCV (exploratory comparison containing a singleton group)"
                    else if (use_edger_qlf) "QL F-test: H0 log2FC = 0" else "Wald test: H0 log2FC = 0"

  meta_df <- data.frame(
    Parameter = c("Analysis_mode", "R_package", "Engine_setting", "Count_handling", "Rounded_fractional_values", "Input_gene_ID_type", "BCV", "Normalization",
                  "Pre_filtering", "IndependentFiltering", "lfcShrink_method",
                  "log2FC_threshold", "FDR_threshold", "FDR_method",
                  "baseMean_threshold", "Regulation_basis", "baseMean_unit",
                  "P_value_semantics", "Design_formula", "Batch_levels",
                  "N_groups", "N_samples", "N_comparisons",
                  "Normalized_matrix_type", "Single_replicate", "Input_file_md5", "Date"),
    Value = c(mode_flag,
              package_summary,
              engine,
              if (fractional_count_n > 0) "fractional counts rounded to nearest integer before model fitting" else "raw integer counts",
              fractional_count_n,
              gene_id_type,
              if (use_edgeR_single) bcv else if (use_edger_qlf) "estimated (robust)" else "NA (estimated)",
              normalization_summary,
              filtering_summary,
              if (mixed_methods) "Method-specific; see comparison result table"
                else if (use_edgeR) "N/A (edgeR 在过滤后基因集上做 BH)" else "DESeq2 默认独立过滤(IHW 前置)",
              if (mixed_methods) "DESeq2: ashr when available; edgeR: not shrunk"
                else if (use_edger_qlf) "N/A (QLF, logFC 未收缩)"
                else if (use_edgeR_single) "N/A (edgeR exactTest)" else "ashr (contrast); reported as log2FC_shrunk, not used for thresholding",
              log2fc_th, fdr_th, "Benjamini-Hochberg",
              basemean_th,
              "padj < FDR_th & |log2FoldChange| > log2FC_th & baseMean > baseMean_th (unshrunk LFC)",
              if (mixed_methods) "Method-specific: CPM (edgeR) or normalized counts (DESeq2)"
                else if (use_edgeR) "mean CPM (TMM-normalized)" else "mean normalized counts (DESeq2 size factors)",
              pvalue_summary,
              if (has_batch) "~ batch + condition (DESeq2) / ~ 0 + batch + condition (edgeR)" else "~ condition",
              if (has_batch) nlevels(colData$batch) else 0L,
              length(selected_groups), ncol(countData_sub),
              length(comparisons),
              if (!is.null(deseq2_env)) "VST (blind=FALSE)" else "log2-CPM (TMM, prior.count=2)",
              is_single, input_md5, as.character(Sys.Date()))
  )
  addWorksheet(wb, sheet_meta)
  writeData(wb, sheet_meta, meta_df)
  saveWorkbook(wb, excel_file, overwrite = TRUE)
  message("\n[OK] Excel 已保存:", normalizePath(excel_file))

  # 论文/内部审计用的机器可读 QC 摘要。保留单重复流程，但明确其统计语义。
  qc_df <- data.frame(
    Metric = c("analysis_mode", "engine_setting", "n_groups", "n_samples",
               "n_genes_input", "n_genes_tested", "single_replicate",
               "design_formula", "normalization", "filtering", "warning"),
    Value = c(
      mode_flag, engine, length(selected_groups), ncol(countData_sub),
      nrow(countData), nrow(norm_mat), is_single,
      if (has_batch) "~ batch + condition" else "~ condition",
      normalization_summary,
      filtering_summary,
      if (is_single) "Singleton contrasts are exploratory: fixed BCV; P-values are approximate" else ""
    ),
    stringsAsFactors = FALSE
  )
  write.csv(qc_df, file.path(output_dir, "QC_Summary.csv"), row.names = FALSE)
  write.csv(meta_df, file.path(output_dir, "Analysis_Metadata.csv"), row.names = FALSE)
  message("[OK] QC_Summary.csv 与 Analysis_Metadata.csv 已写出")

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

  # 样本相关性热图与矩阵仅在 Step 6(QC) 中生成，避免 DEG 主流程无条件
  # 创建 sample_correlation 空文件，也避免与 run_qc_plots 重复写出。

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
    engine_desc <- if (mixed_methods) {
      paste0("Per-comparison selection: DESeq2 Wald test except for contrasts containing a singleton group, which use ",
             "edgeR exactTest with fixed BCV = ", bcv, " (exploratory only)")
    } else if (use_edgeR_single) {
      paste0("edgeR (comparison containing a singleton group; fixed BCV = ", bcv,
             "; TMM normalization; exactTest — exploratory only)")
    } else if (use_edger_qlf) {
      "edgeR (QL F-test, robust dispersion estimation; TMM normalization)"
    } else {
      "DESeq2 (Wald test; median-of-ratios normalization; ash r-shrunken LFC reported as log2FC_shrunk; regulation judged on unshrunk Wald LFC)"
    }
    design_desc <- if (has_batch) "~ batch + condition (batch as covariate)" else "~ condition (single factor)"  # edgeR 实现为 ~0+batch+condition,等价参数化
    filter_desc <- filtering_summary
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
    engine_pkg <- if (mixed_methods) "DESeq2 and edgeR" else if (use_edgeR) "edgeR" else "DESeq2"
    methods_en <- paste0(
      "Differential expression was analysed with ", engine_pkg, " v", pkg_ver(engine_pkg),
      " in R v", paste(R.version$major, R.version$minor, sep = "."), ". ",
      "Genes were pre-filtered (", filter_desc,
      "); library sizes were normalized by ",
      if (mixed_methods) "the method-specific DESeq2 median-of-ratios or edgeR TMM method"
        else if (use_edgeR) "the TMM method" else "the median-of-ratios method (DESeq2 size factors)",
      ". A negative-binomial generalized linear model was fitted with the design `",
      if (has_batch) "~ batch + condition" else "~ condition",
      "` and per-group contrasts were tested (", engine_desc, "). ",
      if (use_edgeR_single) paste0("Because at least one group had a single replicate, dispersion was fixed at BCV = ", bcv, ". ") else "",
      "P-values were adjusted for multiple testing with the Benjamini-Hochberg procedure; ",
      "genes with adjusted P < ", fdr_th, ", |log2 Fold Change| > ", log2fc_th,
      " (unshrunk estimate) and mean expression > ", basemean_th, " were considered differentially expressed. ",
      "Gene-set enrichment analysis (GSEA) was performed with clusterProfiler v", pkg_ver("clusterProfiler"),
      " on all tested genes ranked by ", if (mixed_methods) "a method-specific test statistic" else if (use_edgeR) "sign(log2FC) x (-log10 P)" else "the Wald statistic",
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
      paste0("- **Gene ID for enrichment**: ", gene_id_type, " (auto detects Ensembl gene IDs; Ensembl version suffixes are removed for mapping)"),
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
  # 仅当 heatmap/pca/mds/venn 任一在 steps 中才执行(避免仅跑 deg 时空跑)
  if (!any(c("heatmap","pca","mds","venn") %in% steps)) {
    return(invisible(NULL))
  }
  message("\n========== Step 2: 热图/PCA/Venn ==========")
  norm_full <- as.data.frame(deg_env$norm_mat)
  cand_df   <- deg_env$cand_df
  hopt <- po$heatmap %||% list()

  # 排除基因
  deg_genes <- unique(cand_df$GeneSymbol)
  deg_genes <- setdiff(deg_genes, excluded_genes)

  # 整体热图:使用其组子集的样本(空=全部 selected)，并按用户设定的组顺序
  # 取样本，保证“首列”与最终热图显示的第一列一致。
  hm_selected_samples <- ordered_samples_by_group("heatmap")
  hm_selected_samples <- hm_selected_samples[hm_selected_samples %in% colnames(norm_full)]

  # 整体热图:可选择使用所有基因(不过滤)或仅候选基因
  # 若无候选基因(如单重复无显著 DEG),自动回退到全基因模式
  use_all <- isTRUE(hopt$use_all_genes)
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
  # 发表热图不应因过多行而失去可读性。与参考流程一致，候选 DEG 超过
  # 2,000 个时按各比较最小 FDR（再按效应量）保留最有信息量的基因。
  hm_max_genes <- suppressWarnings(as.integer(hopt$max_genes %||% 2000))
  if (!use_all && !is.na(hm_max_genes) && hm_max_genes > 0 && nrow(hm_data) > hm_max_genes &&
      all(c("GeneSymbol", "padj", "log2FoldChange") %in% colnames(cand_df))) {
    ranked_genes <- cand_df %>%
      filter(GeneSymbol %in% rownames(hm_data)) %>%
      group_by(GeneSymbol) %>%
      summarise(min_padj = min(padj, na.rm = TRUE), max_lfc = max(abs(log2FoldChange), na.rm = TRUE), .groups = "drop") %>%
      arrange(min_padj, desc(max_lfc)) %>%
      slice_head(n = hm_max_genes) %>% pull(GeneSymbol)
    hm_data <- hm_data[intersect(ranked_genes, rownames(hm_data)), , drop = FALSE]
    message("候选 DEG 超过 ", hm_max_genes, " 个，按最小 FDR 保留 ", nrow(hm_data), " 个基因用于总体热图")
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
  # 聚类方法必须由用户明确选择；绝不能仅因基因数量而静默替换算法，
  # 否则同一分析配置无法被论文方法部分准确复现。
  row_cluster_method <- tolower(as.character(hopt$row_clustering_method %||% "hierarchical")[1])
  if (!row_cluster_method %in% c("hierarchical", "kmeans", "none")) {
    message("[WARN] 未识别的行聚类方法 '", row_cluster_method,
            "'；按层次聚类处理")
    row_cluster_method <- "hierarchical"
  }
  k_clust <- suppressWarnings(as.integer(hopt$k_clusters %||% 3))
  if (is.na(k_clust) || k_clust < 1L) k_clust <- 1L
  k_clust <- min(k_clust, nrow(hm_data))
  scaled <- t(scale(t(hm_data)))
  # 全基因模式常含跨样本方差为 0 的基因；这些行的 Z-score 为 NaN，
  # 聚类前按 0 处理，避免 hclust 失败并在图中以中性色显示。
  scaled[!is.finite(scaled)] <- 0
  # 距离矩阵为 O(n^2)，因此层次聚类有明确的可执行上限。但不自动改用
  # 其他方法：用户须在界面中明确选择 K-means 或不聚类，保证方法可复现。
  cluster_limit <- 5000L
  cluster_method_label <- "不聚类（保留行排序）"
  if (identical(row_cluster_method, "hierarchical") && nrow(hm_data) > cluster_limit) {
    stop("当前整体热图有 ", nrow(hm_data), " 个基因，层次聚类需计算完整距离矩阵，",
         "已超过科学计算安全上限 ", cluster_limit, "。请在『行聚类方法』中明确选择『K-means 分簇』",
         "或『不聚类』；系统不会自动替换算法。", call. = FALSE)
  }
  if (identical(row_cluster_method, "hierarchical") && nrow(hm_data) >= 2L) {
    hc <- hclust(dist(scaled, method = "euclidean"), method = "ward.D2")
    order_genes <- rownames(hm_data)[hc$order]
    base_cl <- cutree(hc, k = k_clust)
    cluster_method_label <- paste0("层次聚类（Euclidean 距离，Ward.D2；k=", k_clust, ")")
  } else if (identical(row_cluster_method, "kmeans") && nrow(hm_data) >= 2L) {
    distinct_profiles <- nrow(unique(scaled))
    k_effective <- min(k_clust, distinct_profiles)
    if (k_effective < 2L) {
      message("K-means：表达谱没有足够差异，归为单一簇")
      order_genes <- rownames(hm_data)
      base_cl <- setNames(rep(1L, nrow(hm_data)), order_genes)
      cluster_method_label <- "K-means（表达谱不足以分为多个簇；k=1）"
    } else {
      set.seed(20260911L)
      km <- kmeans(scaled, centers = k_effective, nstart = 10L, iter.max = 100L)
      base_cl <- km$cluster
      order_genes <- rownames(hm_data)[order(base_cl, -scaled[, 1], na.last = TRUE)]
      cluster_method_label <- paste0("K-means（行 Z-score；k=", k_effective,
                                     "；seed=20260911；nstart=10）")
      message("使用 ", cluster_method_label)
    }
  } else if (identical(row_cluster_method, "hierarchical")) {
    # 单基因热图无需 hclust；保留一个稳定的展示簇。
    order_genes <- rownames(hm_data)
    base_cl <- setNames(1L, order_genes)
    cluster_method_label <- "层次聚类（单基因；k=1）"
  } else if (identical(row_cluster_method, "kmeans")) {
    order_genes <- rownames(hm_data)
    base_cl <- setNames(1L, order_genes)
    cluster_method_label <- "K-means（单基因；k=1）"
  } else {
    # 不聚类时既不创建人工 Cluster，也不显示簇注释或簇图例。
    order_genes <- rownames(hm_data)
    base_cl <- setNames(rep(NA_character_, nrow(hm_data)), order_genes)
  }
  if (identical(row_cluster_method, "none")) {
    cl_df <- data.frame(GeneSymbol = names(base_cl), Original_Cluster = NA_character_,
                        stringsAsFactors = FALSE)
  } else {
    cl_pos <- aggregate(position ~ cluster,
                        data = data.frame(position = seq_along(order_genes),
                                          cluster = base_cl[order_genes]), median) |>
      arrange(position)
    new_lab <- setNames(paste0("Cluster_", seq_len(nrow(cl_pos))),
                        as.character(cl_pos$cluster))
    cl_df <- data.frame(
      GeneSymbol = names(base_cl),
      Original_Cluster = factor(new_lab[as.character(base_cl)],
                               levels = paste0("Cluster_", seq_len(nrow(cl_pos)))),
      stringsAsFactors = FALSE)
  }
  rownames(cl_df) = cl_df$GeneSymbol
  row_order_mode <- hopt$row_order %||% "cluster_first_column_desc"
  if (identical(row_cluster_method, "none") && !row_order_mode %in% c("input", "first_column_desc", "first_column_asc"))
    row_order_mode <- "input"
  final_order <- order_genes
  if (identical(row_order_mode, "first_column_desc")) {
    final_order <- rownames(hm_data)[order(scaled[, 1], decreasing = TRUE, na.last = TRUE)]
  } else if (identical(row_order_mode, "first_column_asc")) {
    final_order <- rownames(hm_data)[order(scaled[, 1], decreasing = FALSE, na.last = TRUE)]
  } else if (!identical(row_cluster_method, "none") && identical(row_order_mode, "cluster_first_column_desc")) {
    cluster_by_gene <- as.character(cl_df[order_genes, "Original_Cluster"])
    cluster_levels <- unique(cluster_by_gene)
    # 簇优先；簇内按热图实际显示的首列 Z-score 从高到低，避免簇内第一行
    # 又出现蓝色。簇的先后也按首列均值从高到低排列。
    cluster_score <- vapply(cluster_levels, function(cl) {
      mean(scaled[order_genes[cluster_by_gene == cl], 1], na.rm = TRUE)
    }, numeric(1))
    cluster_levels <- cluster_levels[order(cluster_score, decreasing = TRUE, na.last = TRUE)]
    # ComplexHeatmap 会按 row_split 因子的 levels 排列分块；同步 levels，
    # 否则即使 final_order 正确，绘图时仍可能把原 Cluster_1 放在最上面。
    cl_df$Original_Cluster <- factor(as.character(cl_df$Original_Cluster), levels = cluster_levels)
    final_order <- unlist(lapply(cluster_levels, function(cl) {
      genes <- order_genes[cluster_by_gene == cl]
      genes[order(scaled[genes, 1], decreasing = TRUE, na.last = TRUE)]
    }), use.names = FALSE)
  }
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
  } else if (!identical(row_cluster_method, "none") && file.exists(manual_cluster_file)) {
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

  cl_df <- cl_df[final_order, , drop = FALSE]
  export_df <- data.frame(GeneSymbol = final_order,
                          Original_Cluster = as.character(cl_df$Original_Cluster),
                          Clustering_Method = cluster_method_label,
                          stringsAsFactors = FALSE)
  write.csv(export_df, file.path(output_dir, "gene_cluster_order.csv"), row.names = FALSE)

  hm_data <- hm_data[final_order, , drop = FALSE]

  # ─── 整体热图(旧 plot_heatmap,作图代码原样)──────────────────────────────
  if ("heatmap" %in% steps) {
    message("绘制整体热图...")
    show_mark <- isTRUE(hopt$show_marker_labels)
    hm_w <- as.numeric(hopt$width %||% 7.5)
    hm_h <- as.numeric(hopt$height %||% 10)
    show_hm_legend <- isTRUE(hopt$show_legend %||% TRUE)
    hm_legend_side <- hopt$legend_position %||% "right"
    show_col_names <- isTRUE(hopt$show_column_names %||% TRUE)
    col_names_rot <- as.numeric(hopt$column_names_rot %||% 0)
    show_row_names <- isTRUE(hopt$show_row_names %||% FALSE)
    row_names_size <- as.numeric(hopt$row_names_size %||% 6)
    col_names_size <- as.numeric(hopt$column_names_size %||% 9)
    marker_label_size <- as.numeric(hopt$marker_label_size %||% 6)
    hm_legend_title_size <- as.numeric(hopt$legend_title_size %||% 10)
    hm_legend_text_size <- as.numeric(hopt$legend_text_size %||% 9)

    # 列(样本)顺序:按用户排列的组顺序(column_group_order)→全局 group_order;
    # 组内样本保持 group_info 定义顺序。允许 per-plot 调整列顺序。
    sample_order <- ordered_samples_by_group("heatmap")
    sample_order <- sample_order[sample_order %in% colnames(hm_data)]
    hm_data_h <- hm_data[, sample_order, drop = FALSE]
    if (ncol(hm_data_h) < 2L)
      stop("整体热图没有至少 2 个有效样本;请检查分组与样本列名。", call. = FALSE)
    # 用户可明确选择矢量输出。大矩阵的内存保护由“跳过行聚类”承担，
    # 不因基因数自动把 PDF/SVG 的热图主体改为栅格。
    hm_use_raster <- isTRUE(hopt$use_raster)
    ann_col <- data.frame(Group = sample_to_group[colnames(hm_data_h)],
                          row.names = colnames(hm_data_h))
    glv <- unique(ann_col$Group)
    gcols <- setNames(paletteer_d("ggsci::category10_d3")[seq_along(glv)], glv)
    # 热图渐变色 + Z-score 范围(old/: Blue-Red 2, ±2)
    heat_palette <- hopt$heatmap_palette %||% "Blue-Red 2"
    z_min <- as.numeric(hopt$zscore_min %||% -2)
    z_max <- as.numeric(hopt$zscore_max %||% 2)
    z_center <- as.numeric(hopt$zscore_center %||% 0)
    # 调色板正中颜色(例如 Blue-Red 2 的白色)可对齐任意 Z 值。
    # 非法的中心值回退为上下限的中点，避免生成非单调的色阶断点。
    if (!is.finite(z_center) || z_center <= z_min || z_center >= z_max)
      z_center <- (z_min + z_max) / 2
    heat_cols <- get_heat_palette(heat_palette, n = 101)
    mat <- t(scale(t(hm_data_h)))
    mat[!is.finite(mat)] <- 0
    z_breaks <- c(seq(z_min, z_center, length.out = 51), seq(z_center, z_max, length.out = 51)[-1])
    col_fun <- colorRamp2(z_breaks, heat_cols)
    # 图例刻度始终包含用户设定的颜色中心。
    z_at <- sort(unique(round(c(seq(z_min, z_max, length.out = 5), z_center), 2)))
    ha_col <- HeatmapAnnotation(Group = ann_col$Group, col = list(Group = gcols),
                                annotation_name_side = "left", show_annotation_name = FALSE,
                                simple_anno_size = unit(2,"mm"),
                                show_legend = show_hm_legend)
    # Cluster 注释只用于显式选择的聚类方法；不聚类时不生成虚假的簇色条或图例。
    show_cl_ann <- !identical(row_cluster_method, "none") && isTRUE(hopt$show_cluster_annotation %||% TRUE)
    show_cl_legend <- show_cl_ann && isTRUE(hopt$show_cluster_legend %||% FALSE)
    ha_row <- NULL
    if (show_cl_ann) {
      cluster_pal <- hopt$cluster_palette %||% "Catppuccin Mocha"
      ann_row <- data.frame(Cluster = cl_df$Original_Cluster, row.names = rownames(hm_data_h))
      ucl <- levels(cl_df$Original_Cluster)
      ccols <- setNames(get_heat_palette(cluster_pal, length(ucl)), ucl)
      ha_row <- rowAnnotation(Cluster = ann_row$Cluster, col = list(Cluster = ccols),
                              annotation_name_side = "top",
                              annotation_name_gp = gpar(fontsize = 0, fontfamily = font_family),
                              simple_anno_size = unit(2,"mm"),
                              show_legend = show_cl_legend)
    }
    ha_mark <- NULL
    if (show_mark) {
      valid <- marker_genes[marker_genes %in% rownames(mat)]
      if (length(valid) > 0)
        ha_mark <- rowAnnotation(mark = anno_mark(at = match(valid, rownames(mat)), labels = valid,
                                 which = "row", side = "left",
                                 labels_gp = gpar(fontsize = marker_label_size, fontface = "bold.italic", fontfamily = font_family),
                                 link_gp = gpar(col = "#333", lwd = 1),
                                 padding = unit(4, "mm"), extend = unit(10, "mm")))
    }
    ht <- Heatmap(mat, name = "Z-score", col = col_fun,
                  heatmap_legend_param = if (show_hm_legend) list(title = "Z-score", at = z_at,
                                              legend_height = unit(3, "cm"),
                                              title_gp = gpar(fontsize = hm_legend_title_size, fontfamily = font_family),
                                              labels_gp = gpar(fontsize = hm_legend_text_size, fontfamily = font_family)) else list(show = FALSE),
                  cluster_rows = FALSE, cluster_columns = FALSE,
                  cluster_row_slices = FALSE, show_row_names = show_row_names,
                  show_column_names = show_col_names,
                  column_labels = if (show_col_names) ann_col$Group else NULL,
                  column_names_rot = col_names_rot,
                  column_names_gp = gpar(fontsize = col_names_size, fontface = "bold", col = "black", fontfamily = font_family),
                  column_names_side = "bottom", column_names_centered = TRUE,
                  row_names_gp = gpar(fontsize = row_names_size, fontfamily = font_family),
                  row_dend_width = unit(0,"mm"), column_dend_height = unit(0,"mm"),
                  left_annotation = ha_mark, right_annotation = ha_row,
                  top_annotation = ha_col, border = NA, rect_gp = gpar(col = NA),
                  row_split = if (!is.null(ha_row)) cl_df$Original_Cluster else NULL, row_title = NULL,
                  row_gap = unit(1, "mm"), use_raster = hm_use_raster)
    save_plot(function() {
      draw(ht, merge_legends = TRUE,
           heatmap_legend_side = hm_legend_side,
           annotation_legend_side = hm_legend_side)
    }, "heatmap", width = hm_w, height = hm_h)
    message("[OK] Heatmap 已生成")
  }
  } # end if ("heatmap" %in% steps) —— 聚类+热图

  # PCA/MDS 均以全基因归一化矩阵(仅排除 excluded_genes)为输入，而非候选 DEG。
  # 独立准备两套矩阵，使单独导出 MDS 时不依赖 PCA 步骤。
  sample_matrix_for <- function(plot_id, label) {
    use_groups <- plot_groups(plot_id)
    use_samples <- unlist(group_info[use_groups])
    use_samples <- use_samples[use_samples %in% colnames(norm_full)]
    dat <- as.matrix(norm_full[setdiff(rownames(norm_full), excluded_genes), use_samples, drop = FALSE])
    if (nrow(dat) == 0) stop(label, " 所需矩阵为空:归一化矩阵无可用基因。")
    if (ncol(dat) < 2) stop(label, " 所需样本数 < 2,无法计算。")
    dat
  }
  pca_data <- if ("pca" %in% steps) sample_matrix_for("pca", "PCA") else NULL
  mds_data <- if ("mds" %in% steps) sample_matrix_for("mds", "MDS") else NULL

  # ─── PCA(正方形,全量参数)──────────────────────────────────────────────────
  if ("pca" %in% steps) {
    message("绘制 PCA...")
    o <- po$pca
    message("PCA 矩阵:", nrow(pca_data), " 基因 x ", ncol(pca_data), " 样本(全基因谱)")
    if (nrow(pca_data) < 2L) {
      message("[WARN] PCA 至少需要 2 个有效基因，已跳过")
    } else {
    sz <- get_size("pca", o, n_samples = ncol(pca_data))
    top_var_genes <- suppressWarnings(as.integer(o$top_var_genes %||% 0))
    if (!is.na(top_var_genes) && top_var_genes >= 2 && nrow(pca_data) > top_var_genes) {
      gene_var <- apply(pca_data, 1, var, na.rm = TRUE)
      keep_genes <- names(sort(gene_var, decreasing = TRUE))[seq_len(top_var_genes)]
      pca_data <- pca_data[keep_genes, , drop = FALSE]
      message("PCA 使用方差最高的 ", nrow(pca_data), " 个基因")
    }
    do_label_repel <- isTRUE(o$label_repel)
    label_text <- o$label_text %||% "group"

    # VST/log2-CPM 默认不再逐基因标准化；用户可显式开启作敏感性分析。
    do_scale <- isTRUE(o$scale_genes %||% FALSE)
    message("PCA scale.=", do_scale)
    # 缓存或异常输入若带非有限值，prcomp 会直接失败。用可读提示中止，
    # 让界面显示真实失败而不是生成空白预览。
    if (any(!is.finite(pca_data)))
      stop("PCA 输入含非有限值；请重新运行 DEG 分析以生成有效的 VST/log2-CPM 缓存。", call. = FALSE)
    pca <- tryCatch(prcomp(t(pca_data), scale. = do_scale), error = function(e) {
      stop("PCA 计算失败: ", conditionMessage(e),
           "。请检查所选样本是否具有表达变异，或重新运行 DEG 分析。", call. = FALSE)
    })
    pca_x <- as.matrix(pca$x)
    pc2 <- if (ncol(pca_x) >= 2L) pca_x[, 2] else rep(0, nrow(pca_x))
    var_total <- sum(pca$sdev^2)
    ve <- if (is.finite(var_total) && var_total > 0) round(100 * pca$sdev^2 / var_total, 2) else rep(0, length(pca$sdev))
    ve <- c(ve, 0)[seq_len(max(2L, length(ve)))]
    df <- data.frame(PC1 = pca_x[,1], PC2 = pc2,
                     Sample = colnames(pca_data),
                     Group = sample_to_group[colnames(pca_data)])
    group_levels <- group_order[group_order %in% unique(as.character(df$Group))]
    group_levels <- c(group_levels, setdiff(unique(as.character(df$Group)), group_levels))
    df$Group <- factor(df$Group, levels = group_levels)
    glv <- levels(df$Group)
    pal_name <- o$color_palette %||% "category10_d3"
    gcols <- setNames(get_palette(pal_name, length(glv)), glv)
    mr <- signif(max(abs(df$PC1), abs(df$PC2)) * 1.12, 2)
    if (!is.finite(mr) || mr <= 0) mr <- 1

    # 色盲友好:默认 color+shape 双编码分组;提供 point_shape 时退回单形状
    shape_by_group <- isTRUE(o$shape_by_group %||% TRUE)
    p <- ggplot(df, aes(PC1, PC2, color = Group))
    if (shape_by_group) p <- ggplot(df, aes(PC1, PC2, color = Group, shape = Group))
    if (isTRUE(o$show_crosshair %||% TRUE))
      p <- p + geom_hline(yintercept = 0, linetype = "dashed", color = "grey60", linewidth = 0.5) +
               geom_vline(xintercept = 0, linetype = "dashed", color = "grey60", linewidth = 0.5)
    p <- p + geom_point(size = as.numeric(o$point_size %||% 4),
                        alpha = as.numeric(o$point_alpha %||% 0.9),
                        shape = if (shape_by_group) NULL else as.numeric(o$point_shape %||% 19))
    if (shape_by_group) {
      gshapes <- c(15:19, 0:9, 21:25, 3:4)  # 前 20 组:实心/空心/三角/圆形
      p <- p + scale_shape_manual(values = gshapes[seq_along(glv)])
    }
    if (label_text != "none") {
      lbl <- if (label_text == "sample") "Sample" else "Group"
      if (do_label_repel) {
        p <- p + geom_text_repel(aes(label = .data[[lbl]]), size = 5, fontface = "bold",
                                 max.overlaps = 30, box.padding = 0.6, segment.color = NA)
      } else {
        p <- p + geom_text(aes(label = .data[[lbl]]), size = 5, fontface = "bold", vjust = -0.8)
      }
    }
    # 各组样本量(审稿要求报告 n)
    n_tab <- table(df$Group)
    n_text <- paste(paste0(glv, " (n=", as.integer(n_tab[glv]), ")"), collapse = ", ")
    lab_list <- list(color = o$legend_title %||% "Group")
    if (shape_by_group) lab_list$shape <- o$legend_title %||% "Group"
    if (isTRUE(o$show_n %||% TRUE)) lab_list$subtitle <- paste0("n: ", n_text)
    if (isTRUE(o$show_xlab %||% TRUE)) lab_list$x <- paste0("PC1 (", ve[1], "%)")
    if (isTRUE(o$show_ylab %||% TRUE)) lab_list$y <- paste0("PC2 (", ve[2], "%)")
    pt <- o$title %||% "PCA Plot"; if (isTRUE(o$show_title %||% TRUE) && nchar(pt) > 0) lab_list$title <- pt
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
  }

  # 用欧氏距离进行 MDS，作为 PCA 的独立样本结构核验。
  if ("mds" %in% steps) {
    message("绘制 MDS...")
    if (ncol(mds_data) < 3) {
      message("[WARN] MDS 需要至少 3 个样本，已跳过")
    } else {
      mo <- po$mds %||% list()
      mds_fit <- cmdscale(dist(t(mds_data)), k = 2)
      mds_df <- data.frame(MDS1 = mds_fit[, 1], MDS2 = mds_fit[, 2],
                           Sample = rownames(mds_fit), Group = sample_to_group[rownames(mds_fit)])
      group_levels <- group_order[group_order %in% unique(as.character(mds_df$Group))]
      group_levels <- c(group_levels, setdiff(unique(as.character(mds_df$Group)), group_levels))
      mds_df$Group <- factor(mds_df$Group, levels = group_levels)
      glv <- levels(mds_df$Group)
      mds_cols <- setNames(get_palette(mo$color_palette %||% "reference", length(glv)), glv)
      mds_plot <- ggplot(mds_df, aes(MDS1, MDS2, color = Group)) +
        geom_point(size = as.numeric(mo$point_size %||% 4), alpha = as.numeric(mo$point_alpha %||% 0.9),
                   shape = as.numeric(mo$point_shape %||% 19)) +
        scale_color_manual(values = mds_cols)
      if (isTRUE(mo$show_crosshair %||% TRUE)) {
        mds_plot <- mds_plot + geom_hline(yintercept = 0, linetype = "dashed", color = "grey60") +
          geom_vline(xintercept = 0, linetype = "dashed", color = "grey60")
      }
      if ((mo$label_text %||% "group") != "none") {
        label_col <- if ((mo$label_text %||% "group") == "sample") "Sample" else "Group"
        if (isTRUE(mo$label_repel)) {
          mds_plot <- mds_plot + geom_text_repel(aes(label = .data[[label_col]]), size = 5, max.overlaps = 30,
                                                  fontface = "bold", segment.color = NA, show.legend = FALSE)
        } else {
          mds_plot <- mds_plot + geom_text(aes(label = .data[[label_col]]), size = 5,
                                            fontface = "bold", vjust = -0.8, show.legend = FALSE)
        }
      }
      mds_limit <- signif(max(abs(mds_df$MDS1), abs(mds_df$MDS2)) * 1.12, 2)
      mx <- mo$xlim; my <- mo$ylim
      mx_ok <- !is.null(mx) && length(mx) >= 2 && !any(is.na(as.numeric(mx[1:2])))
      my_ok <- !is.null(my) && length(my) >= 2 && !any(is.na(as.numeric(my[1:2])))
      mds_labs <- list(color = mo$legend_title %||% "Group")
      if (isTRUE(mo$show_title %||% TRUE) && nzchar(mo$title %||% "MDS Plot"))
        mds_labs$title <- mo$title %||% "MDS Plot"
      if (isTRUE(mo$show_xlab %||% TRUE)) mds_labs$x <- mo$xlab %||% "MDS dimension 1"
      if (isTRUE(mo$show_ylab %||% TRUE)) mds_labs$y <- mo$ylab %||% "MDS dimension 2"
      mds_plot <- mds_plot +
        coord_cartesian(xlim = if (mx_ok) as.numeric(mx[1:2]) else c(-mds_limit, mds_limit),
                        ylim = if (my_ok) as.numeric(my[1:2]) else c(-mds_limit, mds_limit)) +
        do.call(labs, mds_labs) +
        build_theme(modifyList(mo, list(square = mo$square %||% TRUE, title_size = mo$title_size %||% 18,
                                        axis_text_size = mo$axis_text_size %||% 16,
                                        axis_title_size = mo$axis_title_size %||% 18,
                                        legend_title_size = mo$legend_title_size %||% 16,
                                        legend_text_size = mo$legend_text_size %||% 14)))
      mds_sz <- get_size("mds", mo, n_samples = ncol(mds_data))
      save_ggplot(mds_plot, "mds", width = mds_sz$w, height = mds_sz$h)
      write.csv(mds_df, file.path(output_dir, "MDS_coordinates.csv"), row.names = FALSE)
      message("[OK] MDS 已生成")
    }
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
      vo <- po$venn %||% list()
      venn_set_name_size <- as.numeric(vo$set_name_size %||% 3)
      venn_text_size <- as.numeric(vo$text_size %||% 2.5)
      venn_title_size <- as.numeric(vo$title_size %||% 10)
      venn_stroke_size <- as.numeric(vo$stroke_size %||% 0.5)
      venn_stats <- if (isTRUE(vo$show_stats %||% TRUE)) "cp" else "none"
      venn_title <- if (isTRUE(vo$show_title %||% TRUE) && nzchar(vo$title %||% ""))
        vo$title else if (isTRUE(vo$show_title %||% TRUE))
        ifelse(vby=="sample", "Gene Overlap - By Sample", "DEG Overlap - By Comparison") else NULL
      if (length(sets) <= max_sets) {
        pv <- ggvenn(sets, fill_color = vcols, stroke_size = venn_stroke_size,
                     set_name_size = venn_set_name_size, text_size = venn_text_size, show_stats = venn_stats)
        if (!is.null(venn_title)) pv <- pv + ggtitle(venn_title) + theme(plot.title = element_text(hjust = 0.5, size = venn_title_size, face = "bold"))
        save_ggplot(pv, "venn", width = as.numeric(vo$width %||% 5), height = as.numeric(vo$height %||% 5))
        message("[OK] venn 已生成")
      } else {
        for (pair in combn(names(sets), 2, simplify = FALSE)) {
          pn <- paste(gsub(" .*", "", pair), collapse = "_vs_")
          pv <- ggvenn(sets[pair], fill_color = vcols[pair], stroke_size = venn_stroke_size,
                       set_name_size = venn_set_name_size, text_size = venn_text_size, show_stats = venn_stats)
          if (!is.null(venn_title)) pv <- pv + ggtitle(paste("Overlap:", paste(pair, collapse = " vs "))) + theme(plot.title = element_text(hjust = 0.5, size = venn_title_size, face = "bold"))
          save_ggplot(pv, paste0("venn_", pn), width = as.numeric(vo$width %||% 6), height = as.numeric(vo$height %||% 6))
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
run_select_heatmap <- function(deg_env) {
  if (!("select_heatmap" %in% steps)) return(invisible(NULL))
  message("\n========== Step 3: 选定基因热图 ==========")

  # 附件参考严格使用 DEG 结果中的 VST_Normalized 矩阵着色，不能在此处
  # 重新用 edgeR TMM 计算，否则与主流程/附件热图的颜色会不一致。
  norm_full <- as.data.frame(deg_env$norm_mat)
  if (nrow(norm_full) == 0 || ncol(norm_full) == 0)
    stop("选定基因热图缺少 VST/归一化矩阵，请先完成 DEG 分析。", call. = FALSE)

  # 原始 counts 仅用于确认基因确实存在，并为可选的单元格文字提供数值。
  # 按附件 distinct(.keep_all = TRUE) 保留重复基因的第一行。
  raw <- read.csv(data_file, check.names = FALSE, stringsAsFactors = FALSE)
  gene_col <- if ("gene_name" %in% colnames(raw)) "gene_name"
              else if ("gene_id" %in% colnames(raw)) "gene_id" else colnames(raw)[1]
  raw <- raw[!is.na(raw[[gene_col]]) & trimws(as.character(raw[[gene_col]])) != "", , drop = FALSE]
  raw <- raw[!duplicated(raw[[gene_col]]), , drop = FALSE]
  rownames(raw) <- as.character(raw[[gene_col]])
  raw[[gene_col]] <- NULL
  countData_numeric <- raw[, vapply(raw, is.numeric, logical(1)), drop = FALSE]
  if (ncol(countData_numeric) == 0)
    stop("原始 counts 中没有可用的数值样本列。", call. = FALSE)

  # 样本顺序由当前图的组顺序控制，但必须同时存在于 VST 与 counts。
  sel_samples <- ordered_samples_by_group("select_heatmap")
  sel_samples <- sel_samples[sel_samples %in% colnames(norm_full) & sel_samples %in% colnames(countData_numeric)]
  if (length(sel_samples) < 1)
    stop("选定基因热图没有同时存在于 VST 与 counts 的样本列。", call. = FALSE)

  valid_clusters <- lapply(gene_clusters, function(g)
    intersect(g, intersect(rownames(norm_full), rownames(countData_numeric))))
  valid_clusters <- valid_clusters[sapply(valid_clusters, length) > 0]
  gene_order <- unlist(valid_clusters)
  if (length(gene_order) == 0) { message("[WARN] 没有有效基因,跳过选定基因热图"); return(invisible(NULL)) }

  all_marker <- unlist(gene_clusters)
  missing <- setdiff(all_marker, intersect(rownames(norm_full), rownames(countData_numeric)))
  if (length(missing) > 0) message("[WARN] 缺失基因:", paste(missing, collapse=", "))
  message("有效基因:", length(gene_order), " | 功能类别:", length(valid_clusters))

  cluster_vec <- rep(names(valid_clusters), sapply(valid_clusters, length))
  names(cluster_vec) <- gene_order

  # 样本显示名映射 + 按 group_order 排列(group_display 为空时用内部组名)
  sample_to_display <- unlist(lapply(names(group_info), function(g) {
    disp <- group_display[[g]] %||% g
    # 兼容旧配置：用户把 Group_1 重命名后，旧版本可能把占位显示名
    # 一并保留下来；此时应优先显示新的实际组名。
    if (grepl("^Group_[0-9]+$", as.character(disp)) && !grepl("^Group_[0-9]+$", g))
      disp <- g
    setNames(rep(disp, length(group_info[[g]])), group_info[[g]])
  }))
  # 列(样本)顺序:优先 per-plot column_group_order → 全局 group_order;
  # 仅含该图实际用到的组(plot_groups),未列出者补到末尾。
  go_valid <- plot_group_order("select_heatmap")
  desired_samples <- unlist(group_info[go_valid])
  desired_samples <- desired_samples[desired_samples %in% colnames(norm_full)]
  desired_samples <- sel_samples[sel_samples %in% desired_samples]
  if (length(desired_samples) < 1)
    stop("选定基因热图没有可用的样本列。", call. = FALSE)
  hm_data <- norm_full[gene_order, desired_samples, drop = FALSE]
  mat <- t(scale(t(hm_data)))
  mat[!is.finite(mat)] <- 0
  count_display <- as.matrix(countData_numeric[gene_order, desired_samples, drop = FALSE])

  display_groups <- sample_to_display[colnames(mat)]
  # 显示名 factor levels:用 group_display 的值,按 group_order(内部名)顺序
  disp_levels <- unlist(lapply(go_valid, function(g) {
    disp <- group_display[[g]] %||% g
    if (grepl("^Group_[0-9]+$", as.character(disp)) && !grepl("^Group_[0-9]+$", g)) disp <- g
    disp
  }))
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
  z_center_sh <- as.numeric(sh_opt$zscore_center %||% 0)
  if (!is.finite(z_center_sh) || z_center_sh <= z_min_sh || z_center_sh >= z_max_sh)
    z_center_sh <- (z_min_sh + z_max_sh) / 2
  heat_cols <- get_heat_palette(heat_palette_sh, n = 101)
  z_breaks_sh <- c(seq(z_min_sh, z_center_sh, length.out = 51), seq(z_center_sh, z_max_sh, length.out = 51)[-1])
  col_fun <- colorRamp2(z_breaks_sh, heat_cols)
  z_at_sh <- sort(unique(round(c(seq(z_min_sh, z_max_sh, length.out = 5), z_center_sh), 2)))

  # 竖向布局(基因=行/纵向,样本=列/横向;不再转置)
  row_split_v <- factor(cluster_vec[rownames(mat)], levels = names(valid_clusters))

  show_sh_legend <- isTRUE(sh_opt$show_legend %||% TRUE)
  sh_legend_side <- sh_opt$legend_position %||% "right"
  show_gene_names <- isTRUE(sh_opt$show_gene_names %||% TRUE)
  show_group_names <- isTRUE(sh_opt$show_group_names %||% TRUE)
  show_cl_ann_sh <- isTRUE(sh_opt$show_cluster_annotation %||% TRUE)
  show_cl_legend_sh <- isTRUE(sh_opt$show_cluster_legend %||% TRUE)
  gene_rot <- as.numeric(sh_opt$gene_label_rot %||% 0)
  gene_names_size <- as.numeric(sh_opt$gene_names_size %||% 6)
  group_names_size <- as.numeric(sh_opt$group_names_size %||% 8)
  sh_legend_title_size <- as.numeric(sh_opt$legend_title_size %||% 10)
  sh_legend_text_size <- as.numeric(sh_opt$legend_text_size %||% 9)

  # 顶部列注释:Group(样本所属组)
  ann_col_grp <- data.frame(Group = as.character(display_groups),
                            row.names = colnames(mat))
  ha_col_grp <- HeatmapAnnotation(Group = ann_col_grp$Group, col = list(Group = gcols),
                                  show_annotation_name = FALSE, simple_anno_size = unit(2,"mm"),
                                  annotation_legend_param = list(Group = list(order = 1,
                                    title = "Group", title_gp = gpar(fontsize=sh_legend_title_size, face="bold", fontfamily = font_family),
                                    labels_gp = gpar(fontsize=sh_legend_text_size, fontfamily = font_family))))

  # 左侧行注释:Cluster(基因功能簇)—— 可关闭
  ann_row_cl <- data.frame(Cluster = cluster_vec[rownames(mat)], row.names = rownames(mat))
  ha_row_cl <- if (show_cl_ann_sh) rowAnnotation(Cluster = ann_row_cl$Cluster, col = list(Cluster = ccols),
                             show_annotation_name = FALSE, simple_anno_size = unit(3,"mm"),
                             # 图例由 draw(annotation_legend_list=...) 统一控制，
                             # 这样关闭色条后仍可独立显示簇名称图例，且不会重复。
                             show_legend = FALSE,
                             annotation_legend_param = list(Cluster = list(order = 2,
                               title = "Cluster", title_gp = gpar(fontsize=sh_legend_title_size, face="bold", fontfamily = font_family),
                               labels_gp = gpar(fontsize=sh_legend_text_size, fontfamily = font_family),
                               grid_height = unit(3,"mm"), grid_width = unit(3,"mm"),
                               at = cl_levels, labels = cl_levels))) else NULL
  cluster_legend_sh <- if (show_cl_legend_sh) Legend(
    labels = cl_levels, title = "Cluster",
    legend_gp = gpar(fill = unname(ccols[cl_levels])),
    title_gp = gpar(fontsize = sh_legend_title_size, fontface = "bold", fontfamily = font_family),
    labels_gp = gpar(fontsize = sh_legend_text_size, fontfamily = font_family),
    grid_height = unit(3,"mm"), grid_width = unit(3,"mm")
  ) else NULL

  # 基因名:italic bold
  gene_labels_expr <- lapply(rownames(mat), function(x) bquote(bolditalic(.(x))))
  # 列标签:按附件参考显示每个样本对应的组名。
  col_labels_grp <- as.character(display_groups)
  show_cell_text <- isTRUE(sh_opt$show_cell_text %||% FALSE)
  cell_text_size <- as.numeric(sh_opt$cell_text_size %||% 4.5)

  ht <- Heatmap(mat, name = "Z-score", col = col_fun,
                heatmap_legend_param = if (show_sh_legend) list(title = "Z-score", at = z_at_sh,
                                             legend_height = unit(3,"cm"),
                                             title_gp = gpar(fontsize=sh_legend_title_size, fontfamily = font_family),
                                             labels_gp = gpar(fontsize=sh_legend_text_size, fontfamily = font_family), order = 3) else list(show = FALSE),
                cluster_rows = FALSE, cluster_columns = FALSE,
                row_split = row_split_v, row_gap = unit(1.5,"mm"),
                # 目标版式不在左侧重复显示簇名称；簇名称统一由右侧 Cluster 图例展示。
                row_title = NULL,
                show_row_names = show_gene_names, row_names_side = "left",
                row_names_gp = gpar(fontsize = gene_names_size, col = "black", fontfamily = font_family),
                row_names_rot = 0,
                row_labels = if (show_gene_names) as.expression(gene_labels_expr) else NULL,
                show_column_names = show_group_names, column_names_side = "bottom",
                column_names_centered = TRUE, column_names_rot = gene_rot,
                # 底部组名统一黑色；分组身份由顶部色条与 Group 图例表达，
                # 避免不同组名颜色影响论文图中的文字可读性。
                column_names_gp = gpar(fontsize = group_names_size, fontface = "bold",
                                       col = "black", fontfamily = font_family),
                column_labels = if (show_group_names) col_labels_grp else NULL,
                left_annotation = ha_row_cl,
                top_annotation = ha_col_grp,
                border = FALSE, rect_gp = gpar(col = NA),
                use_raster = isTRUE(sh_opt$use_raster %||% TRUE),
                cell_fun = if (show_cell_text) {
                  function(j, i, x, y, width, height, fill) {
                    grid.text(round(count_display[i, j], 0), x = x, y = y,
                              gp = gpar(fontsize = cell_text_size, col = "black"))
                  }
                } else NULL)

  # 竖向尺寸:窄而高(基因纵向排列)
  sz <- get_size("select_heatmap", sh_opt, n_genes = length(gene_order), n_samples = ncol(mat))
  save_plot(function() {
    draw(ht, merge_legends = TRUE, legend_grouping = "original",
         heatmap_legend_side = sh_legend_side,
         annotation_legend_side = sh_legend_side,
         annotation_legend_list = if (!is.null(cluster_legend_sh)) list(cluster_legend_sh) else NULL)
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
  vlabel_size <- as.numeric(o$label_size %||% 4)
  show_th <- isTRUE(o$show_threshold_lines %||% TRUE)  # old/5: 默认画阈值虚线
  pt_alpha <- as.numeric(o$point_alpha %||% 0.4)
  pt_size  <- as.numeric(o$point_size %||% 1.2)
  pt_shape <- as.numeric(o$point_shape %||% 19)
  # 颜色:支持自定义或调色板
  up_col   <- o$up_color %||% "#d57a27"
  down_col <- o$down_color %||% "#0068aa"
  ns_col   <- o$ns_color %||% "grey80"
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
          regulation == "up"   ~ "UP",
          regulation == "down" ~ "DOWN",
          TRUE ~ "NS"
        ),
        # 标注策略:top_n(显著 top-N,old/) / marker(标记基因) / both(并集) / none
        is_labeled = case_when(
          label_strategy == "none" ~ FALSE,
          label_strategy == "marker" ~ GeneSymbol %in% marker_genes,
          label_strategy == "both" ~ (significance != "NS" & rank(-logP) <= vtop) | (GeneSymbol %in% marker_genes),
          TRUE ~ significance != "NS" & rank(-logP) <= vtop  # top_n(默认)
        ),
        # 上下调分别控制是否标注
        is_labeled = is_labeled & (significance != "UP"   | label_up) &
                                  (significance != "DOWN" | label_down),
        label = ifelse(is_labeled, GeneSymbol, "")
      )

    up_n   <- sum(plot_data$significance == "UP",   na.rm = TRUE)
    down_n <- sum(plot_data$significance == "DOWN", na.rm = TRUE)
    subtitle_text <- paste0("Thresholds: FDR < ", fdr_th, ", |log2FC| >= ", log2fc_th)
    y_max   <- max(plot_data$logP, na.rm = TRUE)
    y_limit <- y_max * 1.15

    sz <- get_size("volcano", o, n_genes = n_genes)
    volcano <- ggplot(plot_data, aes(x = log2FoldChange, y = logP)) +
      geom_point(aes(color = significance), alpha = pt_alpha, size = pt_size, shape = pt_shape) +
      scale_color_manual(values = c("UP"=up_col, "DOWN"=down_col, "NS"=ns_col))
    if (show_th)
      volcano <- volcano +
        geom_vline(xintercept = c(-log2fc_th, log2fc_th), linetype = "dashed", color = "grey40") +
        geom_hline(yintercept = -log10(fdr_th), linetype = "dashed", color = "grey40")

    lab_list <- list(color = "Change")
    tt <- o$title %||% ""
    if (isTRUE(o$show_title %||% TRUE)) lab_list$title <- if (nchar(tt) > 0) tt else paste0("Volcano Plot: ", gsub("_vs_", " vs ", cname))
    if (isTRUE(o$show_subtitle %||% TRUE)) lab_list$subtitle <- subtitle_text
    if (isTRUE(o$show_xlab %||% TRUE)) lab_list$x <- o$xlab %||% "log2(Fold Change)"
    if (isTRUE(o$show_ylab %||% TRUE)) lab_list$y <- o$ylab %||% "-log10 (Adjusted P-value)"

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
          size = vlabel_size, fontface = "bold.italic", box.padding = 0.6, point.padding = 0.4,
          segment.color = "black", segment.size = 0.3, segment.alpha = 0.6,
          max.overlaps = Inf, min.segment.length = 0, force = 2, force_pull = 1)
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
    pt_sz <- as.numeric(o$point_size %||% 1.2)
    pt_alpha <- as.numeric(o$point_alpha %||% 0.6)
    pt_shape <- as.numeric(o$point_shape %||% 19)
    up_col <- o$up_color %||% "#d57a27"; down_col <- o$down_color %||% "#0068aa"; ns_col <- o$ns_color %||% "grey80"
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
    if (length(sample_order) == 0L) {
      message("[WARN] 箱线图没有匹配到有效样本，已跳过")
    } else {
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
  }

  # ─── DEG 统计柱状图(全量参数)──────────────────────────────────────────────
  if ("deg_bar" %in% steps) {
    message("绘制 DEG 统计柱状图...")
    o <- po$deg_bar
    db_cnames <- intersect(plot_cnames("deg_bar"), names(results_list))
    n_cmp <- length(db_cnames)
    if (n_cmp == 0L) {
      message("[WARN] DEG 柱状图没有匹配到有效比较，已跳过")
    } else {
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
    if (n_samp < 2L) {
      message("[WARN] 样本聚类树至少需要 2 个有效样本，已跳过")
    } else {
    dend_expr <- as.matrix(norm_mat[, sample_order, drop = FALSE])
    storage.mode(dend_expr) <- "double"
    dend_expr[!is.finite(dend_expr)] <- NA_real_
    dend_expr <- dend_expr[rowSums(!is.na(dend_expr)) >= 2L, , drop = FALSE]
    if (nrow(dend_expr) < 2L) {
      message("[WARN] 样本聚类树有效基因少于 2 行，已跳过")
    } else {
    cor_mat <- suppressWarnings(cor(dend_expr, method = "pearson", use = "pairwise.complete.obs"))
    bad_cor <- !is.finite(cor_mat)
    if (any(bad_cor)) {
      cor_mat[bad_cor] <- 0
      diag(cor_mat) <- 1
    }
    dist_mat <- as.dist(pmax(0, 1 - cor_mat))
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
             cex.axis = as.numeric(o$cex_axis %||% 1), cex.main = as.numeric(o$cex_main %||% 1), cex.lab = as.numeric(o$cex_lab %||% 1))
      } else {
        plot(dend, main = main_t, xlab = xlab_t, sub = "", ylab = ylab_t, hang = hang,
             cex = label_cex, cex.axis = as.numeric(o$cex_axis %||% 1), cex.main = as.numeric(o$cex_main %||% 1), cex.lab = as.numeric(o$cex_lab %||% 1))
      }
    }, "sample_dendrogram", width = sz$w, height = sz$h)
    message("[OK] sample_dendrogram 已生成")
    }
    }
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
      if (length(sample_order) == 0L) {
        message("[WARN] 小提琴图没有匹配到有效样本，已跳过")
      } else {
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
  }

  # ─── 表达密度图(全量参数)────────────────────────────────────────────────────
  if ("density" %in% steps) {
    message("绘制表达密度图...")
    o <- po$density
    by_var <- o$by %||% "group"
    dens_groups <- plot_groups("density")
    sample_order <- names(sample_to_group)[names(sample_to_group) %in% colnames(norm_mat) &
                                           sample_to_group %in% dens_groups]
    if (length(sample_order) == 0L) {
      message("[WARN] 密度图没有匹配到有效样本，已跳过")
    } else {
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
}

# ═══════════════════════════════════════════════════════════════════════════
# Step 6: 样本 QC（与参考流程保持同一套输出）
# ═══════════════════════════════════════════════════════════════════════════
run_qc_plots <- function(deg_env) {
  if (!("qc" %in% steps)) return(invisible(NULL))
  message("\n绘制样本 QC 图...")
  qo <- po$qc %||% list()
  norm_full <- deg_env$norm_mat
  samples <- plot_samples("qc")
  samples <- samples[samples %in% colnames(norm_full)]
  norm_mat <- norm_full[, samples, drop = FALSE]
  if (length(samples) < 2) {
    message("[WARN] 样本 QC 至少需要 2 个有效样本;当前有效样本数 = ", length(samples), "，已跳过 QC 图")
    return(invisible(NULL))
  }
  norm_mat <- as.matrix(norm_mat)
  storage.mode(norm_mat) <- "double"
  # 删除整行无效值；部分无效值保留给 pairwise.complete.obs，避免一个坏基因
  # 令整张相关性图变成空白。
  finite_rows <- rowSums(is.finite(norm_mat)) >= 2L
  if (!all(finite_rows)) {
    message("[WARN] QC 归一化矩阵剔除 ", sum(!finite_rows), " 行无效/不足值")
    norm_mat <- norm_mat[finite_rows, , drop = FALSE]
  }
  if (nrow(norm_mat) < 2) {
    message("[WARN] QC 归一化矩阵有效基因少于 2 行，已跳过 QC 图")
    return(invisible(NULL))
  }
  qc_width <- as.numeric(qo$qc_width %||% 9)
  qc_height <- max(as.numeric(qo$qc_height_min %||% 5),
                   as.numeric(qo$qc_height_per_sample %||% 0.25) * length(samples))
  corr_width <- as.numeric(qo$correlation_width %||% 8)
  corr_height <- as.numeric(qo$correlation_height %||% 6)
  distance_width <- as.numeric(qo$distance_width %||% 8)
  distance_height <- as.numeric(qo$distance_height %||% 6)
  qc_palette <- qo$color_palette %||% "reference"
  qc_saved <- FALSE

  raw <- read.csv(data_file, check.names = FALSE, stringsAsFactors = FALSE)
  raw <- raw[, intersect(samples, colnames(raw)), drop = FALSE]
  raw[] <- lapply(raw, function(x) suppressWarnings(as.numeric(x)))
  raw_mat <- as.matrix(raw)
  if (ncol(raw_mat) != length(samples) || anyNA(raw_mat)) {
    message("[WARN] 无法读取完整原始计数矩阵，跳过文库深度与检测基因数 QC")
  } else {
    lib <- data.frame(
      Sample = colnames(raw_mat),
      library_size = colSums(raw_mat),
      detected_genes = colSums(raw_mat > 0),
      Group = sample_to_group[colnames(raw_mat)],
      stringsAsFactors = FALSE
    )
    qc_group_levels <- group_order[group_order %in% unique(as.character(lib$Group))]
    qc_group_levels <- c(qc_group_levels, setdiff(unique(as.character(lib$Group)), qc_group_levels))
    lib$Group <- factor(lib$Group, levels = qc_group_levels)
    singleton_groups <- all(table(as.character(lib$Group)) == 1)
    lib$Display <- if (singleton_groups) as.character(lib$Group) else lib$Sample
    display_levels <- if (singleton_groups) qc_group_levels else lib$Sample[order(lib$library_size)]
    lib$Display <- factor(lib$Display, levels = display_levels)
    glv <- levels(lib$Group)
    gcols <- setNames(get_palette(qc_palette, length(glv)), glv)
    p_library <- ggplot(lib, aes(Display, library_size, fill = Group)) +
      geom_col() + coord_flip() + scale_fill_manual(values = gcols) +
      labs(title = "Library size", x = NULL, y = "Filtered counts", fill = "Group") +
      build_theme(list(gg_theme = "bw", base_size = 12, show_legend = TRUE, legend_position = "right",
                       show_title = TRUE, title_size = 18, axis_text_size = 16, axis_title_size = 16,
                       legend_title_size = 16, legend_text_size = 14, show_grid = TRUE))
    if (isTRUE(qo$show_library_size %||% TRUE))
      qc_saved <- isTRUE(save_ggplot(p_library, "QC_library_size", width = qc_width, height = qc_height, required = FALSE)) || qc_saved
    p_detected <- ggplot(lib, aes(Display, detected_genes, fill = Group)) +
      geom_col() + coord_flip() + scale_fill_manual(values = gcols) +
      labs(title = "Detected genes per sample", x = NULL, y = "Genes with count > 0", fill = "Group") +
      build_theme(list(gg_theme = "bw", base_size = 12, show_legend = TRUE, legend_position = "right",
                       show_title = TRUE, title_size = 18, axis_text_size = 16, axis_title_size = 16,
                       legend_title_size = 16, legend_text_size = 14, show_grid = TRUE))
    if (isTRUE(qo$show_detected_genes %||% TRUE))
      qc_saved <- isTRUE(save_ggplot(p_detected, "QC_detected_genes", width = qc_width, height = qc_height, required = FALSE)) || qc_saved
    write.csv(lib, file.path(output_dir, "QC_library_size.csv"), row.names = FALSE)
  }

  long_expr <- stack(as.data.frame(norm_mat))
  names(long_expr) <- c("expression", "Sample")
  long_expr$Group <- sample_to_group[as.character(long_expr$Sample)]
  qc_group_levels <- group_order[group_order %in% unique(as.character(long_expr$Group))]
  qc_group_levels <- c(qc_group_levels, setdiff(unique(as.character(long_expr$Group)), qc_group_levels))
  long_expr$Group <- factor(long_expr$Group, levels = qc_group_levels)
  # 是否每组仅一个样本应按样本维度判断，不能用展开后的“基因×样本”行数判断。
  singleton_groups <- all(table(as.character(long_expr$Group)) == nrow(norm_mat))
  long_expr$Display <- if (singleton_groups) as.character(long_expr$Group) else as.character(long_expr$Sample)
  if (singleton_groups) long_expr$Display <- factor(long_expr$Display, levels = qc_group_levels)
  glv <- levels(long_expr$Group)
  gcols <- setNames(get_palette(qc_palette, length(glv)), glv)
  p_expression <- ggplot(long_expr, aes(Display, expression, fill = Group)) +
    geom_boxplot(outlier.size = 0.2) + coord_flip() + scale_fill_manual(values = gcols) +
    labs(title = "Transformed expression distribution", x = NULL, y = "VST/log2-CPM", fill = "Group") +
    build_theme(list(gg_theme = "bw", base_size = 12, show_legend = TRUE, legend_position = "right",
                     show_title = TRUE, title_size = 18, axis_text_size = 16, axis_title_size = 16,
                     legend_title_size = 16, legend_text_size = 14, show_grid = TRUE))
  if (isTRUE(qo$show_expression_distribution %||% TRUE))
    qc_saved <- isTRUE(save_ggplot(p_expression, "QC_expression_distribution", width = qc_width, height = qc_height, required = FALSE)) || qc_saved

  sample_groups <- unname(sample_to_group[samples])
  if (anyNA(sample_groups) || any(!nzchar(sample_groups))) {
    keep <- !is.na(sample_groups) & nzchar(sample_groups)
    message("[WARN] ", sum(!keep), " 个 QC 样本找不到对应分组，已从相关性/距离图剔除")
    samples <- samples[keep]
    sample_groups <- sample_groups[keep]
    norm_mat <- norm_mat[, keep, drop = FALSE]
  }
  if (length(samples) < 2L) {
    message("[WARN] QC 关联图至少需要 2 个有有效分组的样本;已跳过")
    return(invisible(NULL))
  }
  ann <- data.frame(Group = sample_groups, row.names = samples)
  gcols <- setNames(get_palette(qc_palette, length(unique(ann$Group))), unique(ann$Group))
  if (isTRUE(qo$show_correlation %||% TRUE)) {
    # 相关性矩阵只在 QC 开关开启时写出，且先完整计算成功再创建图文件，
    # 避免 DEG 主流程遗留空的 sample_correlation.png/pdf。
    cor_mat <- tryCatch(
      cor(norm_mat, method = "pearson", use = "pairwise.complete.obs"),
      error = function(e) {
        message("[WARN] 样本相关性计算失败: ", conditionMessage(e))
        NULL
      }
    )
    if (!is.null(cor_mat) && all(dim(cor_mat) >= 2)) {
      # 常量样本的 Pearson 相关未定义；将其置为 0 并固定对角线，保证
      # pheatmap 仍能输出可诊断的图，同时在日志中明确提示。
      bad_cor <- !is.finite(cor_mat)
      if (any(bad_cor)) {
        message("[WARN] 样本相关矩阵含 ", sum(bad_cor), " 个未定义值(常量/有效值不足)，已按 0 绘图")
        cor_mat[bad_cor] <- 0
        diag(cor_mat) <- 1
      }
      cor_df <- as.data.frame(cor_mat, check.names = FALSE)
      cor_df$Sample <- rownames(cor_df)
      write.csv(cor_df[, c("Sample", setdiff(colnames(cor_df), "Sample"))],
                file.path(output_dir, "sample_correlation.csv"), row.names = FALSE)
      # 组内生物学重复低相关提示仅针对同组样本，跨组低相关属正常现象。
      warned <- 0L
      for (pr in combn(colnames(cor_mat), 2, simplify = FALSE)) {
        r <- cor_mat[pr[1], pr[2]]
        g1 <- sample_to_group[[pr[1]]]; g2 <- sample_to_group[[pr[2]]]
        if (!is.na(r) && r < 0.8 && !is.na(g1) && identical(g1, g2)) {
          message("[WARN] 组内样本相关性偏低:", pr[1], " ~ ", pr[2],
                  " r = ", sprintf("%.2f", r), "(建议核查样本质量/是否离群)")
          warned <- warned + 1L
        }
      }
      if (warned == 0L) message("[OK] 组内生物学重复相关性均 >= 0.8")
      corr_saved <- save_plot(function() pheatmap(cor_mat, display_numbers = TRUE, number_format = "%.2f",
                                                  annotation_col = ann, annotation_row = ann,
                                                  annotation_colors = list(Group = gcols), border_color = NA,
                                                  color = colorRampPalette(get_heat_palette("Blue-Red 2", 100))(100),
                                                  main = "Sample Pearson correlation"),
                              "sample_correlation", width = corr_width, height = corr_height, required = FALSE)
      qc_saved <- isTRUE(corr_saved) || qc_saved
      if (isTRUE(corr_saved)) message("[OK] sample_correlation 矩阵与图已生成")
      else message("[WARN] sample_correlation 图未成功写出")
    } else {
      message("[WARN] 样本相关性矩阵无效，跳过 sample_correlation 输出")
    }
  }
  if (isTRUE(qo$show_distance %||% TRUE)) {
    # dist 不支持 NA/Inf；按每个基因的有效值中位数补齐，仅用于 QC 距离图，
    # 不回写 norm_mat，也不影响 DEG 或其他统计计算。
    dist_expr <- norm_mat
    for (i in seq_len(nrow(dist_expr))) {
      ok <- is.finite(dist_expr[i, ])
      if (any(!ok)) {
        fill <- median(dist_expr[i, ok], na.rm = TRUE)
        if (!is.finite(fill)) fill <- 0
        dist_expr[i, !ok] <- fill
      }
    }
    distance_saved <- save_plot(function() pheatmap(as.matrix(dist(t(dist_expr))), annotation_col = ann, annotation_row = ann,
                                                   annotation_colors = list(Group = gcols), border_color = NA,
                                                   color = colorRampPalette(get_heat_palette("Blue-Red 2", 100))(100),
                                                   main = "Sample Euclidean distance"),
                                "sample_distance", width = distance_width, height = distance_height, required = FALSE)
    qc_saved <- isTRUE(distance_saved) || qc_saved
  }
  if (qc_saved) message("[OK] 样本 QC、相关性与距离热图已生成")
  else message("[WARN] 样本 QC 未成功写出任何图文件，请查看上方具体错误")
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
# 全量重跑一致);候选基因表同步重建。只有旧版 TREAT 缓存的 p 值依赖 log2FC
# 阈值，改动后仅重算分类不等同于重新检验，提示用户重跑。
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
    if (isTRUE(deg_env$is_treat) && any(grepl("log2FC", changed)))
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
    run_select_heatmap(deg_env)
    run_volcano(deg_env)
    run_extra_plots(deg_env)
    run_qc_plots(deg_env)
  if (exists("run_enrich_directional") && isTRUE(po$enrich$split_direction %||% TRUE))
    run_enrich_directional(deg_env)
  else if (exists("run_enrich")) run_enrich(deg_env)
  if (exists("run_gsea"))   run_gsea(deg_env)
}

message("\n============================================================")
message("[DONE] 全流程完成!输出目录:", normalizePath(output_dir))
message("   Excel :", normalizePath(excel_file))
message("   Plots :", normalizePath(plots_dir))
message("============================================================")
