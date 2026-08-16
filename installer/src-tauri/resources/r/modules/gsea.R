# =============================================================================
# gsea.R — GSEA 富集分析 + 点图(按 NES 正负着色)
# =============================================================================
# 取全部基因 ranked list(按 log2FC 排序)→ GSEA() 跑各数据库 → 按 NES 着色画点图
# 输出:GSEA_<DB>.csv + gsea_dotplot.svg
# =============================================================================

run_gsea <- function(deg_env) {
  if (!("gsea" %in% steps)) return(invisible(NULL))
  message("\n========== Step: GSEA 富集分析 ==========")
  if (!requireNamespace("clusterProfiler", quietly=TRUE)) {
    message("[WARN] 缺少 clusterProfiler,跳过 GSEA")
    return(invisible(NULL))
  }
  suppressPackageStartupMessages({
    library(clusterProfiler)
    library(enrichplot)
  })

  o <- po$gsea
  organism <- o$organism %||% "human"
  databases <- o$databases %||% c("GO","KEGG")
  p_cut <- as.numeric(o$pvalue_cutoff %||% 0.05)
  top_n <- as.numeric(o$top_n %||% 20)

  # 确保注释包
  if (!ensure_org_pkg(organism)) {
    message("[WARN] 无法加载物种注释包(", organism, "),跳过 GSEA")
    return(invisible(NULL))
  }
  org_pkg <- ORG_PKG_MAP[[organism]]
  suppressPackageStartupMessages(library(org_pkg, character.only=TRUE))
  org_db <- get(org_pkg)
  kegg_code <- KEGG_ORG_MAP[[organism]] %||% "hsa"
  reactome_org <- REACTOME_ORG_MAP[[organism]] %||% "Homo sapiens"
  wp_org <- WP_ORG_MAP[[organism]] %||% "Homo sapiens"

  # 从第一个比较取 ranked list
  # 如果有多个比较,每个比较单独跑
  # 仅遍历所选比较子集(空=全部比较)
  gsea_cnames <- intersect(plot_cnames("gsea"), names(deg_env$results_list))
  for (nm in gsea_cnames) {
    res_df <- deg_env$results_list[[nm]]
    res_clean <- res_df %>% filter(!is.na(log2FoldChange))
    # 排序指标(GSEA 要求按统计量排序):优先 Wald stat(DESeq2 结果自带);
    # edgeR 单重复结果无 stat 列 → sign(log2FC)·(-log10 p)(limma/edgeR 社区惯例)
    if ("stat" %in% colnames(res_clean) && mean(!is.na(res_clean$stat)) > 0.5) {
      res_clean$rank_metric <- res_clean$stat
      metric_label <- "Wald statistic"
    } else {
      pv <- pmax(res_clean$pvalue, 1e-50)
      res_clean$rank_metric <- sign(res_clean$log2FoldChange) * (-log10(pv))
      metric_label <- "sign(log2FC) * -log10(p)"
    }
    message("GSEA 排序指标(", nm, "):", metric_label)
    # 基因符号 → Entrez ID(用 bitr,可能失败)
    entrez <- tryCatch(
      bitr(res_clean$GeneSymbol, fromType="SYMBOL", toType="ENTREZID", OrgDb=org_db),
      error = function(e) { message("[WARN] 基因符号映射失败:", conditionMessage(e)); NULL }
    )
    if (is.null(entrez) || nrow(entrez) == 0) {
      message("[WARN] ", nm, " 无基因可映射,跳过")
      next
    }
    # ID 映射丢失率:>10% 提示(排序列表覆盖可能不完整,对齐 ORA 模块)
    loss_g <- 1 - length(unique(entrez$SYMBOL)) / nrow(res_clean)
    if (loss_g > 0.1)
      message("[WARN] ", round(loss_g * 100), "% 的基因符号未能映射到 Entrez ID,",
              "GSEA 排序列表覆盖可能不完整(多数为非编码/别名符号,属正常损耗)")
    # 合并排序指标
    ranked <- res_clean %>%
      left_join(entrez, by=c("GeneSymbol"="SYMBOL")) %>%
      filter(!is.na(ENTREZID), !is.na(rank_metric)) %>%
      group_by(ENTREZID) %>%
      slice_max(abs(rank_metric), n=1) %>%  # 去重取 |metric| 最大
      ungroup() %>%
      arrange(desc(rank_metric))
    gene_list <- ranked$rank_metric
    names(gene_list) <- ranked$ENTREZID
    # 过滤低表达
    gene_list <- gene_list[!duplicated(names(gene_list))]
    message("GSEA ranked list (", nm, "): ", length(gene_list), " genes")

    results_list <- list()
    results_objs <- list()  # 保留 GSEA 结果对象(running-score 图用)

    if ("GO" %in% databases) {
      message("  GSEA GO BP...")
      ggo <- tryCatch(
        gseGO(gene_list, OrgDb=org_db, ont="BP", pvalueCutoff=p_cut, readable=TRUE, eps=1e-50),
        error=function(e) { message("    GSEA GO 失败:", conditionMessage(e)); NULL }
      )
      if (!is.null(ggo) && nrow(as.data.frame(ggo)) > 0) {
        df <- as.data.frame(ggo)
        df$Database <- "GO_BP"
        results_list[["GO_BP"]] <- df
        results_objs[["GO_BP"]] <- ggo
        write.csv(df, file.path(output_dir, paste0("GSEA_GO_BP_", nm, ".csv")), row.names=FALSE)
      }
    }

    if ("KEGG" %in% databases) {
      message("  GSEA KEGG...")
      gkk <- tryCatch(
        gseKEGG(gene_list, organism=kegg_code, pvalueCutoff=p_cut, eps=1e-50),
        error=function(e) { message("    GSEA KEGG 失败:", conditionMessage(e)); NULL }
      )
      if (!is.null(gkk) && nrow(as.data.frame(gkk)) > 0) {
        df <- as.data.frame(gkk)
        df$Database <- "KEGG"
        results_list[["KEGG"]] <- df
        results_objs[["KEGG"]] <- gkk
        write.csv(df, file.path(output_dir, paste0("GSEA_KEGG_", nm, ".csv")), row.names=FALSE)
      }
    }

    if ("Reactome" %in% databases && requireNamespace("ReactomePA", quietly=TRUE)) {
      message("  GSEA Reactome...")
      gpr <- tryCatch(
        ReactomePA::gsePathway(gene_list, organism=reactome_org, pvalueCutoff=p_cut, eps=1e-50),
        error=function(e) { message("    GSEA Reactome 失败:", conditionMessage(e)); NULL }
      )
      if (!is.null(gpr) && nrow(as.data.frame(gpr)) > 0) {
        df <- as.data.frame(gpr)
        df$Database <- "Reactome"
        results_list[["Reactome"]] <- df
        results_objs[["Reactome"]] <- gpr
        write.csv(df, file.path(output_dir, paste0("GSEA_Reactome_", nm, ".csv")), row.names=FALSE)
      }
    }

    if ("WikiPathways" %in% databases && requireNamespace("rWikiPathways", quietly=TRUE)) {
      message("  GSEA WikiPathways...")
      gwp <- tryCatch(
        gseWP(gene_list, organism=wp_org, pvalueCutoff=p_cut),
        error=function(e) { message("    GSEA WikiPathways 失败:", conditionMessage(e)); NULL }
      )
      if (!is.null(gwp) && nrow(as.data.frame(gwp)) > 0) {
        df <- as.data.frame(gwp)
        df$Database <- "WikiPathways"
        results_list[["WikiPathways"]] <- df
        results_objs[["WikiPathways"]] <- gwp
        write.csv(df, file.path(output_dir, paste0("GSEA_WikiPathways_", nm, ".csv")), row.names=FALSE)
      }
    }

    if (length(results_list) == 0) {
      message("[WARN] ", nm, " 无显著 GSEA 结果")
      next
    }

    # 合并并画点图
    all_res <- bind_rows(results_list, .id="Source") %>%
      group_by(Database) %>%
      slice_min(p.adjust, n=top_n) %>%
      ungroup() %>%
      mutate(Description = substr(Description, 1, 60),
             Description = factor(Description, levels=rev(unique(Description))),
             Direction = ifelse(NES > 0, "Up", "Down"),
             neg_log10_padj = -log10(p.adjust))

    up_col <- o$up_color %||% "#E41A1C"
    down_col <- o$down_color %||% "#377EB8"
    dir_cols <- c("Up"=up_col, "Down"=down_col)
    # 点大小映射范围(old/ 硬编码 c(2,6))+ 着色依据(old/: direction;新增 nes 连续着色)
    pt_min <- as.numeric(o$point_size_min %||% 2)
    pt_max <- as.numeric(o$point_size_max %||% 6)
    color_by <- o$color_by %||% "direction"

    sz <- get_size("gsea", o, n_comparisons=length(unique(all_res$Database)))
    # 着色:direction(Up/Down 离散,old/) 或 nes(NES 连续 diverging)
    if (color_by == "nes") {
      p <- ggplot(all_res, aes(NES, Description, color = NES, size = neg_log10_padj)) +
        geom_point() +
        scale_color_gradient2(low = down_col, mid = "white", high = up_col, midpoint = 0,
                              name = "NES") +
        scale_size_continuous(range = c(pt_min, pt_max), name = "-log10(padj)")
      lab_list <- list(color = "NES", size = "-log10(padj)")
    } else {
      p <- ggplot(all_res, aes(NES, Description, color = Direction, size = neg_log10_padj)) +
        geom_point() +
        scale_color_manual(values = dir_cols) +
        scale_size_continuous(range = c(pt_min, pt_max), name = "-log10(padj)")
      lab_list <- list(color = "Direction", size = "-log10(padj)")
    }
    if (isTRUE(o$show_title %||% TRUE)) lab_list$title <- o$title %||% paste0("GSEA: ", nm)
    if (isTRUE(o$show_xlab %||% TRUE))  lab_list$x <- o$xlab %||% "Normalized Enrichment Score (NES)"
    if (isTRUE(o$show_ylab %||% TRUE))  lab_list$y <- o$ylab %||% ""
    p <- p + do.call(labs, lab_list) + build_theme(o) +
      geom_vline(xintercept = 0, color = "grey50", linetype = "dashed")
    safe <- gsub("[^a-zA-Z0-9_-]", "_", nm)
    save_ggplot(p, paste0("gsea_dotplot_", safe), width=sz$w, height=sz$h)
    message("[OK] gsea_dotplot_", safe, " 已生成")

    # Running-score / leading edge 图(enrichplot::gseaplot2;论文与审稿常索要)
    n_rp <- as.integer(o$n_running_plots %||% 3)
    if (n_rp > 0) {
      for (src in names(results_objs)) {
        obj <- results_objs[[src]]
        odf <- as.data.frame(obj)
        if (nrow(odf) == 0 || !"ID" %in% colnames(odf)) next
        top_ids <- head(odf$ID[order(odf$p.adjust)], n_rp)
        for (gid in top_ids) {
          tryCatch({
            desc_i <- match(gid, odf$ID)
            desc <- if (!is.na(desc_i)) substr(odf$Description[desc_i], 1, 60) else gid
            psafe <- gsub("[^a-zA-Z0-9_-]", "_", paste0("gsea_rs_", src, "_", gid))
            message("    running-score: ", desc)
            save_plot(function() {
              print(enrichplot::gseaplot2(obj, geneSetID = gid, title = desc,
                                          pvalue_table = FALSE,
                                          rel_heights = c(1.5, 0.5, 1)))
            }, psafe, width = 8, height = 6)
          }, error = function(e) {
            message("    running-score 图失败(", gid, "):", conditionMessage(e))
          })
        }
      }
    }
  }

  invisible(NULL)
}
