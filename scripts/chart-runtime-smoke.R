suppressPackageStartupMessages(library(jsonlite))
source("src-tauri/r/chart_runtime.R")
data <- data.frame(group = c("A", "B"), value = c(1, 2))
chart_validate_data(data, list(x = "group", y = "value"))
missing_mapping_failed <- FALSE
tryCatch(chart_validate_data(data, list(x = "missing", y = "value")), error = function(e) missing_mapping_failed <<- grepl("找不到已选择的字段", conditionMessage(e), fixed = TRUE))
stopifnot(missing_mapping_failed)
non_numeric_failed <- FALSE
tryCatch(chart_validate_data(data.frame(group = c("A", "B"), value = c("one", "two"), check.names = FALSE), list(kind = "bar", x = "group", y = "value")), error = function(e) non_numeric_failed <<- grepl("需要是数值列", conditionMessage(e), fixed = TRUE))
stopifnot(non_numeric_failed)
invalid_data <- data.frame(group = character(), value = numeric())
invalid_failed <- FALSE
tryCatch(chart_validate_data(invalid_data, list(x = "group", y = "value")), error = function(e) invalid_failed <<- TRUE)
stopifnot(invalid_failed)
chart_validate_columns(data, list(category = "group", value = "value"), c("category", "value"))
failed <- FALSE
tryCatch(chart_validate_columns(data, list(category = "missing"), c("category")), error = function(e) failed <<- TRUE)
stopifnot(failed)
theme_cfg <- list(
  ggTheme = "bw",
  baseSize = 16,
  fontFamily = "sans",
  showLegend = FALSE,
  legendPosition = "none",
  showGrid = FALSE,
  showTitle = TRUE,
  titleSize = 18,
  titleHjust = 0,
  axisTextSize = 9,
  axisTitleSize = 10
)
stopifnot(inherits(chart_theme(theme_cfg, "minimal"), "theme"))
if (requireNamespace("ggplot2", quietly = TRUE)) {
  stat_data <- data.frame(group = c("A", "A", "A", "B", "B", "B"), value = c(1, 2, 3, 4, 5, 6))
  stat_cfg <- c(theme_cfg, list(kind = "boxplot", x = "group", y = "value", showStats = TRUE, showRawPoints = TRUE, statTest = "wilcox.test", pAdjustMethod = "holm", palette = "npg", pointSize = 2.6, alpha = 0.8, lineWidth = 0.8))
  stat_plot <- ggplot2::ggplot(stat_data, ggplot2::aes_string(x = "group", y = "value")) + ggplot2::geom_boxplot()
  stopifnot(inherits(chart_postprocess_plot(stat_plot, stat_data, stat_cfg), "ggplot"))
}
for (format in c("pdf", "tiff", "eps")) {
  path <- tempfile(fileext = paste0(".", format))
  chart_open_device(path, format, width = 2, height = 2, dpi = 300)
  plot.new()
  grDevices::dev.off()
  stopifnot(file.exists(path), file.info(path)$size > 100)
  unlink(path)
}
cat("chart runtime smoke passed\n")
