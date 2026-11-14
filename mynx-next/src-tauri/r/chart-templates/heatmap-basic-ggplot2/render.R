render_chart <- function(data, cfg, manifest) {
  chart_validate_columns(data, list(x = cfg$x, y = cfg$y, value = "value"), c("x", "y", "value")); value_col <- "value"
  row_names <- unique(as.character(data[[cfg$y]])); col_names <- unique(as.character(data[[cfg$x]])); matrix_data <- matrix(NA_real_, nrow = length(row_names), ncol = length(col_names), dimnames = list(row_names, col_names))
  for (i in seq_len(nrow(data))) matrix_data[as.character(data[[cfg$y]][i]), as.character(data[[cfg$x]][i])] <- as.numeric(data[[value_col]][i])
  scale_mode <- as.character(cfg$heatmapScale %||% "none")[1]
  if (scale_mode == "row") matrix_data <- t(scale(t(matrix_data)))
  if (scale_mode == "column") matrix_data <- scale(matrix_data)
  if (isTRUE(cfg$heatmapClusterRows) && nrow(matrix_data) > 2) { row_order <- order.dendrogram(as.dendrogram(hclust(dist(matrix_data)))); matrix_data <- matrix_data[row_order, , drop = FALSE] }
  if (isTRUE(cfg$heatmapClusterCols) && ncol(matrix_data) > 2) { col_order <- order.dendrogram(as.dendrogram(hclust(dist(t(matrix_data))))); matrix_data <- matrix_data[, col_order, drop = FALSE] }
  grid <- as.data.frame(as.table(matrix_data), stringsAsFactors = FALSE); names(grid) <- c("row", "col", "value"); grid$row <- factor(grid$row, levels = rev(rownames(matrix_data))); grid$col <- factor(grid$col, levels = colnames(matrix_data))
  colours <- chart_palette(cfg, 7); colours[[length(colours)]] <- chart_primary(cfg)
  p <- ggplot2::ggplot(grid, ggplot2::aes(x = col, y = row, fill = value)) + ggplot2::geom_tile(linewidth = chart_layer_number(cfg, "gridLineWidth", 0.25, 0, 2), colour = "white") + ggplot2::scale_fill_gradientn(colours = colours, na.value = "grey95") + ggplot2::theme_minimal(base_size = 12) + ggplot2::labs(title = cfg$title %||% NULL, x = cfg$x, y = cfg$y, fill = value_col)
  chart_open_device(cfg$outputPath, cfg$format); print(p); grDevices::dev.off(); cfg$outputPath
}
