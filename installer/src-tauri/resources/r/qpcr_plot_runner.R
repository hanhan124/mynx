# qPCR 专用绘图运行器：参数来自第 3 步工作台的 JSON。
args <- commandArgs(trailingOnly = TRUE)
if (!length(args)) stop("缺少 qPCR 绘图参数")

raw <- paste(readLines(args[[1]], warn = FALSE, encoding = "UTF-8"), collapse = "")
allow_install <- grepl('"installMissing"[[:space:]]*:[[:space:]]*true', raw)
ensure <- function(pkg) {
  if (!requireNamespace(pkg, quietly = TRUE)) {
    if (!allow_install) stop(sprintf("缺少 R 包 %s；请打开“允许按需安装”后重试。", pkg))
    message(sprintf("[安装] 正在安装 R 包：%s", pkg))
    install.packages(pkg, repos = "https://cloud.r-project.org", quiet = TRUE)
  }
}
ensure("jsonlite")
ensure("readxl")
ensure("ggplot2")
ensure("scales")
cfg <- jsonlite::fromJSON(args[[1]], simplifyVector = FALSE)
`%||%` <- function(x, y) if (is.null(x) || length(x) == 0) y else x

message("[data] 正在读取 qPCR 数据")
if (!file.exists(cfg$filePath)) stop("找不到输入文件，请重新导入。")
if (!dir.exists(cfg$outputDir)) dir.create(cfg$outputDir, recursive = TRUE)
sheet <- if (nzchar(as.character(cfg$sheetName %||% ""))) cfg$sheetName else 1
data <- as.data.frame(readxl::read_excel(cfg$filePath, sheet = sheet), stringsAsFactors = FALSE, check.names = FALSE)
names(data) <- trimws(names(data))
find_col <- function(candidates, required = TRUE) {
  hit <- candidates[candidates %in% names(data)]
  if (length(hit)) return(hit[[1]])
  if (required) stop(sprintf("数据中缺少必要列：%s", paste(candidates, collapse = " / ")))
  NULL
}
gene_col <- find_col(c("Gene", "gene", "基因"))
group_col <- find_col(c("Group_Name", "Group", "group", "分组"))
avg_col <- find_col(c("Average", "average", "Mean", "均值"))
sd_col <- find_col(c("Stdev", "SD", "sd", "标准差"), FALSE)
rep_cols <- grep("^Repeat", names(data), value = TRUE, ignore.case = TRUE)
data[[gene_col]] <- as.character(data[[gene_col]])
data[[group_col]] <- as.character(data[[group_col]])
data[[avg_col]] <- suppressWarnings(as.numeric(data[[avg_col]]))
if (!is.null(sd_col)) data[[sd_col]] <- suppressWarnings(as.numeric(data[[sd_col]])) else data$.__sd <- 0
if (is.null(sd_col)) sd_col <- ".__sd"
data <- data[!is.na(data[[avg_col]]) & nzchar(data[[gene_col]]) & nzchar(data[[group_col]]), , drop = FALSE]
if (!nrow(data)) stop("没有可用于绘图的有效数据。")

as_bool <- function(x, fallback = FALSE) isTRUE(as.logical(x %||% fallback)[1])
as_num <- function(x, fallback) {
  v <- suppressWarnings(as.numeric(x %||% fallback)[1])
  if (!is.finite(v)) fallback else v
}
safe_name <- function(x) {
  x <- gsub("[\\/:*?\"<>|]", "_", as.character(x))
  x <- gsub("\\s+", "_", x)
  substr(x, 1, 80)
}
clean_group <- function(x) trimws(gsub("[\\r\\n]", "", as.character(x)))
wrap_plus <- function(x) gsub("\\+", "+\\n", as.character(x))
nice_y <- function(target, n_breaks = 5) {
  bk <- pretty(c(0, target), n = n_breaks)
  list(upper = max(bk), breaks = bk)
}
smart_size <- function(n_groups, n_ann = 0) {
  if (n_groups <= 3) { w <- 3.8; h <- 4.5
  } else if (n_groups <= 5) { w <- n_groups * 1.3; h <- 4.8
  } else if (n_groups <= 8) { w <- 4.5 + (n_groups - 5) * 0.7; h <- 5.0
  } else { w <- min(12, 6.6 + (n_groups - 8) * 0.55); h <- min(7, 5.0 + (n_groups - 8) * 0.15) }
  h <- h + min(1.5, n_ann * 0.18)
  if (!as_bool(cfg$autoSize, FALSE)) { w <- as_num(cfg$width, 5); h <- as_num(cfg$height, 4) }
  list(w = w, h = max(3.5, h))
}

if (identical(as.character(cfg$kind), "bar")) {
  message("[bar] 正在生成柱状图与统计汇总")
  output_prefix <- as.character(cfg$outputPrefix %||% "qpcr-barplot")
  format <- as.character(cfg$format %||% "png")
  selected_gene <- as.character(cfg$gene %||% "ALL")
  genes <- unique(data[[gene_col]])
  if (!identical(selected_gene, "ALL") && selected_gene %in% genes) genes <- selected_gene
  all_stats <- list()

  fmt_p <- function(p) {
    if (is.na(p)) return("NA")
    if (p < 1e-4) return("P < 0.0001")
    if (p < 1e-3) return("P < 0.001")
    paste0("P = ", formatC(p, format = "f", digits = 3))
  }
  p_stars <- function(p) {
    if (is.na(p)) "NA" else if (p < 1e-4) "****" else if (p < 1e-3) "***" else if (p < 1e-2) "**" else if (p < 0.05) "*" else "ns"
  }
  label_for <- function(p) {
    s <- p_stars(p); style <- as.character(cfg$labelStyle %||% "p.signif")
    if (style == "both") paste0(s, "\n", fmt_p(p)) else if (style == "p") fmt_p(p) else s
  }
  pair_frame <- function(groups, gene) {
    mode <- as.character(cfg$sigMode %||% "vs_first")
    groups <- unique(groups)
    if (length(groups) < 2) return(data.frame(group1 = character(), group2 = character()))
    if (mode == "vs_first") return(data.frame(group1 = groups[[1]], group2 = groups[-1]))
    if (mode == "vs_last") return(data.frame(group1 = groups[-length(groups)], group2 = groups[[length(groups)]]))
    if (mode == "vs_control") {
      ctrl <- as.character(cfg$controlGroup %||% "")
      if (!ctrl %in% groups) return(data.frame(group1 = character(), group2 = character()))
      return(data.frame(group1 = ctrl, group2 = groups[groups != ctrl]))
    }
    if (mode == "adjacent") return(data.frame(group1 = groups[-length(groups)], group2 = groups[-1]))
    if (mode == "custom") {
      rows <- list(); pairs <- cfg$customPairs %||% list()
      for (p in pairs) {
        pg <- as.character(p$gene %||% "ALL")
        if (!pg %in% c("ALL", gene)) next
        g1 <- clean_group(p$control %||% ""); g2 <- clean_group(p$treatment %||% "")
        if (g1 %in% groups && g2 %in% groups && g1 != g2) rows[[length(rows) + 1]] <- data.frame(group1 = g1, group2 = g2)
      }
      if (length(rows)) return(do.call(rbind, rows))
      return(data.frame(group1 = character(), group2 = character()))
    }
    pr <- combn(groups, 2, simplify = FALSE)
    data.frame(group1 = vapply(pr, `[[`, character(1), 1), group2 = vapply(pr, `[[`, character(1), 2))
  }
  run_stats <- function(s, gene) {
    if (!as_bool(cfg$enableStats, TRUE)) return(data.frame())
    cmps <- pair_frame(s[[group_col]], gene)
    if (!nrow(cmps)) return(data.frame())
    values <- list()
    for (i in seq_len(nrow(s))) for (rc in rep_cols) {
      v <- suppressWarnings(as.numeric(s[[rc]][i])); if (is.finite(v)) values[[length(values) + 1]] <- data.frame(Group_Name = s[[group_col]][i], value = v)
    }
    if (!length(values)) return(data.frame())
    reps <- do.call(rbind, values)
    ng <- length(unique(reps$Group_Name)); requested <- as.character(cfg$statTest %||% "auto")
    test <- if (requested == "auto") if (ng <= 2 || as.character(cfg$sigMode %||% "") %in% c("custom", "vs_control")) "t.test" else "anova" else requested
    if (as.character(cfg$sigMode %||% "") %in% c("custom", "vs_control") && test %in% c("anova", "kruskal.test")) test <- "t.test"
    rows <- list(); omnibus <- NA_real_; omnibus_method <- ""
    if (test %in% c("anova", "kruskal.test")) {
      omnibus <- tryCatch(if (test == "anova") summary(aov(value ~ Group_Name, data = reps))[[1]][["Pr(>F)"]][1] else kruskal.test(value ~ Group_Name, data = reps)$p.value, error = function(e) NA_real_)
      omnibus_method <- if (test == "anova") "One-way ANOVA" else "Kruskal-Wallis"
    }
    for (i in seq_len(nrow(cmps))) {
      g1 <- cmps$group1[i]; g2 <- cmps$group2[i]; a <- reps$value[reps$Group_Name == g1]; b <- reps$value[reps$Group_Name == g2]
      p <- NA_real_; method <- "n < 2"
      if (length(a) >= 2 && length(b) >= 2) {
        p <- tryCatch({
          if (test == "anova") {
            tk <- TukeyHSD(aov(value ~ Group_Name, data = reps))$Group_Name
            hit <- rownames(tk) %in% c(paste(g2, g1, sep = "-"), paste(g1, g2, sep = "-")); if (any(hit)) tk[which(hit)[1], "p adj"] else NA_real_
          } else if (test %in% c("wilcox.test", "kruskal.test")) wilcox.test(a, b, exact = FALSE)$p.value else t.test(a, b, var.equal = FALSE)$p.value
        }, error = function(e) NA_real_)
        method <- if (test == "anova") "Tukey HSD" else if (test %in% c("wilcox.test", "kruskal.test")) "Wilcoxon" else "Welch t-test"
      }
      rows[[length(rows) + 1]] <- data.frame(Gene = gene, group1 = g1, group2 = g2, n1 = length(a), n2 = length(b), mean1 = mean(a), mean2 = mean(b), p_raw = p, omnibus_p = omnibus, omnibus_method = omnibus_method, test_method = method, stringsAsFactors = FALSE)
    }
    st <- do.call(rbind, rows)
    if (test == "anova" && !is.na(omnibus)) { st$p_adj <- st$p_raw; st$adj_method <- "Tukey" } else { method <- as.character(cfg$pAdjustMethod %||% "holm"); st$p_adj <- if (method == "none") st$p_raw else p.adjust(st$p_raw, method = method); st$adj_method <- method }
    st$sig <- !is.na(st$p_adj) & st$p_adj < 0.05; st$label <- vapply(st$p_adj, label_for, character(1)); st$p_fmt <- vapply(st$p_adj, fmt_p, character(1)); st$stars <- vapply(st$p_adj, p_stars, character(1)); st
  }
  build_annotations <- function(stats, pd, y_upper) {
    if (!as_bool(cfg$enableStats, TRUE) || !as_bool(cfg$showStats, TRUE) || !nrow(stats)) return(data.frame())
    st <- stats
    if (!as_bool(cfg$showNs, TRUE)) st <- st[st$sig, , drop = FALSE]
    if (!nrow(st)) return(data.frame())
    lvls <- as.character(pd$Group_Name)
    st$x1 <- match(st$group1, lvls); st$x2 <- match(st$group2, lvls)
    st <- st[is.finite(st$x1) & is.finite(st$x2) & st$x1 != st$x2, , drop = FALSE]
    if (!nrow(st)) return(data.frame())
    st <- st[order(abs(st$x2 - st$x1), st$x1), , drop = FALSE]
    gap <- y_upper * 0.05; step <- y_upper * as_num(cfg$bracketStep, 0.12); drop <- y_upper * 0.025
    data_max <- max(pd$ymax, na.rm = TRUE); base <- data_max + gap
    st$y_line <- base + (seq_len(nrow(st)) - 1) * step
    st$y_tip <- st$y_line - drop
    lab_gap <- as_num(cfg$bracketLabelGap, 0.18)
    st$y_lab <- ifelse(st$stars == "ns", st$y_line + step * lab_gap, st$y_line + step * lab_gap * 0.1)
    st$xa <- pmin(st$x1, st$x2); st$xb <- pmax(st$x1, st$x2)
    st
  }

  for (gene in genes) {
    s <- data[data[[gene_col]] == gene, , drop = FALSE]
    s[[group_col]] <- factor(s[[group_col]], levels = unique(s[[group_col]]))
    top_value <- max(s[[avg_col]] + s[[sd_col]], na.rm = TRUE)
    use_sci <- as_bool(cfg$scientificNotation, TRUE) && top_value > 0 && ((all(sprintf("%.1f", s[[avg_col]] + s[[sd_col]]) == "0.0")) || top_value >= 100)
    exponent <- if (use_sci) floor(log10(top_value)) else 0
    factor_value <- if (use_sci) 10^(-exponent) else 1
    s$y <- s[[avg_col]] * factor_value; s$err <- s[[sd_col]] * factor_value; s$ymax <- s$y + s$err
    groups <- as.character(s[[group_col]])
    pd <- data.frame(Group_Name = factor(if (as_bool(cfg$wrapPlus, FALSE)) wrap_plus(groups) else groups, levels = if (as_bool(cfg$wrapPlus, FALSE)) wrap_plus(groups) else groups), y = s$y, ymax = s$ymax)
    stats <- run_stats(s, gene)
    show_ns <- as_bool(cfg$showNs, TRUE)
    if (nrow(stats) && !show_ns) stats <- stats[stats$sig, , drop = FALSE]
    if (nrow(stats)) all_stats[[length(all_stats) + 1]] <- stats
    top0 <- max(pd$ymax, na.rm = TRUE); if (!is.finite(top0) || top0 <= 0) top0 <- 1
    ys_pre <- nice_y(top0 * 1.05)
    ann <- build_annotations(stats, pd, ys_pre$upper)
    top_final <- top0; if (nrow(ann)) top_final <- max(top_final, max(ann$y_lab, na.rm = TRUE))
    ys <- nice_y(top_final * 1.05)
    auto_bar_width <- if (nrow(s) <= 4) 0.6 else if (nrow(s) <= 8) 0.5 else max(0.35, 4.5 / nrow(s))
    requested_bar_width <- as_num(cfg$barWidth, 0)
    bar_width <- if (requested_bar_width > 0) requested_bar_width else auto_bar_width
    p <- ggplot2::ggplot(pd, ggplot2::aes(x = Group_Name, y = y)) +
      ggplot2::geom_col(width = bar_width, fill = as.character(cfg$barFill %||% "#0000ff"), colour = as.character(cfg$barBorder %||% "black"), linewidth = as_num(cfg$barBorderWidth, 0.3)) +
      ggplot2::geom_linerange(ggplot2::aes(ymin = y, ymax = ymax), linewidth = as_num(cfg$errorWidth, 0.5), colour = as.character(cfg$errorColor %||% "black"))
    if (as_num(cfg$errorCap, 0.15) > 0) p <- p + ggplot2::geom_errorbar(ggplot2::aes(ymin = ymax, ymax = ymax), width = as_num(cfg$errorCap, 0.15), linewidth = as_num(cfg$errorWidth, 0.5), colour = as.character(cfg$errorColor %||% "black"))
    if (as_bool(cfg$showRawPoints, FALSE) && length(rep_cols)) {
      pts <- do.call(rbind, lapply(rep_cols, function(rc) data.frame(Group_Name = groups, value = suppressWarnings(as.numeric(s[[rc]])) * factor_value)))
      pts <- pts[is.finite(pts$value), , drop = FALSE]
      if (nrow(pts)) p <- p + ggplot2::geom_point(data = pts, ggplot2::aes(x = Group_Name, y = value), position = ggplot2::position_jitter(width = 0.08, seed = 42), size = 1.6, colour = "black", alpha = 0.8)
    }
    if (nrow(ann)) p <- p + ggplot2::geom_segment(data = ann, ggplot2::aes(x = xa, xend = xb, y = y_line, yend = y_line), inherit.aes = FALSE, linewidth = as_num(cfg$bracketWidth, 0.35), colour = "black", lineend = "square") + ggplot2::geom_segment(data = ann, ggplot2::aes(x = xa, xend = xa, y = y_line, yend = y_tip), inherit.aes = FALSE, linewidth = as_num(cfg$bracketWidth, 0.35), colour = "black", lineend = "square") + ggplot2::geom_segment(data = ann, ggplot2::aes(x = xb, xend = xb, y = y_line, yend = y_tip), inherit.aes = FALSE, linewidth = as_num(cfg$bracketWidth, 0.35), colour = "black", lineend = "square") + ggplot2::geom_text(data = ann, ggplot2::aes(x = (xa + xb) / 2, y = y_lab, label = label), inherit.aes = FALSE, size = as_num(cfg$bracketTextSize, 6), vjust = 0, colour = "black")
    y_label <- if (use_sci) sprintf("Relative expression (×10^%d)", exponent) else "Relative expression"
    x_theme <- if (as_bool(cfg$showXTick, FALSE)) ggplot2::element_text(size = as_num(cfg$xTickSize, 9), angle = as_num(cfg$xAngle, 45), hjust = as_num(cfg$xHjust, 1), vjust = as_num(cfg$xVjust, 1), margin = ggplot2::margin(t = 4)) else ggplot2::element_blank()
    p <- p + ggplot2::scale_y_continuous(limits = c(0, ys$upper), breaks = ys$breaks, expand = c(0, 0), labels = scales::label_number(accuracy = 0.01)) + ggplot2::labs(x = NULL, y = y_label, title = gene) + ggplot2::theme_classic() + ggplot2::theme(plot.title = ggplot2::element_text(hjust = 0.5, size = as_num(cfg$titleSize, 26), vjust = as_num(cfg$titleVjust, 1), face = "bold.italic"), axis.title.y = ggplot2::element_text(size = as_num(cfg$yLabelSize, 15), margin = ggplot2::margin(r = 8)), axis.text.y = ggplot2::element_text(size = as_num(cfg$yTickSize, 13), margin = ggplot2::margin(r = 4)), axis.text.x = x_theme, axis.line = ggplot2::element_line(linewidth = as_num(cfg$axisWidth, 0.5), colour = "black"), axis.ticks = ggplot2::element_line(linewidth = as_num(cfg$axisWidth, 0.5), colour = "black"), axis.ticks.length = grid::unit(as_num(cfg$tickLength, 3), "pt"), plot.margin = ggplot2::margin(20, 15, 10, 10))
    out <- file.path(cfg$outputDir, paste0(safe_name(gene), ".", format))
    sz <- smart_size(nrow(s), nrow(ann))
    ggplot2::ggsave(out, p, width = sz$w, height = sz$h, dpi = as_num(cfg$dpi, 300), device = if (format == "pdf") "pdf" else if (format == "svg") "svg" else "png")
    message(sprintf("[save] %s", basename(out)))
  }
  stats_name <- safe_name(as.character(cfg$sigFile %||% "statistical_analysis_summary.csv")); if (!nzchar(stats_name)) stats_name <- "statistical_analysis_summary.csv"
  if (length(all_stats)) utils::write.csv(do.call(rbind, all_stats), file.path(cfg$outputDir, stats_name), row.names = FALSE, fileEncoding = "UTF-8") else utils::write.csv(data.frame(), file.path(cfg$outputDir, stats_name), row.names = FALSE)
} else {
  message("[heatmap] 正在计算 Z-score 并生成热图")
  output_prefix <- as.character(cfg$outputPrefix %||% "qpcr-heatmap")
  format <- as.character(cfg$format %||% "png")
  genes <- unique(data[[gene_col]]); groups <- unique(data[[group_col]])
  mat <- matrix(NA_real_, nrow = length(genes), ncol = length(groups), dimnames = list(genes, groups))
  for (i in seq_len(nrow(data))) mat[as.character(data[[gene_col]][i]), as.character(data[[group_col]][i])] <- data[[avg_col]][i]
  label_mat <- mat
  scale_mode <- as.character(cfg$heatmapScale %||% "row")
  matrix_rows <- rownames(mat); matrix_cols <- colnames(mat)
  if (scale_mode == "row") mat <- t(apply(mat, 1, function(x) if (sd(x, na.rm = TRUE) == 0 || is.na(sd(x, na.rm = TRUE))) rep(0, length(x)) else as.numeric(scale(x))))
  if (scale_mode == "column") mat <- apply(mat, 2, function(x) if (sd(x, na.rm = TRUE) == 0 || is.na(sd(x, na.rm = TRUE))) rep(0, length(x)) else as.numeric(scale(x)))
  dimnames(mat) <- list(matrix_rows, matrix_cols)
  if (as_bool(cfg$useGeneClusters, FALSE)) {
    clusters <- cfg$geneClusters %||% list(); ordered <- unlist(clusters, use.names = FALSE); ordered <- ordered[ordered %in% rownames(mat)]; if (length(ordered)) { genes <- unique(ordered); mat <- mat[genes, , drop = FALSE]; label_mat <- label_mat[genes, , drop = FALSE] }
  }
  if (as_bool(cfg$heatmapClusterRows, FALSE) && nrow(mat) > 2) mat <- mat[order.dendrogram(as.dendrogram(hclust(dist(mat)))), , drop = FALSE]
  if (as_bool(cfg$heatmapClusterCols, FALSE) && ncol(mat) > 2) mat <- mat[, order.dendrogram(as.dendrogram(hclust(dist(t(mat))))), drop = FALSE]
  grid <- expand.grid(row = rownames(mat), col = colnames(mat), stringsAsFactors = FALSE); grid$value <- as.vector(mat); grid$label <- as.vector(label_mat[rownames(mat), colnames(mat)]); grid$label_colour <- ifelse(abs(grid$value) > 0.85 * as_num(cfg$zlim, 2), "white", "grey10"); grid$row <- factor(grid$row, levels = rev(rownames(mat))); grid$col <- factor(if (as_bool(cfg$wrapPlus, FALSE)) wrap_plus(grid$col) else grid$col, levels = if (as_bool(cfg$wrapPlus, FALSE)) wrap_plus(colnames(mat)) else colnames(mat))
  p <- ggplot2::ggplot(grid, ggplot2::aes(x = col, y = row, fill = value)) + ggplot2::geom_tile(colour = "white", linewidth = 0.25) + ggplot2::scale_fill_gradient2(low = "#2166AC", mid = "#F7F7F7", high = "#B2182B", midpoint = 0, limits = c(-as_num(cfg$zlim, 2), as_num(cfg$zlim, 2)), oob = scales::squish, na.value = "grey95") + ggplot2::labs(x = NULL, y = NULL, fill = "Z-score", title = "") + ggplot2::theme_minimal(base_size = as_num(cfg$baseSize, 10)) + ggplot2::theme(panel.grid = ggplot2::element_blank(), axis.text.x = ggplot2::element_text(angle = 45, hjust = 1), axis.text.y = ggplot2::element_text(face = "bold.italic"), axis.title = ggplot2::element_blank(), plot.margin = ggplot2::margin(8, 8, 8, 8))
  if (as_bool(cfg$showCellValues, FALSE)) p <- p + ggplot2::geom_text(ggplot2::aes(label = sprintf("%.2f", label), colour = label_colour), size = as_num(cfg$cellTextSize, 5), fontface = "bold") + ggplot2::scale_colour_identity()
  export_png <- as_bool(cfg$exportPng, format == "png"); export_pdf <- as_bool(cfg$exportPdf, format == "pdf"); if (!export_png && !export_pdf && format %in% c("png", "pdf")) { export_png <- format == "png"; export_pdf <- format == "pdf" }
  if (export_png) { out <- file.path(cfg$outputDir, paste0(output_prefix, ".png")); ggplot2::ggsave(out, p, width = as_num(cfg$pngWidth, 4), height = as_num(cfg$pngHeight, 2), dpi = as_num(cfg$pngDpi, 300), device = "png"); message(sprintf("[save] %s", basename(out))) }
  if (export_pdf) { out <- file.path(cfg$outputDir, paste0(output_prefix, ".pdf")); ggplot2::ggsave(out, p, width = as_num(cfg$pdfWidth, 7), height = as_num(cfg$pdfHeight, 6), device = "pdf"); message(sprintf("[save] %s", basename(out))) }
  if (identical(format, "svg") && !export_png && !export_pdf) { out <- file.path(cfg$outputDir, paste0(output_prefix, ".svg")); ggplot2::ggsave(out, p, width = as_num(cfg$width, 7), height = as_num(cfg$height, 6), device = "svg"); message(sprintf("[save] %s", basename(out))) }
  utils::write.csv(data.frame(Gene = rownames(mat)), file.path(cfg$outputDir, paste0(output_prefix, "-row-order.csv")), row.names = FALSE, fileEncoding = "UTF-8")
}
message("[done] qPCR 绘图完成")
