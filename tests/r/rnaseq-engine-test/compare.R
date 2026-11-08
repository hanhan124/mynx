# 引擎 vs 原始参考脚本 输出一致性对比
cmp_csv <- function(a, b) {
  da <- read.csv(a, check.names = FALSE); db <- read.csv(b, check.names = FALSE)
  if (!identical(dim(da), dim(db)))
    return(sprintf("%-42s DIM MISMATCH: %s vs %s", basename(a),
                   paste(dim(da), collapse = "x"), paste(dim(db), collapse = "x")))
  num <- vapply(da, is.numeric, logical(1))
  d_num <- if (any(num)) max(abs(as.matrix(da[, num, drop = FALSE]) - as.matrix(db[, num, drop = FALSE])), na.rm = TRUE) else 0
  chr_eq <- if (any(!num)) identical(as.character(unlist(da[, !num, drop = FALSE])),
                                     as.character(unlist(db[, !num, drop = FALSE]))) else TRUE
  sprintf("%-42s dims=%-8s max_num_diff=%.3g chars_identical=%s", basename(a),
          paste(dim(da), collapse = "x"), d_num, chr_eq)
}
files <- c("DE/DE_iRPE_D28_vs_iPSC.csv", "DE/DE_iRPE_D42_vs_iPSC.csv", "DE/DE_iRPE_D42_vs_D28.csv",
           "DE/DE_summary.csv", "heatmap/heatmap_overall_matrix.csv", "heatmap/heatmap_gene_clusters_matrix.csv",
           "plots/PCA_selected_coords.csv", "plots/PCA_selected_variance.csv",
           "data/counts_clean_integer.csv", "data/sample_table.csv")
for (f in files) cat(cmp_csv(file.path("results", f), file.path("results_gui", f)), "\n")

cat("\n--- output file inventory ---\n")
r1 <- sort(sub("^results", "", list.files("results", recursive = TRUE)))
r2 <- sort(sub("^results_gui", "", list.files("results_gui", recursive = TRUE)))
cat("only in reference:", paste(setdiff(r1, r2), collapse = ", "), "\n")
cat("only in engine:   ", paste(setdiff(r2, r1), collapse = ", "), "\n")
cat("\n--- DE_summary (engine) ---\n")
print(read.csv("results_gui/DE/DE_summary.csv"))
