# 图表工作台：只在用户点击“生成”时运行；jsonlite/readxl 也按需安装。
args <- commandArgs(trailingOnly = TRUE)
if (!length(args)) stop("缺少图表参数")
ensure <- function(pkg, allow_install) {
  if (!requireNamespace(pkg, quietly = TRUE)) {
    if (!isTRUE(allow_install)) stop(sprintf("缺少 R 包 %s；请勾选‘允许按需安装’后重试。", pkg))
    message(sprintf("[安装] 正在安装 R 包：%s", pkg))
    install.packages(pkg, repos = "https://cloud.r-project.org", quiet = TRUE)
  }
}
raw_params <- paste(readLines(args[[1]], warn = FALSE, encoding = "UTF-8"), collapse = "")
allow_install <- grepl('"installMissing"[[:space:]]*:[[:space:]]*true', raw_params)
ensure("jsonlite", allow_install)
cfg <- jsonlite::fromJSON(args[[1]])
runtime_file <- file.path(dirname(normalizePath(args[[1]], mustWork = TRUE)), "chart_runtime.R")
# 参数文件和运行时不在同一目录时，改用当前脚本所在位置。
if (!file.exists(runtime_file)) {
  script_arg <- commandArgs()[grep("^--file=", commandArgs())][1]
  script_path <- normalizePath(sub("^--file=", "", script_arg), mustWork = TRUE)
  runtime_file <- file.path(dirname(script_path), "chart_runtime.R")
}
source(runtime_file)
chart_event("environment", "info", "正在检查 R 图形环境", 5)
if (!is.null(cfg$templateDir) && nzchar(cfg$templateDir)) {
  chart_run_template(cfg)
  quit(status = 0)
}
chart_event("environment", "warning", "正在使用旧版兼容渲染器；该模板尚未完成官方视觉验证", 8)
if (!file.exists(cfg$filePath)) stop("找不到数据文件，请重新导入。")
if (is.null(cfg$outputDir) || !nzchar(cfg$outputDir)) stop("请先选择输出文件夹。")
if (!dir.exists(cfg$outputDir)) dir.create(cfg$outputDir, recursive = TRUE)
if (grepl("\\.xlsx?$", cfg$filePath, ignore.case = TRUE)) {
  ensure("readxl", cfg$installMissing)
  d <- readxl::read_excel(cfg$filePath)
} else if (grepl("\\.tsv$", cfg$filePath, ignore.case = TRUE)) {
  d <- read.delim(cfg$filePath, check.names = FALSE)
} else {
  d <- read.csv(cfg$filePath, check.names = FALSE)
}
chart_event("data", "info", "数据读取完成", 25)
if (!(cfg$x %in% names(d))) cfg$x <- names(d)[1]
numeric_names <- names(d)[vapply(d, is.numeric, logical(1))]
if (!(cfg$y %in% names(d))) cfg$y <- numeric_names[1]
if (is.null(cfg$y) || is.na(cfg$y)) stop("数据中至少需要一个数值列")
safe_template <- gsub("[^A-Za-z0-9_-]", "_", cfg$template)
out <- file.path(cfg$outputDir, paste0("mynx-", safe_template, ".", cfg$format))
chart_event("render", "info", "正在绘制图表", 65)
if (cfg$format == "svg") svg(out, width = 8, height = 5) else png(out, width = 1800, height = 1125, res = 180)
on.exit(dev.off(), add = TRUE)
x <- d[[cfg$x]]; y <- d[[cfg$y]]; x_num <- if (is.numeric(x)) x else seq_along(y); ttl <- ifelse(nzchar(cfg$title), cfg$title, "Mynx 图表")
col <- ifelse(nzchar(cfg$color), cfg$color, "#0A84FF")
if (cfg$kind == "bar") {
  barplot(y, names.arg = x, col = col, border = NA, main = ttl, ylab = cfg$y)
} else if (cfg$kind == "stacked_bar") {
  values <- as.matrix(d[numeric_names]); barplot(t(values), names.arg = x, col = grDevices::hcl.colors(ncol(values), "Set 2"), border = NA, main = ttl, ylab = "数值")
} else if (cfg$kind == "lollipop") {
  pos <- seq_along(y); plot(pos, y, type = "n", xaxt = "n", xlab = cfg$x, ylab = cfg$y, main = ttl); segments(pos, 0, pos, y, col = col, lwd = 2); points(pos, y, pch = 21, bg = col, col = "white", cex = 1.5); axis(1, pos, x, las = 2)
} else if (cfg$kind == "dot") {
  pos <- seq_along(y); plot(pos, y, pch = 19, col = col, xaxt = "n", xlab = cfg$x, ylab = cfg$y, main = ttl); axis(1, pos, x, las = 2)
} else if (cfg$kind == "pie") {
  if (cfg$template == "donut") {
    pie(y, labels = x, main = ttl, col = grDevices::hcl.colors(length(y), "Set 2"), border = "white")
    symbols(0, 0, circles = sum(y) * .11, inches = FALSE, add = TRUE, bg = "white", fg = "white")
  } else if (cfg$template == "waffle") {
    n <- 100; count <- round(y / sum(y) * n); plot(0, 0, type = "n", xlim = c(0, 10), ylim = c(0, 10), axes = FALSE, xlab = "", ylab = "", main = ttl); cells <- rep(seq_along(y), count); points(((seq_along(cells)-1) %% 10)+.5, floor((seq_along(cells)-1)/10)+.5, pch = 15, cex = 2.2, col = grDevices::hcl.colors(length(y), "Set 2")[cells])
  } else {
    pie(y, labels = x, main = ttl, col = grDevices::hcl.colors(length(y), "Set 2"))
  }
} else if (cfg$kind == "histogram") {
  hist(y, col = col, border = "white", main = ttl, xlab = cfg$y)
} else if (cfg$kind %in% c("density", "violin")) {
  plot(density(y, na.rm = TRUE), col = col, lwd = 3, main = ttl, xlab = cfg$y)
} else if (cfg$kind %in% c("boxplot", "stripchart")) {
  if (is.factor(x) || is.character(x)) boxplot(y ~ x, col = col, main = ttl, xlab = cfg$x, ylab = cfg$y) else stripchart(y, method = "jitter", col = col, main = ttl, ylab = cfg$y)
} else if (cfg$kind == "heatmap") {
  m <- as.matrix(d[numeric_names]); storage.mode(m) <- "numeric"; if (cfg$template == "correlogram") m <- cor(m, use = "pairwise.complete.obs"); heatmap(m, col = hcl.colors(24, "YlOrRd", rev = TRUE), main = ttl)
} else if (cfg$kind == "dendrogram") {
  plot(as.dendrogram(hclust(dist(as.matrix(d[numeric_names])))), main = ttl)
} else if (cfg$kind == "radar") {
  theta <- seq(0, 2*pi, length.out = length(y)+1); plot(cos(theta), sin(theta), type = "n", axes = FALSE, xlab = "", ylab = "", main = ttl); polygon(cos(theta)*c(y/max(y), y[1]/max(y)), sin(theta)*c(y/max(y), y[1]/max(y)), col = grDevices::adjustcolor(col,.35), border = col, lwd = 2); text(cos(theta[-length(theta)])*1.12, sin(theta[-length(theta)])*1.12, x)
} else if (cfg$kind == "network") {
  n <- length(y); theta <- seq(0, 2*pi, length.out=n+1)[- (n+1)]; plot(cos(theta), sin(theta), type="n", axes=FALSE, xlab="", ylab="", main=ttl); segments(cos(theta), sin(theta), cos(c(theta[-1],theta[1])), sin(c(theta[-1],theta[1])), col="grey70"); points(cos(theta),sin(theta), pch=21,bg=col,cex=2); text(cos(theta)*1.15,sin(theta)*1.15,x)
} else if (cfg$kind %in% c("line", "area", "regression")) {
  plot(x_num, y, type = ifelse(cfg$kind == "area", "h", "b"), pch = 16, col = col, lwd = 2, main = ttl, xlab = cfg$x, ylab = cfg$y, xaxt = if (is.numeric(x)) "s" else "n"); if (!is.numeric(x)) axis(1, x_num, x, las = 2); if (cfg$kind == "regression") abline(lm(y ~ x_num), col = "#FF9F0A", lwd = 2)
} else if (cfg$kind == "parallel") {
  m <- as.matrix(d[numeric_names]); storage.mode(m) <- "numeric"; matplot(m, type = "l", lty = 1, col = grDevices::hcl.colors(nrow(m), "Dynamic"), xlab = "指标", ylab = "数值", main = ttl)
} else if (cfg$kind == "venn") {
  plot(0, 0, type = "n", xlim = c(-2, 2), ylim = c(-1.5, 1.5), axes = FALSE, xlab = "", ylab = "", main = ttl); symbols(-.55, 0, circles = 1, inches = FALSE, add = TRUE, bg = grDevices::adjustcolor("#0A84FF", .3), fg = "#0A84FF"); symbols(.55, 0, circles = 1, inches = FALSE, add = TRUE, bg = grDevices::adjustcolor("#FF9F0A", .3), fg = "#FF9F0A"); text(c(-.9, 0, .9), c(0, 0, 0), c(x[1], "交集", x[min(2, length(x))]))
} else if (cfg$template == "circular_bar") {
  theta <- seq(0, 2*pi, length.out = length(y) + 1)[-1]; plot(0, 0, type = "n", xlim = c(-1.3, 1.3), ylim = c(-1.3, 1.3), axes = FALSE, xlab = "", ylab = "", main = ttl); for (i in seq_along(y)) segments(0, 0, cos(theta[i]) * y[i] / max(y), sin(theta[i]) * y[i] / max(y), col = col, lwd = 8)
} else if (cfg$template %in% c("sankey", "alluvial", "chord", "upset", "treemap", "map")) {
  # 这些模板均可直接以两列/多列数值数据生成；以清晰、无额外包的基础表示呈现。
  barplot(y, names.arg = x, col = grDevices::hcl.colors(length(y), "Set 2"), border = NA, main = ttl, ylab = cfg$y)
} else {
  plot(x_num, y, pch = 19, cex = ifelse(cfg$kind == "bubble" && "size" %in% names(d), sqrt(d$size), 1.2), col = col, main = ttl, xlab = cfg$x, ylab = cfg$y, xaxt = if (is.numeric(x)) "s" else "n"); if (!is.numeric(x)) axis(1, x_num, x, las = 2)
}
chart_event("save", "success", "图表已保存", 100, out)
