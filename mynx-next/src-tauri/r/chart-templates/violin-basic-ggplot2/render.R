render_chart <- function(data, cfg, manifest) {
  chart_validate_columns(data, list(x = cfg$x, y = cfg$y), c("x", "y"))
  p <- ggplot2::ggplot(data, ggplot2::aes_string(x = cfg$x, y = cfg$y)) + ggplot2::geom_violin(fill = cfg$color %||% "#0A84FF", alpha = 0.55, trim = FALSE) + ggplot2::geom_boxplot(width = 0.12, outlier.shape = NA) + ggplot2::theme_minimal(base_size = 12) + ggplot2::labs(title = cfg$title %||% NULL, x = cfg$x, y = cfg$y)
  chart_open_device(cfg$outputPath, cfg$format); print(p); grDevices::dev.off(); cfg$outputPath
}
