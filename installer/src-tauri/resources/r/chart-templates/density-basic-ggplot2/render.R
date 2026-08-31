render_chart <- function(data, cfg, manifest) {
  chart_validate_columns(data, list(y = cfg$y), "y")
  p <- ggplot2::ggplot(data, ggplot2::aes_string(x = cfg$y)) + ggplot2::geom_density(fill = cfg$color %||% "#0A84FF", alpha = 0.45, colour = cfg$color %||% "#0A84FF") + ggplot2::theme_minimal(base_size = 12) + ggplot2::labs(title = cfg$title %||% NULL, x = cfg$y, y = "密度")
  chart_open_device(cfg$outputPath, cfg$format); print(p); grDevices::dev.off(); cfg$outputPath
}
