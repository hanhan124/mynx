render_chart <- function(data, cfg, manifest) {
  numeric_data <- data[vapply(data, is.numeric, logical(1))]
  if (ncol(numeric_data) < 2 || nrow(numeric_data) < 3) stop("PCA 至少需要 3 个样本和 2 列数值变量")
  numeric_data <- numeric_data[, vapply(numeric_data, function(x) sd(x, na.rm = TRUE) > 0, logical(1)), drop = FALSE]
  if (ncol(numeric_data) < 2) stop("PCA 的数值列不能都是常数")
  fit <- stats::prcomp(numeric_data, center = TRUE, scale. = TRUE); scores <- as.data.frame(fit$x[, 1:2, drop = FALSE]); names(scores) <- c("PC1", "PC2")
  scores$.mynx_group <- if (nzchar(cfg$group %||% "") && cfg$group %in% names(data)) as.character(data[[cfg$group]]) else "样本"
  variance <- (fit$sdev^2) / sum(fit$sdev^2)
  p <- ggplot2::ggplot(scores, ggplot2::aes(x = PC1, y = PC2, colour = .mynx_group)) + ggplot2::geom_point(size = 2.6, alpha = 0.85) + ggplot2::theme_minimal(base_size = 12) + ggplot2::labs(title = cfg$title %||% NULL, x = sprintf("PC1 (%.1f%%)", variance[1] * 100), y = sprintf("PC2 (%.1f%%)", variance[2] * 100), colour = NULL)
  chart_open_device(cfg$outputPath, cfg$format); print(p); grDevices::dev.off(); cfg$outputPath
}
