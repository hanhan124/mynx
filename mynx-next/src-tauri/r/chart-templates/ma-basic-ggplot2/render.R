render_chart <- function(data, cfg, manifest) {
  mean_col <- cfg$x %||% "baseMean"; fc_col <- cfg$y %||% "log2FC"; p_col <- cfg$group %||% "padj"
  chart_validate_columns(data, list(mean = mean_col, fc = fc_col), c("mean", "fc"))
  data$.mynx_mean <- pmax(as.numeric(data[[mean_col]]), 1e-8); data$.mynx_fc <- as.numeric(data[[fc_col]])
  data$.mynx_sig <- if (p_col %in% names(data)) !is.na(data[[p_col]]) & as.numeric(data[[p_col]]) < 0.05 else FALSE
  p <- ggplot2::ggplot(data, ggplot2::aes(x = log10(.mynx_mean), y = .mynx_fc, colour = .mynx_sig)) + ggplot2::geom_point(alpha = 0.78, size = 2.6) + ggplot2::scale_colour_manual(values = c(`FALSE` = "#9E9E9E", `TRUE` = "#2F5597"), labels = c(`FALSE` = "未显著", `TRUE` = "显著")) + ggplot2::theme_minimal(base_size = 12) + ggplot2::labs(title = cfg$title %||% NULL, x = "log10 mean expression", y = "log2 fold change", colour = NULL)
  chart_open_device(cfg$outputPath, cfg$format); print(p); grDevices::dev.off(); cfg$outputPath
}
