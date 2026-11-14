# 图表模板共享运行时。所有模板统一使用这套输入、依赖、输出和事件协议。
`%||%` <- function(x, y) if (is.null(x) || length(x) == 0) y else x

chart_number <- function(value, fallback, minimum, maximum) {
  value <- suppressWarnings(as.numeric(value))[1]
  if (!is.finite(value)) value <- fallback
  max(minimum, min(maximum, value))
}

chart_palette <- function(cfg, n = 1) {
  palettes <- list(
    npg = c("#E64B35", "#4DBBD5", "#00A087", "#3C5488", "#F39B7F", "#8491B4"),
    jama = c("#374E55", "#DF8F44", "#00A1D5", "#B24745", "#79AF97", "#6A6599"),
    lancet = c("#00468B", "#ED0000", "#42B540", "#0099B4", "#925E9F", "#FDAF91"),
    `okabe-ito` = c("#0072B2", "#D55E00", "#009E73", "#CC79A7", "#F0E442", "#56B4E9", "#000000"),
    viridis = grDevices::hcl.colors(8, "Viridis"),
    gray = grDevices::gray.colors(8, start = 0.15, end = 0.8)
  )
  id <- tolower(as.character(cfg$palette %||% "npg")[1])
  values <- palettes[[id]] %||% palettes$npg
  if (isTRUE(cfg$paletteReverse)) values <- rev(values)
  rep(values, length.out = max(1, as.integer(n)))
}

chart_primary <- function(cfg, fallback = "#0A84FF") {
  configured <- as.character(cfg$color %||% "")[1]
  if (nzchar(configured) && !configured %in% c("#0A84FF", "#69b3a2")) return(configured)
  values <- chart_palette(cfg, 1)
  if (is.null(cfg$palette) || !nzchar(as.character(cfg$palette)[1])) fallback else values[[1]]
}

chart_layer_number <- function(cfg, key, fallback, minimum, maximum) {
  chart_number(cfg[[key]] %||% fallback, fallback, minimum, maximum)
}

chart_stat_annotations <- function(data, cfg) {
  supported <- c("boxplot", "violin", "beeswarm", "ridgeline")
  if (!isTRUE(cfg$showStats) || !cfg$kind %in% supported || !nzchar(cfg$x %||% "") || !nzchar(cfg$y %||% "")) return(data.frame())
  if (!cfg$x %in% names(data) || !cfg$y %in% names(data)) return(data.frame())
  groups <- unique(as.character(data[[cfg$x]]))
  groups <- groups[!is.na(groups)]
  if (length(groups) < 2 || length(groups) > 8) return(data.frame())
  values <- data[[cfg$y]]
  if (!is.numeric(values)) return(data.frame())
  rows <- list()
  for (i in seq_len(length(groups) - 1)) for (j in (i + 1):length(groups)) {
    a <- values[as.character(data[[cfg$x]]) == groups[[i]]]
    b <- values[as.character(data[[cfg$x]]) == groups[[j]]]
    a <- a[is.finite(a)]; b <- b[is.finite(b)]
    if (length(a) < 2 || length(b) < 2) next
    p <- tryCatch(if (identical(cfg$statTest %||% "wilcox.test", "t.test")) stats::t.test(a, b)$p.value else stats::wilcox.test(a, b, exact = FALSE)$p.value, error = function(e) NA_real_)
    rows[[length(rows) + 1]] <- data.frame(i = i, j = j, p = p)
  }
  if (!length(rows)) return(data.frame())
  result <- do.call(rbind, rows)
  method <- as.character(cfg$pAdjustMethod %||% "holm")
  if (!method %in% c("none", "holm", "bonferroni", "BH")) method <- "holm"
  result$p_adj <- if (method == "none") result$p else stats::p.adjust(result$p, method = method)
  top <- max(values, na.rm = TRUE); bottom <- min(values, na.rm = TRUE); span <- max(top - bottom, 1e-8)
  result$y <- top + span * (0.08 + (seq_len(nrow(result)) - 1) * 0.1)
  result$label <- ifelse(is.na(result$p_adj), "p = NA", ifelse(result$p_adj < 0.001, "p < 0.001", sprintf("p = %.3f", result$p_adj)))
  result$x1 <- result$i; result$x2 <- result$j
  result
}

chart_postprocess_plot <- function(plot, data, cfg) {
  if (!inherits(plot, "ggplot")) return(plot)
  subtitle <- as.character(cfg$subtitle %||% "")[1]
  caption <- as.character(cfg$caption %||% "")[1]
  plot_tag <- as.character(cfg$plotTag %||% "")[1]
  if (nzchar(subtitle) || nzchar(caption) || nzchar(plot_tag)) {
    plot <- plot + ggplot2::labs(
      subtitle = if (nzchar(subtitle)) subtitle else NULL,
      caption = if (nzchar(caption)) caption else NULL,
      tag = if (nzchar(plot_tag)) plot_tag else NULL
    )
  }
  if (!cfg$kind %in% c("boxplot", "violin", "beeswarm", "ridgeline")) return(plot)
  if (isTRUE(cfg$showRawPoints) && nzchar(cfg$x %||% "") && nzchar(cfg$y %||% "")) {
    plot <- plot + ggplot2::geom_jitter(width = 0.12, height = 0, alpha = min(0.75, chart_layer_number(cfg, "alpha", 0.8, 0.05, 1)), size = chart_layer_number(cfg, "pointSize", 2.6, 0.5, 12), colour = chart_primary(cfg), inherit.aes = TRUE)
  }
  annotations <- chart_stat_annotations(data, cfg)
  if (nrow(annotations)) {
    plot <- plot +
      ggplot2::geom_segment(data = annotations, ggplot2::aes(x = x1, xend = x2, y = y, yend = y), inherit.aes = FALSE, linewidth = chart_layer_number(cfg, "lineWidth", 0.8, 0.1, 6)) +
      ggplot2::geom_text(data = annotations, ggplot2::aes(x = (x1 + x2) / 2, y = y, label = label), inherit.aes = FALSE, vjust = -0.35, size = chart_layer_number(cfg, "axisTextSize", 10, 7, 24) / 3)
  }
  plot
}

chart_event <- function(stage, level, message, progress = NULL, detail = NULL) {
  event <- list(
    timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z"),
    stage = stage,
    level = level,
    message = message,
    progress = progress,
    detail = detail
  )
  cat(jsonlite::toJSON(event, auto_unbox = TRUE, null = "null"), "\n", sep = "")
  flush.console()
}

chart_require <- function(packages, allow_install) {
  for (pkg in unique(packages)) {
    if (!requireNamespace(pkg, quietly = TRUE)) {
      if (!isTRUE(allow_install)) stop(sprintf("MISSING_PACKAGE:%s", pkg))
      chart_event("dependencies", "info", sprintf("deps.install:%s", pkg), 35)
      tryCatch(install.packages(pkg, repos = "https://cloud.r-project.org", quiet = TRUE), error = function(e) stop(sprintf("PACKAGE_INSTALL_FAILED:%s", pkg)))
      if (!requireNamespace(pkg, quietly = TRUE)) stop(sprintf("PACKAGE_INSTALL_FAILED:%s", pkg))
    }
    suppressPackageStartupMessages(library(pkg, character.only = TRUE))
  }
}

chart_read_data <- function(path, allow_install) {
  if (!file.exists(path)) stop("找不到数据文件，请重新导入。")
  chart_event("data", "info", "data.reading", 20)
  if (grepl("\\.xlsx?$", path, ignore.case = TRUE)) {
    chart_require("readxl", allow_install)
    return(readxl::read_excel(path))
  }
  if (grepl("\\.tsv$", path, ignore.case = TRUE)) return(read.delim(path, check.names = FALSE))
  read.csv(path, check.names = FALSE)
}

chart_validate_data <- function(data, cfg) {
  if (!is.data.frame(data) || nrow(data) == 0) stop("数据表为空，至少需要一行记录。")
  if (!ncol(data)) stop("数据表没有可用字段。")
  if (anyDuplicated(names(data))) stop("数据表包含重复字段名，请先重命名后再生成。")
  empty <- names(data)[vapply(data, function(x) all(is.na(x) | (is.character(x) & !nzchar(trimws(x)))), logical(1))]
  if (length(empty)) stop(sprintf("字段没有有效数据：%s", paste(empty, collapse = "、")))
  # 在启动绘图前检查界面传入的字段映射，避免把 R 的底层错误留给用户。
  mapped <- unique(unname(unlist(cfg[c("x", "y", "group", "size")], use.names = FALSE)))
  mapped <- mapped[!is.na(mapped) & nzchar(mapped)]
  # R 在部分 Windows 区域设置下会把非 ASCII 字段名转成原始字节；
  # 这类字段交给模板自身处理，ASCII 字段则在这里给出明确错误。
  ascii_mapped <- mapped[grepl("^[ -~]+$", mapped)]
  missing <- ascii_mapped[!ascii_mapped %in% names(data)]
  if (length(missing)) stop(sprintf("找不到已选择的字段：%s；请重新选择数据列。", paste(unique(missing), collapse = "、")))
  numeric_kinds <- c("bar", "stacked_bar", "lollipop", "dot", "line", "area", "regression", "scatter", "bubble", "histogram", "density", "violin", "boxplot", "stripchart", "heatmap", "dendrogram", "parallel", "radar", "survival", "gsea", "enrichment", "volcano", "ma", "pca", "forest")
  y_name <- as.character(cfg$y %||% "")[1]
  if (nzchar(y_name) && y_name %in% names(data) && isTRUE(cfg$kind %in% numeric_kinds) && !is.numeric(data[[y_name]])) {
    stop(sprintf("字段“%s”需要是数值列，请检查分隔符、缺失值或列选择。", y_name))
  }
  invisible(data)
}

chart_validate_columns <- function(data, mappings, required) {
  missing <- required[!required %in% names(mappings)]
  if (length(missing)) stop(sprintf("缺少字段映射：%s", paste(missing, collapse = "、")))
  unknown <- unname(unlist(mappings, use.names = FALSE))
  unknown <- unknown[!unknown %in% names(data)]
  if (length(unknown)) stop(sprintf("数据中找不到字段：%s", paste(unique(unknown), collapse = "、")))
}

chart_open_device <- function(path, format, width = getOption("mynx.chart.width", 8), height = getOption("mynx.chart.height", 5), dpi = getOption("mynx.chart.dpi", 180)) {
  width <- chart_number(width, 8, 2, 30)
  height <- chart_number(height, 5, 2, 30)
  dpi <- chart_number(dpi, 180, 72, 600)
  if (!format %in% c("png", "svg", "pdf", "tiff", "eps")) format <- "png"
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  if (format == "svg") svg(path, width = width, height = height)
  else if (format == "pdf") pdf(path, width = width, height = height, useDingbats = FALSE)
  else if (format == "eps") postscript(path, width = width, height = height, family = "sans", onefile = FALSE, horizontal = FALSE, paper = "special", colormodel = "srgb")
  else if (format == "tiff") tiff(path, width = width * dpi, height = height * dpi, res = dpi, compression = "lzw")
  else png(path, width = width * dpi, height = height * dpi, res = dpi)
  # 设备由每个模板在绘制完成后显式关闭；不能在此函数返回时关闭，
  # 否则模板尚未 print() 就会失去目标设备。
}

# 所有 ggplot 模板共用的外观设置。模板保留自己的默认主题，用户选择后再覆盖。
chart_theme <- function(cfg, fallback = "minimal") {
  requested <- tolower(as.character(cfg$ggTheme %||% "bw")[1])
  theme_name <- if (is.na(requested) || requested %in% c("", "auto")) "bw" else requested
  base_size <- chart_number(cfg$baseSize %||% 12, 12, 8, 32)
  font_family <- as.character(cfg$fontFamily %||% "sans")[1]
  if (!font_family %in% c("sans", "serif", "mono")) font_family <- "sans"
  device_font <- if (identical(as.character(cfg$format %||% "png"), "eps")) "sans" else switch(font_family, sans = "Helvetica", serif = "Times", mono = "Courier", "Helvetica")
  base_theme <- switch(theme_name,
    "bw" = ggplot2::theme_bw(base_size = base_size, base_family = device_font),
    "classic" = ggplot2::theme_classic(base_size = base_size, base_family = device_font),
    "light" = ggplot2::theme_light(base_size = base_size, base_family = device_font),
    "gray" = ggplot2::theme_gray(base_size = base_size, base_family = device_font),
    "grey" = ggplot2::theme_gray(base_size = base_size, base_family = device_font),
    "dark" = ggplot2::theme_dark(base_size = base_size, base_family = device_font),
    "void" = ggplot2::theme_void(base_size = base_size, base_family = device_font),
    "linedraw" = ggplot2::theme_linedraw(base_size = base_size, base_family = device_font),
    ggplot2::theme_minimal(base_size = base_size, base_family = device_font)
  )
  legend_position <- as.character(cfg$legendPosition %||% "right")[1]
  if (!legend_position %in% c("right", "left", "top", "bottom", "none")) legend_position <- "right"
  if (!isTRUE(cfg$showLegend %||% TRUE)) legend_position <- "none"
  show_grid <- !identical(cfg$showGrid, FALSE)
  show_title <- !identical(cfg$showTitle, FALSE)
  title_size <- chart_number(cfg$titleSize %||% 14, 14, 8, 32)
  title_hjust <- chart_number(cfg$titleHjust %||% 0.5, 0.5, 0, 1)
  axis_text_size <- chart_number(cfg$axisTextSize %||% 10, 10, 7, 24)
  axis_title_size <- chart_number(cfg$axisTitleSize %||% 11, 11, 7, 24)
  base_theme + ggplot2::theme(
    text = ggplot2::element_text(family = device_font),
    plot.title = if (show_title) ggplot2::element_text(size = title_size, hjust = title_hjust) else ggplot2::element_blank(),
    axis.text = ggplot2::element_text(size = axis_text_size),
    axis.title = ggplot2::element_text(size = axis_title_size),
    legend.position = legend_position,
    panel.grid = if (show_grid) ggplot2::element_line(colour = "grey85", linewidth = chart_layer_number(cfg, "gridLineWidth", 0.25, 0, 2)) else ggplot2::element_blank(),
    axis.line = ggplot2::element_line(linewidth = chart_layer_number(cfg, "axisLineWidth", 0.45, 0, 3), colour = "grey25"),
    panel.border = if (isTRUE(cfg$panelBorder)) ggplot2::element_rect(fill = NA, linewidth = chart_layer_number(cfg, "axisLineWidth", 0.45, 0, 3), colour = "grey25") else ggplot2::element_blank()
  )
}

chart_run_template <- function(cfg) {
  template_dir <- cfg$templateDir %||% ""
  manifest_file <- file.path(template_dir, "manifest.json")
  render_file <- file.path(template_dir, "render.R")
  if (!dir.exists(template_dir) || !file.exists(manifest_file) || !file.exists(render_file)) stop("TEMPLATE_RESOURCE_INCOMPLETE")
  manifest <- jsonlite::fromJSON(manifest_file, simplifyVector = FALSE)
  options(mynx.chart.width = chart_number(cfg$width %||% 8, 8, 2, 30), mynx.chart.height = chart_number(cfg$height %||% 5, 5, 2, 30), mynx.chart.dpi = chart_number(cfg$dpi %||% 180, 180, 72, 600))
  options(mynx.chart.cfg = cfg)
  chart_event("environment", "info", "environment.checking", 5)
  chart_require(unlist(manifest$packages %||% character()), cfg$installMissing)
  data <- chart_read_data(cfg$filePath, cfg$installMissing)
  chart_validate_data(data, cfg)
  chart_event("render", "info", "render.running", 65)
  render_source <- readLines(render_file, warn = FALSE, encoding = "UTF-8")
  if (identical(as.character(cfg$format %||% "png"), "eps")) {
    render_source <- gsub('family = "mono"', 'family = "sans"', render_source, fixed = TRUE)
    render_source <- gsub('family = "Helvetica"', 'family = "sans"', render_source, fixed = TRUE)
    render_source <- gsub('family = "Times"', 'family = "sans"', render_source, fixed = TRUE)
  }
  # 将模板中写死的 ggplot 主题替换为统一配置；不改动模板文件，保留官网示例结构。
  for (theme_name in c("minimal", "bw", "classic", "light", "gray", "grey", "dark", "void", "linedraw")) {
    pattern <- paste0("ggplot2::theme_", theme_name, "\\([^\\)]*\\)")
    render_source <- gsub(pattern, sprintf("chart_theme(cfg, '%s')", theme_name), render_source, perl = TRUE)
  }
  # 将模板中的常用图层参数接到统一设置；仅替换明确的数值默认值。
  render_source <- gsub("cfg\\$color %\\|\\|% \\\"#[0-9A-Fa-f]{6}\\\"", "chart_primary(cfg)", render_source, perl = TRUE)
  render_source <- gsub("grDevices::hcl.colors\\(([^,]+), \\\"Set 2\\\"\\)", "chart_palette(cfg, \\1)", render_source, perl = TRUE)
  render_source <- gsub("alpha = [0-9]+(?:\\.[0-9]+)?(?=[,\\)])", "alpha = chart_layer_number(cfg, 'alpha', 0.8, 0.05, 1)", render_source, perl = TRUE)
  render_source <- gsub("linewidth = [0-9]+(?:\\.[0-9]+)?(?=[,\\)])", "linewidth = chart_layer_number(cfg, 'lineWidth', 0.8, 0.1, 6)", render_source, perl = TRUE)
  render_source <- gsub("size = [0-9]+(?:\\.[0-9]+)?(?=[,\\)])", "size = chart_layer_number(cfg, 'pointSize', 2.6, 0.5, 12)", render_source, perl = TRUE)
  render_source <- gsub("print\\(p\\)", "print(chart_postprocess_plot(p, data, cfg))", render_source, perl = TRUE)
  eval(parse(text = paste(render_source, collapse = "\n")), envir = environment())
  if (!exists("render_chart", mode = "function")) stop("TEMPLATE_RENDER_FUNCTION_MISSING")
  output_file <- render_chart(data, cfg, manifest)
  if (!file.exists(output_file)) stop("OUTPUT_FILE_MISSING")
  chart_event("save", "success", "save.complete", 100, output_file)
  output_file
}
