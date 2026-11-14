render_chart <- function(data, cfg, manifest) {
  chart_validate_columns(data, list(x = cfg$x, y = cfg$y), c("x", "y")); data[[cfg$x]] <- factor(data[[cfg$x]], levels = data[[cfg$x]])
  p <- ggplot2::ggplot(data, ggplot2::aes_string(x = cfg$x, y = cfg$y, group = 1)) + ggplot2::geom_polygon(fill = cfg$color %||% "#0A84FF", alpha = 0.25, colour = cfg$color %||% "#0A84FF") + ggplot2::geom_line(colour = cfg$color %||% "#0A84FF") + ggplot2::geom_point(colour = cfg$color %||% "#0A84FF", size = 2) + ggplot2::coord_polar() + ggplot2::theme_minimal(base_size = 12) + ggplot2::labs(title = cfg$title %||% NULL, x = NULL, y = NULL)
  chart_open_device(cfg$outputPath, cfg$format); print(p); grDevices::dev.off(); cfg$outputPath
}
