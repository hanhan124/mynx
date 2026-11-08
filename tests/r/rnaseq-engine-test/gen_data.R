# 合成计数矩阵生成器 — 用于 rnaseq_engine.R 的数值回归测试。
# 输出:
#   gene.count.csv      三样本无重复(对应参考脚本的 iRPE 场景)
#   gene.count_rep.csv  两组各 3 个重复(走 DESeq2 有重复路径)
setwd(dirname(sub("^--file=", "", grep("^--file=", commandArgs(), value = TRUE)[1])))

set.seed(42)

markers <- c("RPE65", "MITF", "BEST1", "NANOG", "SOX2", "POU5F1", "PAX6", "PMEL",
             "RAX", "TYR", "OTX2", "TYRP1", "MERTK", "LHX2", "VSX2", "DCT", "RLBP1",
             "RDH5", "MLANA", "ITGAV", "ATP1A1", "TJP1", "AQP1", "EZR", "SERPINF1", "VEGFA")
other <- paste0("GENE", sprintf("%04d", seq_len(774)))
genes <- c(markers, other)

# 基础表达:对数正态,部分基因低表达(供 filterByExpr 过滤)
base <- exp(rnorm(length(genes), mean = 3.2, sd = 1.4))
base[seq(700, length(genes), by = 3)] <- base[seq(700, length(genes), by = 3)] * 0.01

# 分组效应:RPE 标志基因在 iRPE 组上调,iPSC 多能基因下调
effect <- function(g, case_mult) {
  m <- rep(1, length(g))
  rpe <- g %in% c("RPE65", "MITF", "BEST1", "TYR", "OTX2", "TYRP1", "MERTK",
                  "PMEL", "RDH5", "RLBP1", "DCT", "MLANA", "TJP1", "EZR")
  ipsc <- g %in% c("NANOG", "SOX2", "POU5F1", "PAX6")
  m[rpe] <- case_mult; m[ipsc] <- 1 / (case_mult^0.75)
  m
}

mk_counts <- function(sample_names, group_of, case_mult) {
  counts <- matrix(NA_real_, nrow = length(genes), ncol = length(sample_names),
                   dimnames = list(genes, sample_names))
  for (s in sample_names) {
    sf <- list("iPSC_01_02" = 1.00, "CX2_7" = 1.30, "CX2_3" = 0.80,
               "CTL_1" = 0.90, "CTL_2" = 1.10, "CTL_3" = 1.00,
               "CASE_1" = 1.05, "CASE_2" = 0.95, "CASE_3" = 1.15)[[s]] %||% 1
    sf <- if (is.null(sf)) 1 else sf
    eff <- effect(genes, if (group_of[[s]] == "case") case_mult else 1)
    mu <- base * sf * eff
    nb <- stats::rnbinom(length(genes), mu = mu, size = 1.8)
    counts[, s] <- pmax(0, round(nb))
  }
  counts
}

`%||%` <- function(a, b) if (is.null(a)) b else a

# 无重复数据:iPSC(1) / iRPE D28(1) / iRPE D42(1)
c1 <- mk_counts(c("iPSC_01_02", "CX2_7", "CX2_3"),
                list("iPSC_01_02" = "ctrl", "CX2_7" = "case", "CX2_3" = "case"),
                case_mult = 6)
write.csv(data.frame(gene = rownames(c1), c1, check.names = FALSE),
          "gene.count.csv", row.names = FALSE, fileEncoding = "UTF-8")

# 有重复数据:对照组 3 / 处理组 3
c2 <- mk_counts(c("CTL_1", "CTL_2", "CTL_3", "CASE_1", "CASE_2", "CASE_3"),
                setNames(rep(c("ctrl", "case"), each = 3),
                         c("CTL_1", "CTL_2", "CTL_3", "CASE_1", "CASE_2", "CASE_3")),
                case_mult = 3)
write.csv(data.frame(gene = rownames(c2), c2, check.names = FALSE),
          "gene.count_rep.csv", row.names = FALSE, fileEncoding = "UTF-8")

cat("generated:", nrow(c1), "genes x", ncol(c1), "samples (norep);",
    nrow(c2), "genes x", ncol(c2), "samples (rep)\n")
