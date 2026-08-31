render_chart <- function(data, cfg, manifest) {
  time_col <- cfg$x; event_col <- cfg$y; group_col <- cfg$group %||% ""
  chart_validate_columns(data, list(time = time_col, event = event_col), c("time", "event"))
  data$.mynx_time <- as.numeric(data[[time_col]])
  data$.mynx_event <- as.numeric(data[[event_col]])
  if (any(!is.finite(data$.mynx_time)) || any(!data$.mynx_event %in% c(0, 1))) stop("生存曲线要求时间为数值，事件列只能为 0 或 1。")
  if (nzchar(group_col) && group_col %in% names(data)) data$.mynx_group <- as.factor(data[[group_col]]) else data$.mynx_group <- factor("总体")
  fit <- survival::survfit(survival::Surv(.mynx_time, .mynx_event) ~ .mynx_group, data = data)
  s <- summary(fit)
  strata <- if (is.null(s$strata)) rep("总体", length(s$time)) else sub("^\\.mynx_group=", "", as.character(s$strata))
  curve <- data.frame(time = s$time, surv = s$surv, lower = s$lower, upper = s$upper, strata = strata)
  subtitle <- as.character(cfg$subtitle %||% "")[1]
  if (nlevels(data$.mynx_group) > 1) {
    logrank <- tryCatch(survival::survdiff(survival::Surv(.mynx_time, .mynx_event) ~ .mynx_group, data = data), error = function(e) NULL)
    if (!is.null(logrank)) {
      p_value <- stats::pchisq(logrank$chisq, df = max(1, length(logrank$n) - 1), lower.tail = FALSE)
      logrank_label <- if (is.finite(p_value) && p_value < 0.001) "Log-rank P < 0.001" else sprintf("Log-rank P = %.3f", p_value)
      subtitle <- paste(c(subtitle[nzchar(subtitle)], logrank_label), collapse = " · ")
    }
  }
  p <- ggplot2::ggplot(curve, ggplot2::aes(x = time, y = surv, colour = strata)) +
    ggplot2::geom_ribbon(ggplot2::aes(ymin = lower, ymax = upper, fill = strata), alpha = 0.14, colour = NA, show.legend = FALSE) +
    ggplot2::geom_step(linewidth = chart_layer_number(cfg, "lineWidth", 0.8, 0.1, 6)) +
    ggplot2::geom_point(data = curve[!is.na(s$upper) & s$n.censor > 0, , drop = FALSE], shape = 3, size = chart_layer_number(cfg, "pointSize", 2.6, 0.5, 12), na.rm = TRUE) +
    ggplot2::scale_y_continuous(limits = c(0, 1), labels = scales::percent) +
    chart_theme(cfg, "classic") +
    ggplot2::labs(title = cfg$title %||% "Kaplan–Meier 生存曲线", subtitle = if (nzchar(subtitle)) subtitle else NULL, x = "随访时间", y = "生存概率", colour = if (nzchar(group_col)) group_col else NULL)
  chart_open_device(cfg$outputPath, cfg$format)
  print(chart_postprocess_plot(p, data, cfg))
  grDevices::dev.off()
  cfg$outputPath
}
