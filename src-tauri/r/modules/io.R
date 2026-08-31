# Small IO contracts shared by runner and numeric smoke tests.
safe_numeric <- function(x, fallback = NA_real_) {
  value <- suppressWarnings(as.numeric(x))
  ifelse(is.finite(value), value, fallback)
}

assert_columns <- function(data, required) {
  missing <- setdiff(required, names(data))
  if (length(missing)) stop(sprintf("Missing columns: %s", paste(missing, collapse = ", ")))
  invisible(data)
}
