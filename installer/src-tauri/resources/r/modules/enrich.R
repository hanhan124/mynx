# =============================================================================
# enrich.R — ORA 富集分析(GO/KEGG/Reactome/WikiPathways)+ 条形图
# =============================================================================
# 从 DEG 结果取上调/下调基因 → bitr() 转 Entrez ID → 按选中数据库跑富集
# 合并到一张图(按 Database 分面 + Ontology/Direction 着色)
# 输出:Enrichment_<DB>.csv + enrich_barplot.svg
# =============================================================================

# 物种 → 注释包映射
ORG_PKG_MAP <- list(
  human    = "org.Hs.eg.db",
  mouse    = "org.Mm.eg.db",
  rat      = "org.Rn.eg.db",
  fly      = "org.Dm.eg.db",
  yeast    = "org.Sc.sgd.db",
  zebrafish= "org.Dr.eg.db",
  worm     = "org.Ce.eg.db",
  chicken  = "org.Gg.eg.db",
  plant    = "org.At.tair.db"
)

# 物种 → KEGG 物种代码
KEGG_ORG_MAP <- list(
  human="hsa", mouse="mmu", rat="rno", fly="dme",
  yeast="sce", zebrafish="dre", worm="cel", chicken="gga"
)

# 物种 → Reactome 物种
REACTOME_ORG_MAP <- list(
  human="Homo sapiens", mouse="Mus musculus", rat="Rattus norvegicus",
  fly="Drosophila melanogaster", yeast="Saccharomyces cerevisiae",
  zebrafish="Danio rerio", worm="Caenorhabditis elegans"
)

# 物种 → WikiPathways 代码
WP_ORG_MAP <- list(
  human="Homo sapiens", mouse="Mus musculus", rat="Rattus norvegicus",
  zebrafish="Danio rerio", fly="Drosophila melanogaster"
)

ensure_org_pkg <- function(organism) {
  pkg <- ORG_PKG_MAP[[organism]] %||% "org.Hs.eg.db"
  if (!requireNamespace(pkg, quietly=TRUE)) {
    message("  安装物种注释包:", pkg)
    if (!requireNamespace("BiocManager", quietly=TRUE)) install.packages("BiocManager")
    BiocManager::install(pkg, update=FALSE, ask=FALSE)
  }
  requireNamespace(pkg, quietly=TRUE)
}

run_enrich <- function(deg_env) {
  if (!("enrich" %in% steps)) return(invisible(NULL))
  message("\n========== Step: ORA 富集分析 ==========")
  if (!requireNamespace("clusterProfiler", quietly=TRUE)) {
    message("[WARN] 缺少 clusterProfiler,跳过富集分析")
    return(invisible(NULL))
  }
  suppressPackageStartupMessages({
    library(clusterProfiler)
    library(enrichplot)
  })

  o <- po$enrich
  organism <- o$organism %||% "human"
  databases <- o$databases %||% c("GO","KEGG")
  ontologies <- o$ontologies %||% c("BP","CC","MF")
  p_cut <- as.numeric(o$pvalue_cutoff %||% 0.05)
  q_cut <- as.numeric(o$qvalue_cutoff %||% 0.2)  # 与前端默认一致(clusterProfiler 惯例 0.2)
  top_n <- as.numeric(o$top_n %||% 20)

  # 确保注释包
  if (!ensure_org_pkg(organism)) {
    message("[WARN] 无法加载物种注释包(", organism, "),跳过富集分析")
    return(invisible(NULL))
  }
  org_pkg <- ORG_PKG_MAP[[organism]]
  suppressPackageStartupMessages(library(org_pkg, character.only=TRUE))
  org_db <- get(org_pkg)
  kegg_code <- KEGG_ORG_MAP[[organism]] %||% "hsa"
  reactome_org <- REACTOME_ORG_MAP[[organism]] %||% "Homo sapiens"
  wp_org <- WP_ORG_MAP[[organism]] %||% "Homo sapiens"

  # 收集所选比较子集的 DEG(up + down 合并);空=全部比较
  enrich_cnames <- intersect(plot_cnames("enrich"), names(deg_env$results_list))
  all_degs <- unique(unlist(lapply(deg_env$results_list[enrich_cnames], function(r)
    r$GeneSymbol[r$regulation %in% c("up","down")])))
  if (length(all_degs) < 5) {
    message("[WARN] DEG 数量过少(", length(all_degs), "),跳过富集分析")
    return(invisible(NULL))
  }
  message("DEG 基因数:", length(all_degs))

  # 基因符号 → Entrez ID(可能因符号无效而失败)
  entrez <- tryCatch(
    bitr(all_degs, fromType="SYMBOL", toType="ENTREZID", OrgDb=org_db),
    error = function(e) { message("[WARN] 基因符号映射失败:", conditionMessage(e)); NULL }
  )
  if (is.null(entrez) || nrow(entrez) == 0) {
    message("[WARN] 无基因可映射到 Entrez ID,跳过富集分析")
    return(invisible(NULL))
  }
  message("映射到 Entrez ID:", nrow(entrez), "个")
  entrez_ids <- unique(entrez$ENTREZID)

  # ID 映射丢失率:>10% 提示(富集覆盖可能不完整)
  mapped_syms <- unique(entrez$SYMBOL)
  loss_ratio <- 1 - length(mapped_syms) / length(all_degs)
  if (loss_ratio > 0.1) {
    message("[WARN] ", round(loss_ratio * 100), "% 的 DEG 符号未能映射到 Entrez ID,富集覆盖可能不完整")
  }

  # universe = 进入检验的背景基因集(clusterProfiler 官方推荐:所有参与 DE 检验的基因,
  # 而非 OrgDb 全基因背景;否则会系统性低估富集显著性)
  tested_genes <- unique(unlist(lapply(deg_env$results_list[enrich_cnames], function(r) r$GeneSymbol)))
  universe_ids <- tryCatch({
    u <- bitr(tested_genes, fromType="SYMBOL", toType="ENTREZID", OrgDb=org_db)
    unique(u$ENTREZID)
  }, error = function(e) NULL)
  if (is.null(universe_ids) || length(universe_ids) < 10) {
    message("[WARN] 背景基因集映射失败,退回默认全基因背景")
    universe_ids <- NULL
  } else {
    message("背景基因集(universe):", length(universe_ids), "个进入检验的基因")
  }

  # 跑各数据库
  results_list <- list()

  if ("GO" %in% databases) {
    for (ont in ontologies) {
      message("  GO ", ont, "...")
      ego <- tryCatch(
        enrichGO(entrez_ids, universe=universe_ids, OrgDb=org_db, ont=ont, pvalueCutoff=p_cut, qvalueCutoff=q_cut, readable=TRUE),
        error=function(e) { message("    GO ", ont, "失败:", conditionMessage(e)); NULL }
      )
      if (!is.null(ego) && nrow(as.data.frame(ego)) > 0) {
        df <- as.data.frame(ego)
        df$Database <- paste0("GO_", ont)
        df$Ontology <- ont
        results_list[[paste0("GO_", ont)]] <- df
        write.csv(df, file.path(output_dir, paste0("Enrichment_GO_", ont, ".csv")), row.names=FALSE)
      }
    }
  }

  if ("KEGG" %in% databases) {
    message("  KEGG...")
    ekk <- tryCatch(
      enrichKEGG(entrez_ids, universe=universe_ids, organism=kegg_code, pvalueCutoff=p_cut, qvalueCutoff=q_cut),
      error=function(e) { message("    KEGG 失败:", conditionMessage(e)); NULL }
    )
    if (!is.null(ekk) && nrow(as.data.frame(ekk)) > 0) {
      # enrichKEGG 无 readable 参数,用 setReadable 转 Entrez→基因符号(发表规范)
      ekk <- tryCatch(setReadable(ekk, OrgDb=org_db),
                      error=function(e) { message("    KEGG setReadable 失败:", conditionMessage(e)); ekk })
      df <- as.data.frame(ekk)
      df$Database <- "KEGG"
      df$Ontology <- "KEGG"
      results_list[["KEGG"]] <- df
      write.csv(df, file.path(output_dir, "Enrichment_KEGG.csv"), row.names=FALSE)
    }
  }

  if ("Reactome" %in% databases && requireNamespace("ReactomePA", quietly=TRUE)) {
    message("  Reactome...")
    epr <- tryCatch(
      ReactomePA::enrichPathway(entrez_ids, universe=universe_ids, organism=reactome_org, pvalueCutoff=p_cut, qvalueCutoff=q_cut, readable=TRUE),
      error=function(e) { message("    Reactome 失败:", conditionMessage(e)); NULL }
    )
    if (!is.null(epr) && nrow(as.data.frame(epr)) > 0) {
      df <- as.data.frame(epr)
      df$Database <- "Reactome"
      df$Ontology <- "Reactome"
      results_list[["Reactome"]] <- df
      write.csv(df, file.path(output_dir, "Enrichment_Reactome.csv"), row.names=FALSE)
    }
  }

  if ("WikiPathways" %in% databases && requireNamespace("rWikiPathways", quietly=TRUE)) {
    message("  WikiPathways...")
    ewp <- tryCatch(
      enrichWP(entrez_ids, universe=universe_ids, organism=wp_org, pvalueCutoff=p_cut, qvalueCutoff=q_cut),
      error=function(e) { message("    WikiPathways 失败:", conditionMessage(e)); NULL }
    )
    if (!is.null(ewp) && nrow(as.data.frame(ewp)) > 0) {
      df <- as.data.frame(ewp)
      df$Database <- "WikiPathways"
      df$Ontology <- "WikiPathways"
      results_list[["WikiPathways"]] <- df
      write.csv(df, file.path(output_dir, "Enrichment_WikiPathways.csv"), row.names=FALSE)
    }
  }

  if (length(results_list) == 0) {
    message("[WARN] 无显著富集结果,跳过绘图")
    return(invisible(NULL))
  }

  # 合并并画条形图
  all_res <- bind_rows(results_list, .id="Source")

  # 取每类 top N
  all_res <- all_res %>%
    group_by(Database) %>%
    slice_min(p.adjust, n=top_n) %>%
    ungroup() %>%
    mutate(Description = substr(Description, 1, 60),
           Description = factor(Description, levels=rev(unique(Description))),
           neg_log10_padj = -log10(p.adjust))

  # 颜色按 Database / Ontology / -log10(padj) 连续着色(old/: 按 Database)
  db_levels <- unique(all_res$Database)
  pal_name <- o$color_palette %||% "category10_d3"
  db_cols <- setNames(get_palette(pal_name, length(db_levels)), db_levels)
  # 着色依据:database(默认,old/)/ ontology(GO 专属)/ neg_log10p(连续)
  bar_color_by <- o$bar_color_by %||% "database"
  # X 轴:count(基因数,默认,old/)/ neg_log10p(-log10(padj),发表常用)
  bar_x <- o$bar_x %||% "count"
  # neg_log10p 着色或 X 轴模式:Y 轴按 -log10p 降序(更直观)
  if (bar_color_by == "neg_log10p" || bar_x == "neg_log10p") {
    all_res <- all_res %>% arrange(Database, neg_log10_padj)
    all_res$Description <- factor(all_res$Description, levels = rev(unique(all_res$Description)))
  }
  x_var <- if (bar_x == "neg_log10p") "neg_log10_padj" else "Count"
  x_lab <- if (bar_x == "neg_log10p") "-log10(adjusted P)" else "Gene Count"

  sz <- get_size("enrich", o, n_comparisons=length(db_levels))
  if (bar_color_by == "neg_log10p") {
    # 连续着色:按 -log10(padj) 蓝绿渐变
    p <- ggplot(all_res, aes(.data[[x_var]], Description, fill = neg_log10_padj)) +
      geom_col(width = as.numeric(o$bar_width %||% 0.7)) +
      scale_fill_gradient(low = "#d4e5ff", high = "#0052d9", name = "-log10(padj)")
    lab_list <- list(fill = "-log10(padj)")
  } else if (bar_color_by == "ontology" && "Ontology" %in% colnames(all_res)) {
    # GO 本体着色
    ont_levels <- unique(all_res$Ontology)
    ont_cols <- setNames(get_palette(pal_name, length(ont_levels)), ont_levels)
    p <- ggplot(all_res, aes(.data[[x_var]], Description, fill = Ontology)) +
      geom_col(width = as.numeric(o$bar_width %||% 0.7)) +
      scale_fill_manual(values = ont_cols)
    lab_list <- list(fill = "Ontology")
  } else {
    # 默认:按 Database 着色(old/)
    p <- ggplot(all_res, aes(.data[[x_var]], Description, fill = Database)) +
      geom_col(width = as.numeric(o$bar_width %||% 0.7)) +
      scale_fill_manual(values = db_cols)
    lab_list <- list(fill = o$legend_title %||% "Database")
  }
  if (isTRUE(o$show_title %||% TRUE)) lab_list$title <- o$title %||% "Enrichment Analysis (ORA)"
  if (isTRUE(o$show_xlab %||% TRUE))  lab_list$x <- o$xlab %||% x_lab
  if (isTRUE(o$show_ylab %||% TRUE))  lab_list$y <- o$ylab %||% ""
  p <- p + do.call(labs, lab_list) + build_theme(o)
  save_ggplot(p, "enrich_barplot", width=sz$w, height=sz$h)
  message("[OK] enrich_barplot 已生成")

  # 额外:按 GO ontology 着色的版本(GO 专属)
  if ("GO" %in% databases && any(grepl("^GO_", all_res$Database))) {
    go_res <- all_res %>% filter(grepl("^GO_", Database))
    if (nrow(go_res) > 0) {
      ont_cols <- setNames(c("#E41A1C","#377EB8","#4DAF4A"), c("BP","CC","MF"))
      p2 <- ggplot(go_res, aes(Count, Description, fill=Ontology)) +
        geom_col(width=0.7) +
        scale_fill_manual(values=ont_cols) +
        labs(title="GO Enrichment", x="Gene Count", y="", fill="Ontology") +
        build_theme(o)
      save_ggplot(p2, "enrich_go_barplot", width=sz$w, height=sz$h)
      message("[OK] enrich_go_barplot 已生成")
    }
  }

  invisible(all_res)
}
