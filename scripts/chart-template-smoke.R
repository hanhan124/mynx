suppressPackageStartupMessages(library(jsonlite))
args <- commandArgs(trailingOnly = TRUE)
root <- normalizePath(getwd(), winslash = "/", mustWork = TRUE)
runner <- file.path(root, "src-tauri/r/chart_runner.R")
templates_root <- file.path(root, "src-tauri/r/chart-templates")
out <- if (length(args) && nzchar(args[[1]])) normalizePath(args[[1]], winslash = "/", mustWork = FALSE) else file.path(tempdir(), "mynx_verified_chart_smoke")
requested_ids <- if (length(args) > 1 && nzchar(args[[2]])) strsplit(args[[2]], ",", fixed = TRUE)[[1]] else NULL
dir.create(out, recursive = TRUE, showWarnings = FALSE)
all_ids <- c("bar-basic-ggplot2", "line-basic-ggplot2", "scatter-basic-ggplot2", "histogram-basic-ggplot2", "boxplot-basic-ggplot2", "density-basic-ggplot2", "violin-basic-ggplot2", "pie-basic-ggplot2", "heatmap-basic-ggplot2", "radar-basic-ggplot2", "area-basic-ggplot2", "regression-basic-ggplot2", "lollipop-basic-ggplot2", "donut-basic-ggplot2", "circular-bar-basic-ggplot2", "grouped-bar-basic-ggplot2", "stacked-bar-basic-ggplot2", "bubble-basic-ggplot2", "correlogram-basic-ggplot2", "dendrogram-basic-ggplot2", "parallel-basic-ggplot2", "network-basic-ggplot2", "sankey-basic-ggplot2", "chord-basic-ggplot2", "map-points-basic-ggplot2", "wordcloud-basic", "venn-basic", "connected-scatter-basic-ggplot2", "slope-basic-ggplot2", "table-basic", "ridgeline-basic", "beeswarm-basic", "waffle-basic", "treemap-basic", "alluvial-basic", "upset-basic", "hexbin-basic", "bubble-map-basic", "choropleth-basic", "density2d-basic-ggplot2", "arc-basic", "edge-bundling-basic", "stacked-area-basic-ggplot2", "streamchart-basic-ggplot2", "circular-packing-basic", "time-series-basic-ggplot2", "connection-basic", "cartogram-basic", "dotplot-basic-ggplot2", "cleveland-basic-ggplot2", "volcano-basic-ggplot2", "ma-basic-ggplot2", "pca-basic-ggplot2", "forest-basic-ggplot2", "enrichment-dotplot-ggplot2", "km-survival-ggplot2", "gsea-curve-ggplot2")
if (!is.null(requested_ids)) all_ids <- intersect(all_ids, requested_ids)
for (id in all_ids) {
  sample <- file.path(templates_root, id, "sample.csv")
  header <- names(read.csv(sample, check.names = FALSE))
  x_col <- if (id %in% c("map-points-basic-ggplot2", "bubble-map-basic")) "longitude" else if (id == "choropleth-basic") "region" else if (id == "volcano-basic-ggplot2") "log2FC" else if (id == "ma-basic-ggplot2") "baseMean" else if (id == "forest-basic-ggplot2") "term" else if (id == "enrichment-dotplot-ggplot2") "term" else if (id == "km-survival-ggplot2") "time" else if (id == "gsea-curve-ggplot2") "rank" else if ("row" %in% header) "col" else if ("group" %in% header) "group" else if ("metric" %in% header) "metric" else if ("x" %in% header) "x" else if (length(header) > 1) header[1] else ""
  y_col <- if (id %in% c("map-points-basic-ggplot2", "bubble-map-basic")) "latitude" else if (id == "choropleth-basic") "value" else if (id == "volcano-basic-ggplot2") "padj" else if (id == "ma-basic-ggplot2") "log2FC" else if (id == "forest-basic-ggplot2") "estimate" else if (id == "enrichment-dotplot-ggplot2") "geneRatio" else if (id == "km-survival-ggplot2") "event" else if (id == "gsea-curve-ggplot2") "score" else if ("row" %in% header) "row" else if ("value" %in% header) "value" else header[min(2, length(header))]
  group_col <- if (id %in% c("grouped-bar-basic-ggplot2", "stacked-bar-basic-ggplot2", "stacked-area-basic-ggplot2", "streamchart-basic-ggplot2")) "series" else if (id %in% c("sankey-basic-ggplot2", "chord-basic-ggplot2")) "value" else if (id %in% c("slope-basic-ggplot2", "cleveland-basic-ggplot2")) "after" else if (id == "alluvial-basic") "stage3" else if (id == "volcano-basic-ggplot2") "gene" else if (id == "ma-basic-ggplot2") "padj" else if (id == "pca-basic-ggplot2") "group" else if (id == "forest-basic-ggplot2") "high" else if (id == "enrichment-dotplot-ggplot2") "padj" else if (id == "km-survival-ggplot2") "group" else if (id == "gsea-curve-ggplot2") "inSet" else ""
  size_col <- if (id %in% c("bubble-basic-ggplot2", "bubble-map-basic")) if (id == "bubble-basic-ggplot2") "size" else "value" else if (id %in% c("alluvial-basic", "choropleth-basic")) if (id == "alluvial-basic") "value" else "wkt" else if (id == "forest-basic-ggplot2") "low" else if (id == "enrichment-dotplot-ggplot2") "count" else ""
  for (format in c("png", "svg", "pdf", "tiff", "eps")) {
    cfg <- list(filePath = sample, outputDir = out, outputPath = file.path(out, paste0(id, ".", format)), template = id, templateDir = file.path(templates_root, id), kind = "", x = x_col, y = y_col, group = group_col, size = size_col, title = "Smoke", color = "#69b3a2", format = format, installMissing = FALSE)
    params <- file.path(out, paste0(id, ".", format, ".json")); write_json(cfg, params, auto_unbox = TRUE)
    status <- system2("Rscript", c(runner, params), stdout = TRUE, stderr = TRUE)
    if (!is.null(attr(status, "status")) || !file.exists(cfg$outputPath)) stop(paste(c("失败：", id, format, status), collapse = "\n"))
    size <- file.info(cfg$outputPath)$size
    min_size <- if (format %in% c("svg", "eps")) 100 else 500
    if (is.na(size) || size < min_size) stop(paste("输出文件过小：", id, format, size))
    if (!grepl(paste0("\\.", format, "$"), cfg$outputPath, ignore.case = TRUE)) stop(paste("输出扩展名不匹配：", id, format))
  }
}
cat("verified chart template smoke passed\n")
