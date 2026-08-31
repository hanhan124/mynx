render_chart <- function(data, cfg, manifest) {
  x_col <- cfg$x %||% "log2FC"; p_col <- cfg$y %||% "padj"; label_col <- cfg$group %||% "gene"
  chart_validate_columns(data, list(log2fc = x_col, padj = p_col), c("log2fc", "padj"))
  data$.mynx_log2fc <- as.numeric(data[[x_col]]); data$.mynx_padj <- pmax(as.numeric(data[[p_col]]), .Machine$double.xmin)
  data$.mynx_neglog10 <- -log10(data$.mynx_padj); data$.mynx_class <- ifelse(data$.mynx_padj < 0.05 & data$.mynx_log2fc >= 1, "上调", ifelse(data$.mynx_padj < 0.05 & data$.mynx_log2fc <= -1, "下调", "未达阈值"))
  p <- ggplot2::ggplot(data, ggplot2::aes(x = .mynx_log2fc, y = .mynx_neglog10, colour = .mynx_class)) + ggplot2::geom_point(alpha = 0.78, size = 2.6) + ggplot2::geom_vline(xintercept = c(-1, 1), linetype = "dashed", colour = "grey65") + ggplot2::geom_hline(yintercept = -log10(0.05), linetype = "dashed", colour = "grey65") + ggplot2::scale_colour_manual(values = c("上调" = "#D73027", "下调" = "#4575B4", "未达阈值" = "#BDBDBD")) + ggplot2::theme_minimal(base_size = 12) + ggplot2::labs(title = cfg$title %||% NULL, x = "log2 fold change", y = "-log10 adjusted P", colour = NULL)
  chart_open_device(cfg$outputPath, cfg$format); print(p); grDevices::dev.off(); cfg$outputPath
}
