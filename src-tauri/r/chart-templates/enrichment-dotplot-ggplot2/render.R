render_chart <- function(data, cfg, manifest) {
  chart_validate_columns(data, list(term = cfg$x, ratio = cfg$y, padj = cfg$group, count = cfg$size), c("term", "ratio", "padj", "count"))
  data$.mynx_term <- reorder(as.character(data[[cfg$x]]), data[[cfg$y]])
  data$.mynx_ratio <- as.numeric(data[[cfg$y]])
  data$.mynx_padj <- pmax(as.numeric(data[[cfg$group]]), .Machine$double.xmin)
  data$.mynx_count <- as.numeric(data[[cfg$size]])
  p <- ggplot2::ggplot(data, ggplot2::aes(x = .mynx_ratio, y = .mynx_term, size = .mynx_count, colour = -log10(.mynx_padj))) +
    ggplot2::geom_point(alpha = 0.85) +
    ggplot2::scale_colour_gradient(low = "#2C7BB6", high = "#D7191C", name = "-log10(Padj)") +
    ggplot2::scale_size_continuous(name = "基因数", range = c(2.5, 10)) +
    chart_theme(cfg, "minimal") +
    ggplot2::labs(title = cfg$title %||% "富集分析气泡图", x = "GeneRatio", y = NULL)
  chart_open_device(cfg$outputPath, cfg$format)
  print(chart_postprocess_plot(p, data, cfg))
  grDevices::dev.off()
  cfg$outputPath
}
