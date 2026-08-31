#!/usr/bin/env Rscript
# Deterministic contract checks for shared runner helpers.
root <- normalizePath(getwd(), mustWork = TRUE)
source(file.path(root, "src-tauri", "r", "modules", "config.R"))
source(file.path(root, "src-tauri", "r", "modules", "io.R"))

stopifnot(normalise_engine("auto", TRUE) == "deseq2")
stopifnot(normalise_engine("auto", FALSE) == "edger_qlf")
stopifnot(normalise_engine("edger", TRUE) == "edger_qlf")
stopifnot(identical(safe_numeric(c("1", "bad")), c(1, NA_real_)))
stopifnot(grepl("schemaVersion", analysis_signature(list(groups = list(), comparisons = list()))))
cat("RNA numeric contract benchmark passed\n")
