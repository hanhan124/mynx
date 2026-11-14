# Shared configuration helpers for runner.R.  Functions are pure and safe to
# source from smoke tests without starting an analysis run.
`%||%` <- function(x, y) if (is.null(x) || length(x) == 0) y else x

normalise_engine <- function(engine, has_replicates) {
  value <- tolower(trimws(engine %||% "auto"))
  if (value == "auto") return(if (has_replicates) "deseq2" else "edger_qlf")
  if (!value %in% c("deseq2", "edger_qlf", "edger")) stop("Unsupported engine")
  if (value == "edger") "edger_qlf" else value
}

analysis_signature <- function(cfg, data_fingerprint = "") {
  payload <- list(
    schemaVersion = cfg$schemaVersion %||% 1,
    data = data_fingerprint,
    engine = cfg$engine %||% "auto",
    groups = cfg$groups,
    comparisons = cfg$comparisons,
    lfc = cfg$lfc_threshold %||% 1,
    padj = cfg$padj_threshold %||% 0.05
  )
  paste(capture.output(dput(payload)), collapse = "")
}
