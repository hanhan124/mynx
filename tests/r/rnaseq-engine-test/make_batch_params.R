j <- jsonlite::fromJSON("params_rep.json", simplifyDataFrame = FALSE, simplifyMatrix = FALSE)
j$output_dir <- "D:/vibe_coding/mynx/tests/r/rnaseq-engine-test/results_batch"
j$batch <- list(b1 = c("CTL_1", "CASE_1"), b2 = c("CTL_2", "CASE_2", "CTL_3", "CASE_3"))
j$de$method <- "edger"
j$de$filter$method <- "min_count"
j$de$shrink <- "none"
jsonlite::write_json(j, "params_batch.json", auto_unbox = TRUE, pretty = TRUE)
cat("written:", file.exists("params_batch.json"), "\n")
