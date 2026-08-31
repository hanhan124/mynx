render_chart <- function(data, cfg, manifest) {
  term_col <- cfg$x %||% "term"; estimate_col <- cfg$y %||% "estimate"; low_col <- cfg$size %||% "low"; high_col <- cfg$group %||% "high"
  chart_validate_columns(data, list(term = term_col, estimate = estimate_col, low = low_col, high = high_col), c("term", "estimate", "low", "high"))
  data$.mynx_term <- factor(as.character(data[[term_col]]), levels = rev(as.character(data[[term_col]]))); data$.mynx_estimate <- as.numeric(data[[estimate_col]]); data$.mynx_low <- as.numeric(data[[low_col]]); data$.mynx_high <- as.numeric(data[[high_col]])
  reference <- if (all(data$.mynx_low > 0, na.rm = TRUE)) 1 else 0
  p <- ggplot2::ggplot(data, ggplot2::aes(y = .mynx_term, x = .mynx_estimate)) + ggplot2::geom_vline(xintercept = reference, linetype = "dashed", colour = "grey60") + ggplot2::geom_errorbar(ggplot2::aes(xmin = .mynx_low, xmax = .mynx_high), height = 0.16, orientation = "y", linewidth = 0.8, colour = "#2F5597") + ggplot2::geom_point(size = 2.6, colour = "#2F5597") + ggplot2::theme_minimal(base_size = 12) + ggplot2::labs(title = cfg$title %||% NULL, x = "估计值（95% CI）", y = NULL)
  chart_open_device(cfg$outputPath, cfg$format); print(p); grDevices::dev.off(); cfg$outputPath
}
