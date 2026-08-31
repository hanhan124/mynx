render_chart <- function(data, cfg, manifest) {
  chart_validate_columns(data, list(rank = cfg$x, score = cfg$y, inSet = cfg$group), c("rank", "score", "inSet"))
  rank <- as.numeric(data[[cfg$x]]); score <- as.numeric(data[[cfg$y]]); hits <- as.numeric(as.logical(data[[cfg$group]]))
  if (any(!is.finite(rank)) || any(!is.finite(score)) || any(!hits %in% c(0, 1))) stop("GSEA 要求排序位置和统计量为数值，集合成员只能为 0/1。")
  ord <- order(rank); rank <- rank[ord]; score <- score[ord]; hits <- hits[ord]
  hit_weight <- abs(score) * hits; miss_weight <- 1 - hits
  running <- cumsum(ifelse(hits > 0, hit_weight / max(sum(hit_weight), 1e-12), -miss_weight / max(sum(miss_weight), 1)))
  curve <- data.frame(rank = rank, enrichment = running, hit = hits > 0)
  p <- ggplot2::ggplot(curve, ggplot2::aes(x = rank, y = enrichment)) +
    ggplot2::geom_hline(yintercept = 0, colour = "grey75", linewidth = 0.35) +
    ggplot2::geom_line(colour = chart_primary(cfg), linewidth = chart_layer_number(cfg, "lineWidth", 0.8, 0.1, 6)) +
    ggplot2::geom_rug(data = curve[curve$hit, , drop = FALSE], sides = "b", length = grid::unit(0.08, "npc"), colour = chart_primary(cfg), linewidth = 0.6) +
    chart_theme(cfg, "classic") +
    ggplot2::labs(title = cfg$title %||% "GSEA 富集曲线", x = "排序位置", y = "运行富集分数")
  chart_open_device(cfg$outputPath, cfg$format)
  print(chart_postprocess_plot(p, data, cfg))
  grDevices::dev.off()
  cfg$outputPath
}
