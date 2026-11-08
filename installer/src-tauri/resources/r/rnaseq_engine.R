#!/usr/bin/env Rscript
# =============================================================================
# RNA-seq 差异分析 + ComplexHeatmap 热图 (mynx GUI 引擎)
#
# 本文件是 rnaseq_DE_heatmap.R 的原样移植:第一~六部分(用户配置、工具函数、
# 数据读取与整理、差异分析、配色与热图、主流程)与参考脚本逐行一致,
# 计算方法完全以参考脚本为准。仅新增「第零部分」参数接入,把 GUI 生成的
# params.json 注入 CONFIG:
#
#   Rscript rnaseq_engine.R <params.json> [de,heatmap,plots]
#
#   1. params.json 提供全部或部分配置;缺失字段沿用下方参考脚本的默认值。
#   2. 第二个参数可选,指定步骤;默认取 params.json 的 steps,再默认全部。
#   3. 不带参数直接运行 = 参考脚本原行为(默认 CONFIG 跑全部步骤)。
#
# 结构
#   第零部分 params.json 接入 | 第一部分 用户配置 | 第二部分 工具函数
#   第三部分 数据读取与整理 | 第四部分 差异分析 | 第五部分 配色与热图
#   第六部分 主流程
# =============================================================================

# =============================================================================
# 第零部分:params.json → CONFIG(GUI 注入;无参数时跳过,保持参考脚本原行为)
# =============================================================================
.args <- commandArgs(trailingOnly = TRUE)
.params_file <- if (length(.args) >= 1 && nzchar(.args[1]) && file.exists(.args[1])) .args[1] else NULL
.steps_cli   <- if (length(.args) >= 2 && nzchar(.args[2])) strsplit(.args[2], ",")[[1]] else NULL

# ─── 字符串环境:确保 UTF-8 ─────────────────────────────────────────────────
# Git Bash 等环境注入的 LC_CTYPE/LANG=C.UTF-8 在 Windows 上不可用,R 启动时
# 回落到 C locale:中文字符串会被写成 <U+XXXX> 转义或 GBK 字节(写 CSV、
# 热图标签、日志全部受影响)。这里按系统 locale 名把 LC_CTYPE 切到 UTF-8。
if (.Platform$OS.type == "windows" && !isTRUE(l10n_info()$`UTF-8`)) {
  .locale_name <- tryCatch(
    as.character(readRegistry("Control Panel\\International", "HCU")$LocaleName),
    error = function(e) NULL)
  .utf8_candidates <- c("UTF-8",
                        if (length(.locale_name)) paste0(.locale_name, ".utf8"),
                        "Chinese (Simplified)_China.utf8",
                        "English_United States.utf8")
  for (.loc in .utf8_candidates) {
    if (is.null(.loc) || is.na(.loc)) next
    .ok <- tryCatch({
      suppressWarnings(Sys.setlocale("LC_CTYPE", .loc))
      isTRUE(l10n_info()$`UTF-8`)
    }, error = function(e) FALSE)
    if (isTRUE(.ok)) break
  }
}

config_from_json <- function(path) {
  txt <- paste(readLines(path, warn = FALSE, encoding = "UTF-8"), collapse = "\n")
  x <- jsonlite::fromJSON(txt, simplifyVector = TRUE, simplifyDataFrame = FALSE,
                          simplifyMatrix = FALSE)
  vec <- function(v) if (is.null(v)) NULL else as.character(unlist(v, use.names = FALSE))
  named_chr <- function(v) {                       # 命名对象 → 命名字符向量
    if (is.null(v)) return(NULL)
    v <- unlist(v, use.names = TRUE)
    if (length(v) == 0) return(NULL)
    nm <- names(v)                                 # R >= 4.5 的 as.character 会丢名字,先取出
    if (!is.null(nm)) {
      nm <- trimws(nm)
      if (all(is.na(nm) | !nzchar(nm))) nm <- NULL
    }
    out <- as.character(v)
    if (!is.null(nm)) names(out) <- nm
    out[nzchar(out)]
  }
  named_list_vec <- function(l) {                  # {簇名: [基因...]} → list(簇名 = c(...))
    if (is.null(l) || !is.list(l) || !length(l)) return(NULL)
    l <- as.list(l)
    l <- l[vapply(l, function(z) length(unlist(z, use.names = FALSE)) > 0, logical(1))]
    if (!length(l)) return(NULL)
    lapply(l, function(z) as.character(unlist(z, use.names = FALSE)))
  }
  list_of_jobs <- function(v) {                    # [job, ...] → list(job, ...)
    if (is.null(v) || !length(v) || !is.list(v)) return(NULL)
    jobs <- unname(v)
    if (!all(vapply(jobs, is.list, logical(1)))) jobs <- list(v)   # 单个 job 对象
    if (!all(vapply(jobs, is.list, logical(1)))) return(NULL)
    jobs
  }
  cfg <- list(
    output_dir        = x$output_dir,
    steps             = vec(x$steps),
    sample_labels     = named_chr(x$sample_labels),
    overall_genes     = vec(x$overall_genes),
    gene_clusters     = named_list_vec(x$gene_clusters),
    input             = x$input,
    groups            = named_list_vec(x$groups),
    batch             = named_list_vec(x$batch),
    de                = x$de,
    comparisons       = list_of_jobs(x$comparisons),
    heatmap           = x$heatmap,
    overall_heatmap   = x$overall_heatmap,
    selected_heatmaps = list_of_jobs(x$selected_heatmaps),
    plots             = x$plots
  )
  cfg[vapply(cfg, is.null, logical(1))] <- NULL
  cfg
}

merge_ui_config <- function(CONFIG, ui) {
  replace_keys <- c("output_dir", "steps", "sample_labels", "overall_genes",
                    "gene_clusters", "groups", "batch", "comparisons", "selected_heatmaps")
  merge_keys  <- c("input", "de", "heatmap", "overall_heatmap")
  for (nm in intersect(replace_keys, names(ui))) CONFIG[[nm]] <- ui[[nm]]
  for (nm in intersect(merge_keys, names(ui))) {
    if (is.null(CONFIG[[nm]])) CONFIG[[nm]] <- list()
    CONFIG[[nm]] <- modifyList(CONFIG[[nm]], ui[[nm]])
  }
  if (!is.null(ui$plots)) {                        # pca 任务列表整体替换,不与默认按名合并
    p <- ui$plots; pca <- p$pca; p$pca <- NULL
    CONFIG$plots <- if (is.null(CONFIG$plots)) list() else CONFIG$plots
    CONFIG$plots <- modifyList(CONFIG$plots, p)
    if (!is.null(pca)) CONFIG$plots$pca <- pca
  }
  # 两类基因列表映射到对应的图(与参考脚本 CONFIG 的引用方式一致)
  if (!is.null(ui$overall_genes) &&
      (is.null(CONFIG$overall_heatmap$marker_genes) || !length(CONFIG$overall_heatmap$marker_genes)))
    CONFIG$overall_heatmap$marker_genes <- ui$overall_genes
  if (!is.null(ui$gene_clusters)) {
    for (i in seq_along(CONFIG$selected_heatmaps)) {
      job <- CONFIG$selected_heatmaps[[i]]
      if (is.null(job$gene_groups) && is.null(job$genes) && is.null(job$gene_file))
        CONFIG$selected_heatmaps[[i]]$gene_groups <- ui$gene_clusters
    }
  }
  CONFIG
}

# =============================================================================
# 第一部分:用户配置(换项目时主要改这里)
# =============================================================================
# -----------------------------------------------------------------------------
# 【两类基因列表完全独立,分开设置】
#
# (A) overall_genes:整体热图的基因列表 —— 平铺的基因向量,不分类、直接写基因。
#     决定整体热图左侧标出哪些基因名;与下面的 gene_clusters 无任何关系。
#     写成 c("A","B",...) 即可,顺序不影响结果(整体热图按聚类重排)。
#
# (B) gene_clusters:选定基因热图的基因簇 —— 簇名 = 基因向量,可写 1 个到几十个簇。
#     选中热图用 gene_groups = gene_clusters 引用;图中按这里的顺序分成若干块,
#     options$cluster_rows = FALSE 时块内也严格按你写的顺序。
# -----------------------------------------------------------------------------
overall_genes <- c(
                    "RPE65", "MITF", "BEST1", "NANOG", 
                    "SOX2", "POU5F1", "PAX6", "PMEL", "RAX",
                    "TYR", "OTX2", "TYRP1", "MERTK", 
                    "LHX2", "VSX2", "DCT", "RLBP1"
)

# 注释只是给人看的分行,脚本不解析注释 —— 想加/删基因直接改上面的向量
gene_clusters <- list(
  "Transcription"   = c("MITF", "OTX2", "PAX6", "RAX"),
  "Melanogenesis"   = c("TYR", "TYRP1", "PMEL", "MLANA"),
  "Visual_Cycle"    = c("RPE65", "RDH5", "RLBP1"),
  "Phagocytosis"    = c("MERTK", "ITGAV"),
  "Ion_Transport"   = c("BEST1", "ATP1A1"),
  "Tight_Junctions" = c("TJP1", "AQP1"),
  "Cytoskeleton"    = c("EZR"),
  "Secreted"        = c("SERPINF1", "VEGFA")
)

# -----------------------------------------------------------------------------
# 自定义样本显示名:原始列名 = 显示名
# 热图横坐标、样本相关性热图、PCA 点标签都用它;没写到的样本仍显示原始列名。
# 单张图想用不同的名字,可在该图自己的 column_labels / sample_labels 里覆盖。
# -----------------------------------------------------------------------------
sample_labels <- c(
  "iPSC_01_02" = "iPSC",
  "CX2_7"      = "iRPE D28",
  "CX2_3"      = "iRPE D42"
)

CONFIG <- list(

  output_dir = "results",                  # 输出目录
  sample_labels = sample_labels,           # 见上方 sample_labels

  ## ---- 输入计数文件 -------------------------------------------------------
  input = list(
    count_file      = "gene.count.csv",    # 第一列为基因名,其余列为样本(.csv 或 .tsv/.txt)
    gene_col        = 1,                   # 基因名所在列(序号或列名)
    drop_empty_gene = TRUE,                # 丢弃基因名为空/NA 的行
    duplicate_genes = "sum",               # 重名基因处理: sum(原始计数相加) | max_mean(留均值最大行) | make_unique(改名保留)
    rounding        = "round"              # 计数取整: round(四舍五入,0.5向上) | floor | ceiling
  ),

  ## ---- 分组:组名 = 样本名向量 或 正则表达式 ---------------------------------
  # 组名可含空格;样本写精确列名即可(也可写正则,如 "^CX2_" 匹配所有以 CX2_ 开头的列)
  # 未被任何组包含的样本会被忽略;同一样本不能属于多个组;组的顺序决定图中的顺序
  groups = list(
    "iPSC"     = c("iPSC_01_02"),
    "iRPE D28" = c("CX2_7"),
    "iRPE D42" = c("CX2_3")
  ),

  ## ---- 批次(可选):批次名 = 样本名/正则;不用就设为 NULL ---------------------
  # 一旦设置,所有参与分组的样本都必须属于某个批次。仅"有重复"路径会用它做协变量。
  batch = NULL,
  # batch = list(b1 = c("^CX[23]_[0-9]*[02468]$", "^ESC_H1$"),
  #              b2 = "^CX[23]_[0-9]*[13579]$"),

  ## ---- 差异分析全局参数(单个比较里可覆盖) -----------------------------------
  de = list(
    method    = "deseq2",     # 有重复路径的方法: deseq2 | edger
    padj      = 0.05,         # 显著性阈值(校正后 P / FDR)
    log2fc    = 1,            # Up/Down 判定的 |log2FC| 阈值
    bcv       = 0.4,          # 无重复路径用的生物学变异系数: 人 0.4 | 同基因型模式生物 0.1 | 技术重复 0.01
    shrink    = "none",       # DESeq2 的 log2FC 收缩: none | apeglm | ashr(需另装包)
    use_batch = TRUE,         # 有 batch 时是否放进设计矩阵
    filter    = list(method = "filterByExpr",  # 低表达过滤: filterByExpr | min_count | none
                     min_count = 10, min_total_count = 15, min_samples = 2)
  ),

  ## ---- 比较列表:case 相对 control 计算 log2FC ---------------------------------
  # name 用作输出文件名(建议不含空格);case / control 写上面 groups 里的组名
  # mode 默认 auto: 两组都 >=2 个样本 -> 有重复路径; 任一组只有 1 个 -> 无重复路径(固定 BCV)
  # 可强制 mode = "replicate" / "noreplicate";也可在此处覆盖 de 里的任何参数(如 bcv、padj)
  # 目前每组都只有 1 个样本,三个比较都走无重复路径,P 值只能用于探索性排序
  comparisons = list(
    list(name = "iRPE_D28_vs_iPSC", case = "iRPE D28", control = "iPSC"),
    list(name = "iRPE_D42_vs_iPSC", case = "iRPE D42", control = "iPSC"),
    list(name = "iRPE_D42_vs_D28",  case = "iRPE D42", control = "iRPE D28")
  ),
  ## ---- 热图通用样式(每张图可在 options 里覆盖) --------------------------------
  # 样本顺序:严格按脚本里 groups 的顺序(组内按原表列顺序),或按 samples 里你写的顺序;
  #          只有把 cluster_columns 设为 TRUE 时才会按相似度重新排列样本。
  heatmap = list(
    transform       = "vst",       # 画图用的表达量: vst | logcpm
    scale           = "row",       # row(按行 Z-score) | none
    palette         = "RdBu",      # 连续色板: 任意 RColorBrewer / viridis / hcl.pals() 名称
    reverse_palette = TRUE,        # RdBu 默认蓝->红,翻转后红=高表达
    zlim            = 2,           # Z-score 色阶范围 [-zlim, zlim]
    group_palette      = "Set2",   # 样本分组颜色(RColorBrewer 等)
    gene_group_palette = "Dark2",  # 基因簇颜色(簇多于 8 个时自动插值,可换成 "Paired" 等更多色的色板)
    group_colors    = NULL,        # 个别分组/簇手动指定颜色,如 c(CX2 = "#E41A1C")
    cluster_rows    = TRUE,        # 行(基因)聚类:簇内重排基因;FALSE = 保持给定的基因顺序
    cluster_columns = FALSE,       # 列(样本)聚类:FALSE = 保持脚本里的样本顺序
    row_distance    = "pearson",   # pearson | spearman | euclidean ...
    column_distance = "euclidean",
    cluster_method  = "ward.D2",
    column_split_by_group = FALSE, # TRUE: 按样本分组切分列
    show_row_dend    = FALSE,       # 是否画行聚类树的线条(聚类仍生效,只是不画树)
    show_column_dend = FALSE,       # 是否画列聚类树的线条
    border           = FALSE,       # 是否给每个热图块(每个基因簇/列分组)画外框线
    column_names_rot  = 0,        # 样本名旋转角度: 0 水平 | 45 | 90 竖排 ...
    column_names_side = "top",    # 样本名位置: top(三张热图都在顶部) | bottom;单张图可在 options 里覆盖
    group_bar_height  = 1,         # 纵向色块(顶部「样本分组」条)的粗细,单位毫米;0.5 = 极细,10 = 很粗
    cluster_bar_width = 5,         # 横向色块(「基因簇」条,左右两侧)的粗细,单位毫米
    bar_thickness     = NULL,      # 一次性设定上面两种色块的粗细(毫米);非 NULL 时两者都等于它
    cluster_bar_side  = "left",    # 「基因簇」色块放哪一侧: left | right;簇名(C1..Ck)跟随色块
    row_title_side    = NULL,      # 簇名位置(NULL = 跟随色块;也可强制 "left" / "right")
    row_title_rot     = 0,         # 簇名旋转角度: 0 水平 | 90 竖排(簇名长或右侧空间紧时用)
    cluster_title_w_mm = 8,        # 簇名在右侧时预留的宽度(毫米);名字长可调大
    show_row_names  = NULL,        # NULL = 自动(<=80 行才显示基因名)
    show_row_title  = TRUE,        # 簇名(基因分组名,如 Transcription)是否写在行切分标题处;FALSE = 不显示
    row_names_italic = TRUE,       # 基因名是否斜体(热图行名、左侧标记基因名)
    show_column_names = TRUE,
    show_annotation_name = FALSE,  # 顶部色块旁的注释名(Group / Batch);FALSE = 不写文字,只留色块
    group_legend_title   = "",     # 图例里分组色块的标题(NULL = 「Group」;"" = 标题也不显示,只留色块+组名)
    show_title      = FALSE,       # 热图顶部标题(整体热图是「N genes」,选定热图是图的标题);FALSE = 都不写
    show_batch      = TRUE,        # 有批次时是否加批次注释条
    font_size       = 9,
    max_cluster_rows  = 5000,      # 基因数超过它就不做全量层次聚类(全基因组热图用),改走"分块+块内聚类"
    n_fine_blocks     = NULL,      # 分块聚类的细分块数(NULL = 自动,约 sqrt(基因数/10),上限 60)
    marker_font_size  = 8,         # 左侧标记基因名的字号
    width = NULL, height = NULL,   # 英寸; NULL = 自动(按基因数算)。想看更高/更矮的图就填数字,如 height = 18
    row_mm = NULL,                 # 每行基因占多少毫米;设了就按 基因数 x row_mm 自动算高度,优先于 height
                                   # 例:16804 个基因写 row_mm = 0.035 -> 约 23 英寸
    formats = "png", dpi = 600,    # 只输出 png(需要 pdf 时改为 c("png", "pdf"));dpi 600 更细腻、文件更大
    # 栅格化:基因很多时 ComplexHeatmap 把热图块画成位图,行数远多于像素就会出现「空白横纹」
    use_raster     = NULL,         # NULL = 自动(行数 > 2000 用栅格);FALSE = 矢量绘制(可能出现细白缝)
    raster_quality = 1             # 超采样倍数(1~5):调到 3 可明显减轻横纹,输出文件大小基本不变
  ),

  ## ---- 整体(全基因组)热图 ---------------------------------------------------
  # top_n: 画多少个基因(按方差从大到小取);写 "all" 则画全部基因(见下方 expressed_only)
  #        基因超过 options$max_cluster_rows(默认 5000)时不做全量层次聚类(需 N x N 距离矩阵),
  #        改走"k-means 分块 + 块内聚类";5000 以内则直接全量 hclust
  # expressed_only: TRUE 先用 filterByExpr 去掉低表达基因; FALSE 保留所有至少有一个样本表达的基因
  # marker_genes: 整体热图自己的基因列表(平铺向量,不分组),写在文件顶部的 overall_genes。
  #        只影响整体热图左侧标出的基因名,与选定热图用的 gene_clusters 互不影响;
  #        不在所选基因里的会自动加入(marker_add_missing = FALSE 可关闭)
  # samples: 画哪些样本/分组,顺序即图中顺序(NULL = groups 里的全部)
  # column_labels: 样本名 -> 显示名(NULL = 用上面的 sample_labels)
  # n_clusters: 把基因聚成几个簇并用色块标出,写几就是几(NULL = 不分簇);簇名 C1..Ck
  # 色块位置: 默认在热图左侧;设 options = list(cluster_bar_side = "right") 则色块移到热图右侧,
  #           簇名(C1..Ck)跟着一起移到右侧;想让簇名留在左侧就写 row_title_side = "left"
  #           宽度不够时可用 options = list(width = 8) 手动指定画布宽度(英寸),右移后的色块会自动算进去
  #
  # ★ 手动控制热图高度(两种写法,写在 options 里):
  #   1) row_mm:每个基因占多少毫米 —— 推荐,换基因数时整张图等比缩放,不会把行压扁
  #        options = list(row_mm = 0.035)   # 16804 个基因 -> 约 23 英寸高
  #   2) height:直接给整张图的高度(英寸),不随基因数变化
  #        options = list(height = 18)      # 固定 18 英寸
  #   两个都写时 row_mm 优先。都不写则自动按基因数计算(见 default_size)
  #
  # options: 只覆盖这张图的样式,如 list(column_names_rot = 45, group_bar_height = 8, marker_font_size = 7)
  overall_heatmap = list(
    enabled     = TRUE,
    name        = "overall",       # 输出文件名后缀
    gene_source = "variable",      # variable(按方差取基因) | deg(差异基因并集,需先跑 de 步骤)
    top_n       = "all",            # variable: 取前多少个基因;"all" = 全部
    expressed_only = TRUE,         # variable: 是否先过滤低表达基因
    comparisons = NULL,            # deg: 用哪些比较的结果, NULL = 全部
    max_genes   = 2000,            # deg: 最多画多少个基因(按 padj 排序截取)
    marker_genes = overall_genes,   # 整体热图专用基因列表(见顶部 overall_genes),不分类
    marker_add_missing = TRUE,
    samples = NULL, column_labels = NULL, n_clusters = 3,
    options = list(cluster_bar_side = "right", height = 8, width = 5,
                   show_annotation_name = FALSE, show_title = FALSE,
                   raster_quality = 3),   # 3 = 超采样,消除 16804 行挤在 2400 像素里的横纹;嫌慢可降到 2
    sample_correlation  = TRUE,    # 是否同时输出样本相关性热图
    correlation_palette = "YlOrRd",
    correlation_size    = NULL,    # 相关性热图尺寸(英寸),c(宽, 高),如 c(3.2, 3);NULL = 按样本数自动(3~7 英寸)
    correlation_show_annotation_name = FALSE    # 顶部色块旁是否写「Group」;想显示改 TRUE
  ),

  ## ---- 选定基因热图(可写多张) -------------------------------------------------
  # 基因来源可组合: genes(平铺) / gene_groups(分组,行按簇切分) / gene_file(csv: 第1列基因,第2列分组可选)
  # 没写分组时可用 n_clusters = k 自动聚成 k 个簇
  # samples: 组名或样本名,顺序即图中顺序(NULL = 全部); column_labels: 样本名 -> 显示名(NULL = 用 sample_labels)
  # 基因名先精确匹配,再不区分大小写匹配,找不到的会警告并跳过
  # options 里的线条/粗细开关:
  #   cluster_rows / cluster_columns   : 是否聚类(FALSE = 保持你给定的基因顺序 / 样本顺序)
  #   show_row_dend / show_column_dend : 是否画聚类树的线条
  #   border                           : 是否给每个基因簇画外框线
  #   column_names_rot / group_bar_height / cluster_bar_width : 样本名角度 / 两种色块的粗细
  #   cluster_bar_side                 : 基因簇色块放哪一侧 left | right
  selected_heatmaps = list(
    list(name = "gene_clusters", title = "RPE gene clusters",
         gene_groups = gene_clusters,
         samples = NULL, column_labels = NULL,
         options = list(cluster_rows = FALSE, cluster_columns = FALSE,
                        show_row_dend = TRUE, show_column_dend = TRUE,
                        border = FALSE,          # 不画每个基因簇的黑色外框
                        show_row_title = FALSE,  # 不写左侧簇名(Transcription / Melanogenesis ...)
                        width = 4.5))            # 选定基因热图画布宽度(英寸);NULL = 自动(约 5.9);调小即变窄
  ),

  ## ---- PCA 与火山图(有/无重复均可;只输出 png;ggplot2 bw 风格) -----------------
  # 风格: Arial、基础字号 base_size(pt)、theme_bw 边框与网格、NPG 配色;尺寸用毫米
  #       (Nature 栏宽: 单栏 89 mm, 1.5 栏 120 mm, 双栏 183 mm)。font_family 需是系统已装字体。
  # PCA: 用与热图相同的 vst 表达量,取所选样本中方差最大的 ntop 个基因;可写多个任务
  #   坐标轴以 0 为中心(x、y 各取对称范围),并画 0 点虚线;分组配色默认 NPG(group_palette)
  #   samples: 组名或样本名(NULL = 全部); pcs: 画哪两个主成分; label_samples: 点旁标样本名
  #   sample_labels: 样本名 -> 显示名(NULL = 用上面的 sample_labels); ellipse: 组内 >=4 个样本时画 95% 置信椭圆
  #   width_mm / height_mm: 图尺寸(毫米)
  # 火山图: 读取 DE/ 目录里的差异结果,横轴 log2FC,纵轴 -log10(校正后 P),虚线为阈值;绘图区为正方形
  #   comparisons: 画哪些比较(NULL = 全部); label_top: 标注最显著的 N 个基因(斜体);
  #   label_genes: 指定要标注的基因(设置后忽略 label_top); up_color/down_color/ns_color: 手动指定颜色
  #   show_subtitle: 是否写副标题(方法 + 阈值 + 无重复提示);默认 FALSE,只保留图标题
  plots = list(
    formats = "png", dpi = 300,
    font_family = "Arial", base_size = 7, group_palette = "npg",   # 7 pt:再小的话缩略图/幻灯片里笔画会掉
    plot_pad_mm = 2,             # 画布四周留白(毫米);文字离图边至少这么远,任何看图软件都不会切到字
    label_halo  = TRUE,          # 样本名/基因名标签加白色衬底,压在点上也不会被盖住笔画
    legend_gap_mm = 0.8,         # PCA 图例:彩色点右缘到文字左缘的间距(毫米);0 = 完全贴住
    pca = list(
      list(name = "PCA_selected", samples = NULL, ntop = 500, pcs = c(1, 2),
           label_samples = TRUE, sample_labels = NULL, ellipse = FALSE,
           legend_pos = "right",                  # 图例在右侧竖排(right | bottom | top | none)
           square_panel = TRUE,                   # TRUE = 坐标框正方形(只框是方的,整张图仍是矩形)
           width_mm = 76, height_mm = 62)         # 画布上限;实际高度会按内容自动收紧,不留空白
    ),
    volcano = list(
      enabled = TRUE, comparisons = NULL, label_top = 10, label_genes = NULL,
      point_size = 0.5, width_mm = 78, height_mm = 70,   # 画布上限;图例在右侧竖排,所以宽度比原来大
      legend_pos = "right",                              # 图例在右侧竖排(top/bottom 时自动改成一行)
      show_subtitle = FALSE                              # TRUE = 恢复方法/阈值那两行副标题
    )
  )
)

# ─── GUI params.json 注入(存在则覆盖/合并上方默认 CONFIG)──────────────────────
if (!is.null(.params_file)) {
  tryCatch({
    CONFIG <- merge_ui_config(CONFIG, config_from_json(.params_file))
    message(sprintf("[engine] params.json loaded: %s", normalizePath(.params_file, mustWork = FALSE)))
  }, error = function(e) stop("params.json 解析失败: ", conditionMessage(e), call. = FALSE))
}

# =============================================================================
# 第二部分:工具函数(日志、依赖检查、通用小函数)
# =============================================================================
.tk <- new.env()                 # 保存本次运行的日志文件路径
.tk$log_file <- NULL

# 同时输出到屏幕和日志文件
msg <- function(..., level = "INFO") {
  line <- sprintf("[%s][%s] %s", format(Sys.time(), "%H:%M:%S"), level, paste0(...))
  message(line)
  if (!is.null(.tk$log_file)) cat(line, "\n", file = .tk$log_file, append = TRUE, sep = "")
  invisible(line)
}
warn <- function(...) msg(..., level = "WARN")

ensure_dir <- function(...) {
  d <- file.path(...)
  if (!dir.exists(d)) dir.create(d, recursive = TRUE, showWarnings = FALSE)
  d
}
write_table <- function(df, file) {
  utils::write.csv(df, file, row.names = FALSE, fileEncoding = "UTF-8")
  invisible(file)
}

# edgeR >= 4.4 把 calcNormFactors 改名为 normLibSizes,这里两种版本都兼容
norm_lib <- function(y) {
  if (exists("normLibSizes", envir = asNamespace("edgeR"), inherits = FALSE)) edgeR::normLibSizes(y)
  else edgeR::calcNormFactors(y)
}

# 检查依赖包;缺包时直接给出安装命令,不自动安装
check_dependencies <- function(cfg) {
  req <- c("DESeq2", "edgeR", "SummarizedExperiment", "matrixStats",
           "ComplexHeatmap", "circlize", "RColorBrewer", "viridisLite", "ggplot2", "ggrepel",
           "ragg")     # ragg:出图用,灰度抗锯齿文字;缺了会退回 cairo(字有彩边)
  if (cfg$de$shrink %in% c("apeglm", "ashr")) req <- c(req, cfg$de$shrink)
  miss <- req[!vapply(req, requireNamespace, logical(1), quietly = TRUE)]
  if (length(miss)) {
    bioc <- intersect(miss, c("DESeq2", "edgeR", "SummarizedExperiment", "ComplexHeatmap", "apeglm"))
    cran <- setdiff(miss, bioc)
    hint <- c(if (length(cran)) sprintf("install.packages(c(%s))", paste0('"', cran, '"', collapse = ", ")),
              if (length(bioc)) sprintf("BiocManager::install(c(%s))", paste0('"', bioc, '"', collapse = ", ")))
    stop("Missing R packages: ", paste(miss, collapse = ", "), "\nInstall with:\n  ",
         paste(hint, collapse = "\n  "), call. = FALSE)
  }
  suppressPackageStartupMessages({ library(DESeq2); library(edgeR); library(ComplexHeatmap) })
  invisible(TRUE)
}

# =============================================================================
# 第三部分:数据读取与整理(读计数 -> 去空名 -> 合并重名 -> 取整 -> 分组表)
# =============================================================================

read_counts <- function(cfg) {
  inp  <- cfg$input
  file <- inp$count_file
  if (!file.exists(file)) stop("Count file not found: ", file, call. = FALSE)
  sep <- if (grepl("\\.(tsv|txt)(\\.gz)?$", file, ignore.case = TRUE)) "\t" else ","
  df  <- utils::read.table(file, header = TRUE, sep = sep, quote = "\"", comment.char = "",
                           check.names = FALSE, stringsAsFactors = FALSE, fileEncoding = "UTF-8-BOM")
  gcol <- inp$gene_col
  if (is.character(gcol)) gcol <- match(gcol, colnames(df))
  if (is.na(gcol) || gcol < 1 || gcol > ncol(df)) stop("input$gene_col not found in count file", call. = FALSE)
  genes <- trimws(as.character(df[[gcol]]))
  mat   <- as.matrix(df[, -gcol, drop = FALSE])
  if (!is.numeric(mat)) stop("Non-numeric values in count columns", call. = FALSE)
  if (anyNA(mat)) { warn("NA counts found; set to 0"); mat[is.na(mat)] <- 0 }
  if (any(mat < 0)) stop("Negative counts found", call. = FALSE)
  msg("Read ", nrow(mat), " rows x ", ncol(mat), " samples from ", basename(file))
  list(genes = genes, mat = mat)
}

# 取整:DESeq2/edgeR 要求整数计数。默认 floor(x+0.5),即常规四舍五入(R 自带 round 是"银行家舍入")
round_counts <- function(mat, how = "round") {
  out <- switch(how,
                round = floor(mat + 0.5), floor = floor(mat), ceiling = ceiling(mat),
                stop("input$rounding must be round | floor | ceiling", call. = FALSE))
  n_changed <- sum(mat != out)
  msg("Rounding (", how, "): ", n_changed, " of ", length(mat), " cells changed (",
      sprintf("%.1f", 100 * n_changed / length(mat)), "%)")
  out
}

# 返回以基因名为行名的整数矩阵。顺序:去空名 -> 合并重名(在原始计数上) -> 取整
clean_counts <- function(cfg) {
  inp <- cfg$input
  x <- read_counts(cfg)
  genes <- x$genes; mat <- x$mat

  bad <- is.na(genes) | genes == ""
  if (any(bad)) {
    if (isTRUE(inp$drop_empty_gene)) {
      msg("Dropping ", sum(bad), " rows with empty gene name")
      genes <- genes[!bad]; mat <- mat[!bad, , drop = FALSE]
    } else genes[bad] <- paste0("unnamed_", seq_len(sum(bad)))
  }

  dup <- duplicated(genes) | duplicated(genes, fromLast = TRUE)
  if (any(dup)) {
    how <- inp$duplicate_genes
    msg("Duplicate gene names: ", length(unique(genes[dup])), " names in ", sum(dup), " rows; strategy = ", how)
    if (how == "sum") {
      mat <- rowsum(mat, group = genes, reorder = FALSE)            # 同名行原始计数相加
    } else if (how == "max_mean") {
      keep <- tapply(seq_along(genes), genes, function(i) i[which.max(rowMeans(mat[i, , drop = FALSE]))])
      keep <- sort(unlist(keep)); mat <- mat[keep, , drop = FALSE]; rownames(mat) <- genes[keep]
    } else if (how == "make_unique") {
      rownames(mat) <- make.unique(genes, sep = "_dup")
    } else stop("input$duplicate_genes must be sum | max_mean | make_unique", call. = FALSE)
  } else rownames(mat) <- genes

  mat <- round_counts(mat, inp$rounding)
  storage.mode(mat) <- "integer"
  msg("Final matrix: ", nrow(mat), " genes x ", ncol(mat), " samples; ",
      sum(rowSums(mat) == 0), " all-zero genes kept (filtered later per analysis)")
  mat
}

# 配置里的样本描述:先尝试当作精确样本名,否则当作正则表达式
match_samples <- function(spec, all_samples, what = "group") {
  spec <- as.character(unlist(spec))
  hit <- if (all(spec %in% all_samples)) spec else grep(paste(spec, collapse = "|"), all_samples, value = TRUE)
  if (!length(hit)) stop("No samples matched for ", what, ": ", paste(spec, collapse = ", "), call. = FALSE)
  hit
}

# 生成样本表(sample, group, [batch]),组的顺序即配置里的顺序
build_sample_table <- function(cfg, all_samples) {
  if (is.null(cfg$groups) || !length(cfg$groups)) stop("CONFIG must define `groups`", call. = FALSE)
  rows <- lapply(names(cfg$groups), function(g)
    data.frame(sample = match_samples(cfg$groups[[g]], all_samples, paste0("group '", g, "'")),
               group = g, stringsAsFactors = FALSE))
  st <- do.call(rbind, rows)
  dups <- st$sample[duplicated(st$sample)]
  if (length(dups)) stop("Samples assigned to more than one group: ", paste(unique(dups), collapse = ", "), call. = FALSE)
  st$batch <- NA_character_
  for (b in names(cfg$batch)) {
    s <- match_samples(cfg$batch[[b]], all_samples, paste0("batch '", b, "'"))
    st$batch[st$sample %in% s] <- b
  }
  if (all(is.na(st$batch))) st$batch <- NULL
  else if (anyNA(st$batch)) stop("`batch` is defined but some samples have no batch: ",
                                 paste(st$sample[is.na(st$batch)], collapse = ", "), call. = FALSE)
  unused <- setdiff(all_samples, st$sample)
  if (length(unused)) msg("Samples not in any group (ignored): ", paste(unused, collapse = ", "))
  rownames(st) <- st$sample
  st$group <- factor(st$group, levels = names(cfg$groups))
  st
}

# =============================================================================
# 第四部分:差异分析
#   三个统计引擎(统一输入输出)+ 比较调度
#   引擎输入: counts(仅两组样本的整数矩阵), grp(因子, 水平固定为 Control/Case,
#             用内部标签可避免组名含特殊字符时设计公式出错), batch, de 参数
#   引擎输出: data.frame(gene, ave_expr, log2FC, pvalue, padj)
# =============================================================================

# 低表达基因过滤(默认 edgeR::filterByExpr)
filter_genes <- function(counts, grp, f, design = NULL) {
  keep <- switch(f$method,
    filterByExpr = {
      y <- edgeR::DGEList(counts, group = grp)
      if (is.null(design)) edgeR::filterByExpr(y, group = grp, min.count = f$min_count,
                                               min.total.count = f$min_total_count)
      else edgeR::filterByExpr(y, design = design, min.count = f$min_count,
                               min.total.count = f$min_total_count)
    },
    min_count = rowSums(counts >= f$min_count) >= f$min_samples,
    none      = rep(TRUE, nrow(counts)),
    stop("de$filter$method must be filterByExpr | min_count | none", call. = FALSE))
  if (sum(keep) < 10) stop("Only ", sum(keep), " genes pass the expression filter", call. = FALSE)
  keep
}

# 批次与分组完全混杂时设计矩阵不满秩,此时舍弃批次项并警告
usable_batch <- function(grp, batch, use) {
  if (is.null(batch) || !isTRUE(use)) return(NULL)
  batch <- droplevels(factor(batch))
  if (nlevels(batch) < 2) return(NULL)
  d <- model.matrix(~ batch + grp)
  if (qr(d)$rank < ncol(d)) { warn("Batch is confounded with group in this comparison; batch term dropped"); return(NULL) }
  batch
}

# ---- 引擎 1:DESeq2(有重复,Wald 检验) ----
de_deseq2 <- function(counts, grp, batch, de) {
  cd <- data.frame(group = grp, row.names = colnames(counts))
  if (!is.null(batch)) cd$batch <- batch
  design <- if (is.null(batch)) ~ group else ~ batch + group
  keep <- filter_genes(counts, grp, de$filter, model.matrix(design, cd))
  dds <- DESeq2::DESeqDataSetFromMatrix(counts[keep, ], cd, design)
  dds <- tryCatch(DESeq2::DESeq(dds, quiet = TRUE), error = function(e) {
    warn("Parametric dispersion fit failed (", conditionMessage(e), "); retrying with fitType='local'")
    DESeq2::DESeq(dds, fitType = "local", quiet = TRUE)
  })
  res <- DESeq2::results(dds, contrast = c("group", "Case", "Control"), alpha = de$padj)
  lfc_raw <- res$log2FoldChange
  if (!identical(de$shrink, "none"))
    res <- DESeq2::lfcShrink(dds, coef = "group_Case_vs_Control", type = de$shrink, res = res, quiet = TRUE)
  out <- data.frame(gene = rownames(res), ave_expr = res$baseMean, log2FC = res$log2FoldChange,
                    pvalue = res$pvalue, padj = res$padj, stringsAsFactors = FALSE)
  if (!identical(de$shrink, "none")) out$log2FC_unshrunk <- lfc_raw
  attr(out, "norm") <- DESeq2::counts(dds, normalized = TRUE)
  attr(out, "norm_label") <- "mean_normalized_count"
  out
}

# ---- 引擎 2:edgeR 拟似然 F 检验(有重复) ----
de_edger_qlf <- function(counts, grp, batch, de) {
  cd <- data.frame(group = grp, row.names = colnames(counts))
  if (!is.null(batch)) cd$batch <- batch
  design <- model.matrix(if (is.null(batch)) ~ group else ~ batch + group, cd)
  y <- edgeR::DGEList(counts, group = grp)
  y <- y[filter_genes(counts, grp, de$filter, design), , keep.lib.sizes = FALSE]
  y <- norm_lib(y)
  y <- edgeR::estimateDisp(y, design)
  fit <- edgeR::glmQLFit(y, design, robust = TRUE)
  tt  <- edgeR::topTags(edgeR::glmQLFTest(fit, coef = "groupCase"), n = Inf, sort.by = "none")$table
  out <- data.frame(gene = rownames(tt), ave_expr = 2^tt$logCPM, log2FC = tt$logFC,
                    pvalue = tt$PValue, padj = tt$FDR, stringsAsFactors = FALSE)
  attr(out, "norm") <- edgeR::cpm(y)
  attr(out, "norm_label") <- "mean_cpm"
  out
}

# ---- 引擎 3:edgeR exactTest + 固定离散度(无重复路径) ----
# 任一组只有 1 个样本时无法从数据估计变异,按 edgeR 用户手册"无重复"一节的做法,
# 使用人为指定的 BCV(dispersion = bcv^2)。得到的 P 值只能用于探索性排序,不能当严格统计显著性。
de_edger_noreplicate <- function(counts, grp, de) {
  y <- edgeR::DGEList(counts, group = grp)
  y <- y[filter_genes(counts, grp, de$filter), , keep.lib.sizes = FALSE]
  y <- norm_lib(y)
  et <- edgeR::exactTest(y, pair = c("Control", "Case"), dispersion = de$bcv^2)
  tt <- edgeR::topTags(et, n = Inf, sort.by = "none")$table
  out <- data.frame(gene = rownames(tt), ave_expr = 2^tt$logCPM, log2FC = tt$logFC,
                    pvalue = tt$PValue, padj = tt$FDR, stringsAsFactors = FALSE)
  attr(out, "norm") <- edgeR::cpm(y)
  attr(out, "norm_label") <- "mean_cpm"
  out
}

# ---- 调度:选路径、跑引擎、加各组均值、判定 Up/Down ----
choose_mode <- function(n_case, n_ctrl, mode = "auto") {
  if (mode %in% c("replicate", "noreplicate")) return(mode)
  if (!identical(mode, "auto")) stop("comparison mode must be auto | replicate | noreplicate", call. = FALSE)
  if (n_case >= 2 && n_ctrl >= 2) "replicate" else "noreplicate"
}

classify_regulation <- function(padj, log2fc, padj_cut, lfc_cut) {
  r <- rep("NS", length(padj))
  sig <- !is.na(padj) & padj < padj_cut        # padj 为 NA(被过滤)一律视为不显著
  r[sig & log2fc >=  lfc_cut] <- "Up"
  r[sig & log2fc <= -lfc_cut] <- "Down"
  r
}

# 跑单个比较:每个比较只用其两组样本单独建模,与配置里其他组无关
run_comparison <- function(cmp, counts, st, cfg) {
  # 比较里除 name/case/control/mode 之外的字段,覆盖全局 de 设置
  de <- modifyList(cfg$de, cmp[setdiff(names(cmp), c("name", "case", "control", "mode"))])
  for (g in c(cmp$case, cmp$control))
    if (!g %in% levels(st$group)) stop("Comparison '", cmp$name, "': unknown group '", g,
                                       "'. Known: ", paste(levels(st$group), collapse = ", "), call. = FALSE)
  if (identical(cmp$case, cmp$control)) stop("Comparison '", cmp$name, "': case and control are the same", call. = FALSE)

  s_case <- st$sample[st$group == cmp$case]; s_ctrl <- st$sample[st$group == cmp$control]
  mode <- choose_mode(length(s_case), length(s_ctrl), if (is.null(cmp$mode)) "auto" else cmp$mode)
  msg("== ", cmp$name, ": ", cmp$case, " (n=", length(s_case), ") vs ", cmp$control,
      " (n=", length(s_ctrl), ") -> ", mode, " path")

  samples <- c(s_ctrl, s_case)
  grp <- factor(c(rep("Control", length(s_ctrl)), rep("Case", length(s_case))), levels = c("Control", "Case"))
  sub <- counts[, samples, drop = FALSE]

  if (mode == "replicate") {
    if (length(s_case) < 2 || length(s_ctrl) < 2)
      stop("Comparison '", cmp$name, "': replicate path needs >= 2 samples per group", call. = FALSE)
    batch <- if ("batch" %in% names(st)) usable_batch(grp, st[samples, "batch"], de$use_batch) else NULL
    res <- if (identical(de$method, "edger")) de_edger_qlf(sub, grp, batch, de)
           else if (identical(de$method, "deseq2")) de_deseq2(sub, grp, batch, de)
           else stop("de$method must be deseq2 | edger", call. = FALSE)
    method_used <- paste0(de$method, if (!is.null(batch)) "+batch" else "")
  } else {
    if (length(s_case) > 1 || length(s_ctrl) > 1)
      warn("Comparison '", cmp$name, "': unbalanced replication; the single-sample side gives no variance ",
           "estimate, so a fixed BCV of ", de$bcv, " is used for all genes")
    if ("batch" %in% names(st) && isTRUE(de$use_batch)) warn("Batch is not modelled on the no-replicate path")
    res <- de_edger_noreplicate(sub, grp, de)
    method_used <- sprintf("edgeR exactTest (BCV=%s)", de$bcv)
  }

  # 加各组表达均值(DESeq2: 标准化计数; edgeR: CPM,两者不可直接互比)
  nm <- attr(res, "norm"); lab <- attr(res, "norm_label")
  ix <- match(res$gene, rownames(nm))
  res[[paste0(lab, "_", cmp$control)]] <- rowMeans(nm[ix, s_ctrl, drop = FALSE])
  res[[paste0(lab, "_", cmp$case)]]    <- rowMeans(nm[ix, s_case, drop = FALSE])
  res$regulation <- classify_regulation(res$padj, res$log2FC, de$padj, de$log2fc)
  res <- res[order(res$padj, res$pvalue, na.last = TRUE), ]
  attr(res, "norm") <- NULL; attr(res, "norm_label") <- NULL

  tab <- table(factor(res$regulation, levels = c("Up", "Down", "NS")))
  msg("   tested ", nrow(res), " genes; Up=", tab[["Up"]], " Down=", tab[["Down"]])
  list(result = res,
       summary = data.frame(comparison = cmp$name, case = cmp$case, control = cmp$control,
                            n_case = length(s_case), n_control = length(s_ctrl), path = mode,
                            method = method_used, genes_tested = nrow(res),
                            padj_cutoff = de$padj, log2fc_cutoff = de$log2fc,
                            Up = tab[["Up"]], Down = tab[["Down"]], stringsAsFactors = FALSE))
}

run_all_comparisons <- function(cfg, counts, st, out_dir) {
  cmps <- cfg$comparisons
  if (is.null(cmps) || !length(cmps)) { warn("No `comparisons` defined; skipping DE"); return(invisible(NULL)) }
  nms <- vapply(cmps, function(x) as.character(x$name), "")
  if (anyDuplicated(nms)) stop("Duplicate comparison names", call. = FALSE)
  de_dir <- ensure_dir(out_dir, "DE")
  sums <- lapply(cmps, function(cmp) {
    r <- run_comparison(cmp, counts, st, cfg)
    write_table(r$result, file.path(de_dir, paste0("DE_", cmp$name, ".csv")))
    r$summary
  })
  sums <- do.call(rbind, sums)
  write_table(sums, file.path(de_dir, "DE_summary.csv"))
  invisible(sums)
}

# =============================================================================
# 第五部分:配色与热图
#   颜色全部来自 RColorBrewer / viridisLite / grDevices::hcl.colors,风格统一
# =============================================================================
.viridis_options <- c("viridis", "magma", "inferno", "plasma", "cividis", "rocket", "mako", "turbo")

# 从命名色板取 n 个颜色:先找 RColorBrewer,再 viridis 系列,最后 hcl.pals()
palette_colors <- function(name, n) {
  bp <- RColorBrewer::brewer.pal.info
  if (identical(name, "npg")) {                 # Nature Publishing Group 配色:优先用 ggsci,没装则用内置同值色号
    base <- if (requireNamespace("ggsci", quietly = TRUE)) ggsci::pal_npg()(10) else
      c("#E64B35", "#4DBBD5", "#00A087", "#3C5488", "#F39B7F", "#8491B4", "#91D1C2", "#DC0000", "#7E6148", "#B09C85")
    if (n <= 10) base[seq_len(n)] else grDevices::colorRampPalette(base)(n)
  } else if (name %in% rownames(bp)) {
    k <- bp[name, "maxcolors"]
    cols <- RColorBrewer::brewer.pal(max(3, min(n, k)), name)
    if (n > k || n < 3) cols <- grDevices::colorRampPalette(cols)(n)   # 超出上限则插值
    if (n < 3) cols <- RColorBrewer::brewer.pal(3, name)[seq_len(n)]
    cols
  } else if (name %in% .viridis_options) viridisLite::viridis(n, option = name)
  else if (name %in% grDevices::hcl.pals()) grDevices::hcl.colors(n, name)
  else stop("Unknown palette '", name, "'. Use an RColorBrewer, viridis or hcl.pals() name.", call. = FALSE)
}

# 连续色阶:Z-score 用以 0 为中心的对称色阶,未标准化数据用 1%-99% 分位数范围
heatmap_color_fun <- function(mat, opts) {
  n <- 11
  cols <- palette_colors(opts$palette, n)
  if (isTRUE(opts$reverse_palette)) cols <- rev(cols)
  if (identical(opts$scale, "row")) brk <- seq(-opts$zlim, opts$zlim, length.out = n)
  else { q <- stats::quantile(mat, c(0.01, 0.99), na.rm = TRUE); brk <- seq(q[[1]], q[[2]], length.out = n) }
  circlize::colorRamp2(brk, cols)
}

# 离散分组颜色;override 为手动指定的 命名向量
discrete_colors <- function(levels, palette, override = NULL) {
  cols <- stats::setNames(palette_colors(palette, length(levels)), levels)
  if (!is.null(override)) { override <- unlist(override); hit <- intersect(names(override), levels); cols[hit] <- override[hit] }
  cols
}

# 画图用表达量(基因 x 样本):默认 DESeq2 vst(blind=TRUE),或 edgeR log-CPM
compute_expression <- function(counts, st, transform = "vst") {
  m <- counts[rowSums(counts[, st$sample, drop = FALSE]) > 0, st$sample, drop = FALSE]
  if (transform == "vst") {
    msg("Computing VST on ", nrow(m), " genes x ", ncol(m), " samples")
    v <- tryCatch(suppressMessages(DESeq2::vst(m, blind = TRUE)),
                  error = function(e) suppressMessages(DESeq2::varianceStabilizingTransformation(m, blind = TRUE)))
    as.matrix(v)
  } else if (transform == "logcpm") {
    edgeR::cpm(norm_lib(edgeR::DGEList(m)), log = TRUE, prior.count = 2)
  } else stop("heatmap$transform must be vst | logcpm", call. = FALSE)
}

# 选样本:条目可以是组名(展开为该组全部样本)或样本名
select_samples <- function(spec, st) {
  if (is.null(spec)) return(st$sample)
  out <- unlist(lapply(as.character(unlist(spec)), function(s) {
    if (s %in% levels(st$group)) st$sample[st$group == s]
    else if (s %in% st$sample) s
    else stop("Heatmap sample/group '", s, "' not found among configured groups/samples", call. = FALSE)
  }))
  unique(out)
}

# 自动尺寸:样本名水平放置(角度小)时按名字长度加宽每列,避免互相重叠
col_w_for <- function(cn, col_labels, opts) {
  rot <- nz(opts$column_names_rot, 90)
  if (abs(sin(rot * pi / 180)) >= 0.5) return(0.22)
  max(0.22, 0.085 * max(nchar(map_labels(cn, col_labels))) * opts$font_size / 9)
}
default_size <- function(nr, nc, show_rows, col_w = 0.22, extra_w = 0) {
  base <- if (col_w > 0.22) 3.9 + col_w * nc else max(5, 3 + 0.22 * nc)
  ## 高度:不显示基因名时也要随行数增长,否则几千个基因会被压进同一个固定高度,
  ## 每个像素行要平摊很多基因,整张图看起来就是一片模糊的色带
  h <- if (show_rows) min(20, max(4, 2.5 + 0.16 * nr))
       else if (nr <= 200) 7
       else min(30, max(7, 7 + (nr - 200) / 1200))
  list(width  = min(14, base + extra_w), height = h)
}

# 色块/簇名在右侧时,手动给的 width 要相应加宽,否则它们会被挤出画布
manual_width <- function(opts, size) {
  w <- nz(opts$width, size$width)
  if (!is.null(size$bar_w_mm) && size$bar_w_mm > 0) w <- w + size$bar_w_mm / 25.4
  w
}

# 保存为 pdf/png/svg(pdf 用 cairo_pdf 以正确显示非 ASCII 字符)
save_heatmap <- function(ht, file_base, opts, size) {
  w <- manual_width(opts, size)
  h <- resolve_height(opts, size)
  for (fmt in opts$formats) {
    f <- paste0(file_base, ".", fmt)
    if (fmt == "pdf") grDevices::cairo_pdf(f, width = w, height = h)
    else if (fmt == "png") grDevices::png(f, width = w, height = h, units = "in", res = opts$dpi, type = "cairo")
    else if (fmt == "svg") grDevices::svg(f, width = w, height = h)
    else stop("Unsupported format: ", fmt, call. = FALSE)
    tryCatch(ComplexHeatmap::draw(ht, merge_legend = TRUE), finally = grDevices::dev.off())
  }
  nr <- nz(size$n_rows, 0)
  msg("   saved ", basename(file_base), " (", paste(opts$formats, collapse = "/"), "; ",
      round(w, 1), " x ", round(h, 1), " in = ", round(h * 25.4), " mm high",
      if (nr > 0) paste0(", ", round(h * 25.4 / nr, 4), " mm/row") else "", ")")
}

# 高度优先级: row_mm(按行数换算) > height(直接给英寸) > 自动计算
#   row_mm 更适合热图:直接控制"每个基因占多高",换基因数时整张图等比缩放
resolve_height <- function(opts, size) {
  nr <- nz(size$n_rows, NULL)
  rm <- nz(opts$row_mm, NULL)
  if (!is.null(rm) && is.finite(rm) && rm > 0 && !is.null(nr) && nr > 0)
    return(max(2, rm * nr / 25.4))                                     # 毫米 -> 英寸,至少 2 英寸(留出坐标轴/图例)
  h <- nz(opts$height, NULL)
  if (!is.null(h) && is.finite(h) && h > 0) return(h)
  size$height
}

# 小工具:NULL 时取默认值;样本显示名映射(只改显示,不改数据对应关系)
nz <- function(x, default) if (is.null(x)) default else x
# 样本标签在上还是在下:只认 "top",其余一律 bottom
col_names_side <- function(opts) if (identical(opts$column_names_side, "top")) "top" else "bottom"

# 图例标题:group_legend_title = NULL 时保持 ComplexHeatmap 默认(「Group」);
# 写 "" 则图例里也不再出现「Group」字样(色块与组名照常显示)
legend_param <- function(opts, nms) {
  t <- opts$group_legend_title
  if (is.null(t)) return(NULL)
  if (!"Group" %in% nms) return(list())
  list(Group = list(title = t))
}
map_labels <- function(x, map) {
  if (is.null(map)) return(x)
  m <- unlist(map); i <- x %in% names(m)
  x[i] <- unname(m[x[i]])
  x
}
resolve_labels <- function(local, cfg) if (!is.null(local)) local else cfg$sample_labels

# 行距离:pearson/spearman 用 1 - 相关系数,其余走 stats::dist
row_dist <- function(mat, method) {
  if (method %in% c("pearson", "spearman")) stats::as.dist(1 - stats::cor(t(mat), method = method))
  else stats::dist(mat, method = method)
}

# 把基因聚成 k 个簇;簇名 C1..Ck 按聚类树从上到下的出现顺序编号,行顺序同步重排
cluster_rows_k <- function(mat, k, method, linkage) {
  k <- as.integer(k)
  if (k < 2 || k > nrow(mat)) stop("n_clusters must be between 2 and the number of genes (", nrow(mat), ")", call. = FALSE)
  hc <- stats::hclust(row_dist(mat, method), method = linkage)
  cl <- stats::cutree(hc, k = k)[hc$order]
  list(order = hc$order, group = paste0("C", match(cl, unique(cl))))
}

# 基因数很多时(如全基因组)的聚类方案:层次聚类要算 N x N 距离矩阵,2 万个基因约占 3 GB,不可行。
#   两步走("递归聚类"):
#     1) 粗分:k-means 分出你想在图上看到的 k 个簇(簇名 C1..Ck,用于色块)
#     2) 细分:每个粗簇内再用 k-means 分成若干小块,每块内跑真正的 hclust 排序,
#        块的先后由各块质心的 hclust 决定
#   这样既保留全部基因,又不会像"按峰值排序"那样画出一条假的单调渐变带
cluster_rows_big <- function(mat, k, method = "euclidean", linkage = "ward.D2", n_fine = NULL) {
  k <- as.integer(k)
  if (k < 2 || k > nrow(mat)) stop("n_clusters must be between 2 and the number of genes (", nrow(mat), ")", call. = FALSE)
  set.seed(1)                                           # 固定随机种子,结果可重复

  ## ---- 1) 粗分:决定色块簇名 C1..Ck,并按"峰值样本 -> 峰值大小"排列簇的先后 ----
  km <- stats::kmeans(mat, centers = k, nstart = 5, iter.max = 100)
  rk <- order(max.col(km$centers, ties.method = "first"), -matrixStats::rowMaxs(km$centers))
  coarse <- match(km$cluster, rk)

  ## ---- 2) 细分:粗簇内部再分小块 + 块内 hclust,恢复真实的分块纹理 ----
  nf <- n_fine
  ord <- unlist(lapply(seq_len(k), function(g)
    order_within(mat, which(coarse == g), method, linkage, nf)))
  list(order = ord, group = paste0("C", coarse[ord]))
}

# 在给定的行子集内部排序(基因数很多时的核心步骤):先 k-means 分成若干小块,
# 块内用真正的 hclust 排序,块之间由质心的 hclust 决定先后。
# 这样 N 越大计算量仍可控(不需要 N x N 距离矩阵),同时保留真实的分块结构。
order_within <- function(mat, idx, method = "euclidean", linkage = "ward.D2", n_fine = NULL) {
  if (length(idx) <= 1) return(idx)
  if (length(idx) <= 200) {                              # 小块:直接 hclust
    hc <- stats::hclust(row_dist(mat[idx, , drop = FALSE], method), method = linkage)
    return(idx[hc$order])
  }
  nf <- nz(n_fine, max(4, min(60L, round(sqrt(nrow(mat) / 10)))))
  kf <- max(2L, min(nf, floor(length(idx) / 20)))
  km2 <- stats::kmeans(mat[idx, , drop = FALSE], centers = kf, nstart = 3, iter.max = 50)
  blocks <- split(idx, km2$cluster)
  cent <- do.call(rbind, lapply(blocks, function(b) colMeans(mat[b, , drop = FALSE])))
  hb <- stats::hclust(stats::dist(cent), method = linkage)      # 让相似的块挨在一起
  out <- integer(0)
  for (bi in hb$order) {
    b <- blocks[[bi]]
    if (length(b) == 1) { out <- c(out, b); next }
    hc <- stats::hclust(row_dist(mat[b, , drop = FALSE], method), method = linkage)
    out <- c(out, b[hc$order])
  }
  out
}

# 通用热图构建器(整体热图和选定基因热图共用)
#   mat: 基因 x 样本; st: 与列顺序一致的样本表(列顺序 = st 的行顺序)
#   row_group: 可选,每行基因所属的簇(用于按行切分);n_clusters: 无 row_group 时自动聚成 k 簇
#   col_labels: 可选,命名向量 样本名 -> 显示名
#   marker_genes: 可选,要标在热图左侧的基因名(带连线);只标出实际画在图里的基因
build_heatmap <- function(mat, st, opts, row_group = NULL, n_clusters = NULL, col_labels = NULL, title = "",
                          marker_genes = NULL) {
  mat <- mat[, st$sample, drop = FALSE]
  if (identical(opts$scale, "row")) {
    sdv <- apply(mat, 1, stats::sd)
    if (any(sdv == 0)) {                      # 零方差基因无法做 Z-score
      warn(sum(sdv == 0), " genes have zero variance in the plotted samples; removed")
      keep <- sdv > 0; mat <- mat[keep, , drop = FALSE]; row_group <- row_group[keep]
    }
    mat <- t(scale(t(mat)))
    mat[mat > opts$zlim] <- opts$zlim; mat[mat < -opts$zlim] <- -opts$zlim   # 截断极值,色阶更清晰
  }
  if (nrow(mat) < 1) stop("No genes left to plot", call. = FALSE)
  cl_rows <- isTRUE(opts$cluster_rows) && nrow(mat) > 1
  cl_cols <- isTRUE(opts$cluster_columns) && ncol(mat) > 1
  max_rc  <- nz(opts$max_cluster_rows, 5000)
  big <- nrow(mat) > max_rc                   # 基因太多: 不做层次聚类
  if (big) {
    if (cl_rows) warn(nrow(mat), " genes exceed max_cluster_rows (", max_rc, "): full hierarchical clustering skipped; ",
                      "genes are grouped by k-means and clustered within each block",
                      if (is.null(n_clusters)) " (no colour bar; set n_clusters to split into named clusters)" else "")
    cl_rows <- FALSE
  }
  rdist <- opts$row_distance
  if ((cl_rows || (!is.null(n_clusters) && !big) || (big && (!is.null(row_group) || !is.null(n_clusters)))) &&
      rdist %in% c("pearson", "spearman") && any(apply(mat, 1, stats::sd) == 0)) {
    warn("Zero-variance rows: row distance switched to euclidean"); rdist <- "euclidean"
  }
  if (!is.null(n_clusters) && !is.null(row_group)) warn("Gene groups are given; n_clusters ignored")
  if (!is.null(n_clusters) && is.null(row_group)) {       # 自动分簇:仅在没有给定基因分组时生效
    kc <- if (big) cluster_rows_big(mat, n_clusters, rdist, opts$cluster_method, opts$n_fine_blocks)
          else cluster_rows_k(mat, n_clusters, rdist, opts$cluster_method)
    mat <- mat[kc$order, , drop = FALSE]; row_group <- kc$group
  } else if (big) {
    # 给了基因分组但基因太多:保留给定的簇顺序,只把每个簇内部重新排序
    o <- unlist(lapply(unique(row_group), function(g) {
      i <- which(row_group == g)
      if (length(i) <= 1) i else order_within(mat, i, rdist, opts$cluster_method, opts$n_fine_blocks)
    }))
    mat <- mat[o, , drop = FALSE]; row_group <- row_group[o]
  }

  # 标记基因:只保留实际画出来的(零方差被剔除的基因没有行可标)
  mk <- NULL
  if (length(marker_genes)) {
    want <- unique(marker_genes); mk <- want[want %in% rownames(mat)]
    if (length(mk) < length(want))
      warn("Marker genes not in the plotted matrix (zero variance or not selected): ", paste(setdiff(want, mk), collapse = ", "))
    if (!length(mk)) mk <- NULL
  }

  # 色块粗细(毫米):纵向色块(顶部样本分组)= group_bar_height,横向色块(基因簇)= cluster_bar_width
  bar_h <- nz(opts$group_bar_height, 5)
  bar_w <- nz(opts$cluster_bar_width, 5)

  # 列注释条:分组(+ 批次)。颜色按配置里的全部分组固定分配,各图一致;图例/切分顺序 = 样本出现顺序
  used  <- unique(as.character(st$group))
  gcols <- discrete_colors(levels(st$group), opts$group_palette, opts$group_colors)[used]
  grp   <- factor(as.character(st$group), levels = used)
  ann <- list(Group = grp); ann_col <- list(Group = gcols)
  if (isTRUE(opts$show_batch) && "batch" %in% names(st)) {
    ann$Batch <- as.character(st$batch)
    ann_col$Batch <- discrete_colors(unique(ann$Batch), "Pastel1", NULL)
  }
  top <- do.call(ComplexHeatmap::HeatmapAnnotation,
                 c(ann, list(col = ann_col, annotation_name_gp = grid::gpar(fontsize = opts$font_size),
                             show_annotation_name = isTRUE(opts$show_annotation_name),
                             annotation_legend_param = legend_param(opts, names(ann)),
                             simple_anno_size = grid::unit(bar_h, "mm"))))

  # 行注释:标记基因(带连线的基因名)始终在左侧;基因簇色块默认在左侧,
  # options$cluster_bar_side = "right" 时色块移到热图右侧,簇名(C1..Ck)跟着一起移到右侧
  bar_side <- if (identical(opts$cluster_bar_side, "right")) "right" else "left"
  # 簇名位置:默认跟随色块;也可用 options$row_title_side 单独指定("left"/"right")
  title_side <- if (identical(opts$row_title_side, "left")) "left"
                else if (identical(opts$row_title_side, "right")) "right"
                else bar_side
  left_parts <- list(); right_parts <- list(); rsplit <- NULL
  if (!is.null(row_group)) {
    rsplit <- factor(row_group, levels = unique(row_group))
    rcols <- discrete_colors(levels(rsplit), opts$gene_group_palette, opts$group_colors)
  }
  if (!is.null(mk)) {
    left_parts$Markers <- ComplexHeatmap::anno_mark(
      at = match(mk, rownames(mat)), labels = mk, which = "row", side = "left",
      labels_gp = grid::gpar(fontsize = nz(opts$marker_font_size, opts$font_size),
                             fontface = if (isTRUE(opts$row_names_italic)) "italic" else "plain"),
      link_width = grid::unit(6, "mm"))
  }
  if (!is.null(rsplit)) {
    bar <- list()
    if (nrow(mat) > 2000) {
      # 基因很多时逐行画色块会出现抗锯齿白缝,改为每个簇画一个整块
      bar$Gene_group <- ComplexHeatmap::anno_block(which = "row", gp = grid::gpar(fill = unname(rcols), col = NA),
                                                   width = grid::unit(bar_w, "mm"))
    } else {
      bar$Gene_group <- rsplit
      bar$col <- list(Gene_group = rcols)
      bar$simple_anno_size <- grid::unit(bar_w, "mm")
    }
    if (identical(bar_side, "right")) right_parts <- bar else left_parts <- c(left_parts, bar)
  }
  make_row_anno <- function(parts) {
    if (!length(parts)) return(NULL)
    parts$show_annotation_name <- FALSE
    do.call(ComplexHeatmap::rowAnnotation, parts)
  }
  left  <- make_row_anno(left_parts)
  right <- make_row_anno(right_parts)
  show_rows <- if (is.null(opts$show_row_names)) nrow(mat) <= 80 else isTRUE(opts$show_row_names)

  # 顶部标题:show_title = FALSE 时不写(整体热图默认关掉「N genes」)
  if (identical(opts$show_title, FALSE)) title <- NULL

  legend_title <- if (identical(opts$scale, "row")) "Z-score" else opts$transform
  ht <- ComplexHeatmap::Heatmap(
    mat, name = legend_title, col = heatmap_color_fun(mat, opts), column_title = title,
    top_annotation = top, left_annotation = left, right_annotation = right,
    cluster_rows = cl_rows, cluster_columns = cl_cols,
    show_row_dend = !identical(opts$show_row_dend, FALSE), show_column_dend = !identical(opts$show_column_dend, FALSE),
    clustering_distance_rows = rdist, clustering_distance_columns = opts$column_distance,
    clustering_method_rows = opts$cluster_method, clustering_method_columns = opts$cluster_method,
    row_split = rsplit, cluster_row_slices = FALSE, row_title_rot = nz(opts$row_title_rot, 0),
    row_title_side = title_side,      # 簇名(C1..Ck)默认跟着色块走;可用 options$row_title_side 单独指定
    # show_row_title = FALSE 时不写簇名:字号设 0(不占宽度,也不会留下空白)
    row_title_gp = grid::gpar(fontsize = if (isTRUE(opts$show_row_title)) opts$font_size + 1 else 0,
                              fontface = "bold"),
    column_split = if (isTRUE(opts$column_split_by_group)) grp else NULL, cluster_column_slices = FALSE,
    show_row_names = show_rows, show_column_names = isTRUE(opts$show_column_names),
    column_labels = map_labels(colnames(mat), col_labels), column_names_rot = nz(opts$column_names_rot, 90),
    column_names_side = col_names_side(opts),
    column_names_centered = (nz(opts$column_names_rot, 90) %% 180 == 0),
    row_names_gp = grid::gpar(fontsize = opts$font_size,
                              fontface = if (isTRUE(opts$row_names_italic)) "italic" else "plain"),
    column_names_gp = grid::gpar(fontsize = opts$font_size),
    use_raster = if (is.null(opts$use_raster)) nrow(mat) > 2000 else isTRUE(opts$use_raster),
    raster_quality = nz(opts$raster_quality, 1),   # 栅格超采样倍数:1 起,2~4 可明显减少横纹(文件不变大)
    border = !identical(opts$border, FALSE))
  list(ht = ht, mat = mat, row_group = row_group,
       size = c(default_size(nrow(mat), ncol(mat), show_rows, col_w_for(colnames(mat), col_labels, opts),
                             extra_w = if (!is.null(mk)) 1.3 else 0),
                list(n_rows = nrow(mat),
                     # 右侧需要预留的宽度:色块(若在右侧)+ 簇名文字(若在右侧)
                     bar_w_mm = (if (identical(bar_side, "right") && !is.null(rsplit)) bar_w else 0) +
                                (if (identical(title_side, "right") && !is.null(rsplit))
                                   nz(opts$cluster_title_w_mm, 8) else 0))))
}

# =============================================================================
# 第五部分(续):整体热图、样本相关性热图、选定基因热图
# =============================================================================

# 单张图的样式 = 全局 heatmap 样式 + 该图 options 覆盖
job_options <- function(cfg, job) {
  o <- modifyList(cfg$heatmap, if (is.null(job$options)) list() else job$options)
  # 统一粗细开关:bar_thickness 非 NULL 时,纵向色块与横向色块同时改为该值(毫米)
  if (!is.null(o$bar_thickness)) {
    o$group_bar_height  <- o$bar_thickness
    o$cluster_bar_width <- o$bar_thickness
  }
  # 色块粗细必须是正数,否则 ComplexHeatmap 会画不出来或直接报错
  for (k in c("group_bar_height", "cluster_bar_width")) {
    v <- o[[k]]
    if (!is.null(v) && (!is.numeric(v) || length(v) != 1 || !is.finite(v) || v <= 0))
      stop("heatmap$", k, " must be a single positive number (mm), got: ", paste(v, collapse = ", "), call. = FALSE)
  }
  if (!is.null(o$column_names_side) && !(identical(o$column_names_side, "top") || identical(o$column_names_side, "bottom")))
    stop("heatmap$column_names_side must be 'top' or 'bottom'", call. = FALSE)
  o
}

# 从已生成的 DE 结果文件里取差异基因并集(按 padj 排序后截取 max_genes 个)
deg_genes_from_files <- function(cfg, out_dir, comparisons, max_genes) {
  de_dir <- file.path(out_dir, "DE")
  nms <- if (is.null(comparisons)) vapply(cfg$comparisons, function(x) as.character(x$name), "") else comparisons
  tabs <- lapply(nms, function(n) {
    f <- file.path(de_dir, paste0("DE_", n, ".csv"))
    if (!file.exists(f)) stop("DE result not found: ", f, " (run the 'de' step first)", call. = FALSE)
    d <- utils::read.csv(f, check.names = FALSE, stringsAsFactors = FALSE)
    d[d$regulation %in% c("Up", "Down"), c("gene", "padj")]
  })
  d <- do.call(rbind, tabs)
  d <- d[order(d$padj), ]
  unique(d$gene)[seq_len(min(max_genes, length(unique(d$gene))))]
}

run_overall_heatmap <- function(cfg, counts, st, expr, out_dir) {
  oc <- cfg$overall_heatmap
  if (!isTRUE(oc$enabled)) return(invisible(NULL))
  hm_dir <- ensure_dir(out_dir, "heatmap")
  opts <- job_options(cfg, oc)
  sub  <- st[select_samples(oc$samples, st), , drop = FALSE]   # 样本顺序 = samples 里的顺序(默认 groups 顺序)
  expr <- expr[, sub$sample, drop = FALSE]
  labs <- resolve_labels(oc$column_labels, cfg)

  if (identical(oc$gene_source, "deg")) {
    genes <- intersect(deg_genes_from_files(cfg, out_dir, oc$comparisons, oc$max_genes), rownames(expr))
    if (!length(genes)) { warn("No DEGs available for the overall heatmap; skipped"); return(invisible(NULL)) }
    msg("Overall heatmap: ", length(genes), " DEGs")
  } else {
    # 先(可选)按表达量过滤,再按方差从大到小取 top_n 个基因;top_n = "all" / NULL 取全部
    g <- droplevels(sub$group)
    keep <- if (isFALSE(oc$expressed_only)) rep(TRUE, nrow(expr)) else
      edgeR::filterByExpr(edgeR::DGEList(counts[rownames(expr), sub$sample], group = g),
                          group = g, min.count = cfg$de$filter$min_count,
                          min.total.count = cfg$de$filter$min_total_count)
    v <- matrixStats::rowVars(expr[keep, , drop = FALSE]); names(v) <- rownames(expr)[keep]
    tn <- oc$top_n
    take_all <- is.null(tn) || (is.character(tn) && tolower(tn) == "all") || (is.numeric(tn) && is.infinite(tn))
    genes <- names(sort(v, decreasing = TRUE))[seq_len(if (take_all) length(v) else min(as.integer(tn), length(v)))]
    msg("Overall heatmap: ", if (take_all) "all " else "top ", length(genes), " genes by variance (of ", sum(keep),
        if (isFALSE(oc$expressed_only)) " non-zero)" else " expressed)")
  }

  # 标记基因:显示在热图左侧。不在所选基因里的标记基因默认自动加入,保证一定显示
  markers <- NULL
  if (length(oc$marker_genes)) {
    mk <- tryCatch(resolve_gene_spec(list(name = "overall markers", genes = oc$marker_genes), rownames(expr))$gene,
                   error = function(e) { warn(conditionMessage(e)); NULL })
    markers <- unique(mk)
    miss <- setdiff(markers, genes)
    if (length(miss) && !isFALSE(oc$marker_add_missing)) {
      genes <- c(genes, miss)
      msg("   ", length(miss), " marker genes were not in the selected set and were added: ", paste(miss, collapse = ", "))
    }
  }
  b <- build_heatmap(expr[genes, , drop = FALSE], sub, opts, n_clusters = oc$n_clusters, col_labels = labs,
                     title = sprintf("%s genes", length(genes)), marker_genes = markers)
  save_heatmap(b$ht, file.path(hm_dir, paste0("heatmap_", oc$name)), opts, b$size)
  out <- data.frame(gene = rownames(b$mat), b$mat, check.names = FALSE)
  if (!is.null(b$row_group)) out <- cbind(gene_cluster = b$row_group, out)
  write_table(out, file.path(hm_dir, paste0("heatmap_", oc$name, "_matrix.csv")))

  # 样本相关性热图(Pearson,基于同一批基因的表达量);cluster_columns = FALSE 时行列都保持样本顺序
  if (isTRUE(oc$sample_correlation)) {
    cm <- stats::cor(expr[genes, ], method = "pearson")
    n <- 9; cols <- palette_colors(oc$correlation_palette, n)
    rng <- range(cm[upper.tri(cm)])
    cf <- circlize::colorRamp2(seq(rng[1], 1, length.out = n), cols)
    cl <- isTRUE(opts$cluster_columns) && ncol(cm) > 1
    used  <- unique(as.character(sub$group))
    gcols <- discrete_colors(levels(st$group), opts$group_palette, opts$group_colors)[used]
    ht <- ComplexHeatmap::Heatmap(cm, name = "Pearson r", col = cf,
            cluster_rows = cl, cluster_columns = cl,
            clustering_distance_rows = "pearson", clustering_distance_columns = "pearson",
            clustering_method_rows = opts$cluster_method, clustering_method_columns = opts$cluster_method,
            row_labels = map_labels(rownames(cm), labs), column_labels = map_labels(colnames(cm), labs),
            column_names_rot = nz(opts$column_names_rot, 90), column_names_centered = (nz(opts$column_names_rot, 90) %% 180 == 0),
            column_names_side = col_names_side(opts),
            top_annotation = ComplexHeatmap::HeatmapAnnotation(
              Group = factor(as.character(sub$group), levels = used), col = list(Group = gcols),
              show_annotation_name = isTRUE(oc$correlation_show_annotation_name),
              annotation_legend_param = legend_param(opts, "Group"),
              simple_anno_size = grid::unit(nz(opts$group_bar_height, 5), "mm")),
            row_names_gp = grid::gpar(fontsize = opts$font_size),
            column_names_gp = grid::gpar(fontsize = opts$font_size), border = TRUE)
    # 尺寸:correlation_size 优先;否则按样本数自动(平方图,3 个样本约 3 x 3 英寸)
    cs <- oc$correlation_size
    if (!is.null(cs)) {
      cs <- suppressWarnings(as.numeric(cs))
      if (length(cs) != 2 || any(!is.finite(cs)) || any(cs <= 0))
        stop("overall_heatmap$correlation_size must be c(width, height) in inches, e.g. c(3.2, 3)", call. = FALSE)
      cw <- cs[1]; ch <- cs[2]
    } else {
      s <- min(7, max(3, 1.0 + 0.16 * ncol(cm)))
      cw <- s + 0.9; ch <- s
    }
    # 样本相关性热图是方形的,宽高只由上面两个值决定;这里屏蔽全局 width/height/row_mm,
    # 否则为整体热图设的 width/height 会把它一起拉大或拉变形
    sc_opts <- opts; sc_opts$width <- NULL; sc_opts$height <- NULL; sc_opts$row_mm <- NULL
    save_heatmap(ht, file.path(hm_dir, paste0("sample_correlation_", oc$name)), sc_opts,
                 list(width = cw, height = ch))
  }
  invisible(TRUE)
}

# 把 genes / gene_groups / gene_file 合并成 data.frame(gene, group),并与表达矩阵行名匹配
resolve_gene_spec <- function(job, available) {
  d <- data.frame(gene = character(), group = character(), stringsAsFactors = FALSE)
  add <- function(g, grp) if (length(g)) d <<- rbind(d, data.frame(gene = as.character(g), group = grp, stringsAsFactors = FALSE))
  if (!is.null(job$genes)) add(unlist(job$genes), NA_character_)
  for (gn in names(job$gene_groups)) add(unlist(job$gene_groups[[gn]]), gn)
  if (!is.null(job$gene_file)) {
    x <- utils::read.csv(job$gene_file, header = TRUE, stringsAsFactors = FALSE, fileEncoding = "UTF-8-BOM")
    add(x[[1]], if (ncol(x) >= 2) as.character(x[[2]]) else NA_character_)
  }
  if (!nrow(d)) stop("Heatmap '", job$name, "': no genes given (genes / gene_groups / gene_file)", call. = FALSE)
  d$gene <- trimws(d$gene)
  hit <- match(d$gene, available)                                   # 先精确匹配
  ci  <- is.na(hit) & !is.na(match(toupper(d$gene), toupper(available)))
  hit[ci] <- match(toupper(d$gene[ci]), toupper(available))         # 再不区分大小写
  if (any(ci)) msg("   case-insensitive matches: ", paste(d$gene[ci], "->", available[hit[ci]], collapse = ", "))
  if (anyNA(hit)) warn("Heatmap '", job$name, "': genes not found and skipped: ", paste(d$gene[is.na(hit)], collapse = ", "))
  d$gene <- available[hit]; d <- d[!is.na(hit), , drop = FALSE]
  if (!nrow(d)) stop("Heatmap '", job$name, "': none of the genes were found", call. = FALSE)
  d
}

run_selected_heatmaps <- function(cfg, st, expr, out_dir) {
  jobs <- cfg$selected_heatmaps
  if (is.null(jobs) || !length(jobs)) { msg("No selected_heatmaps defined; skipped"); return(invisible(NULL)) }
  hm_dir <- ensure_dir(out_dir, "heatmap")
  for (job in jobs) {
    if (is.null(job$name)) stop("Each selected_heatmaps entry needs a `name`", call. = FALSE)
    if (identical(job$enabled, FALSE)) next
    msg("== selected heatmap: ", job$name)
    opts <- job_options(cfg, job)
    gs <- resolve_gene_spec(job, rownames(expr))
    sub <- st[select_samples(job$samples, st), , drop = FALSE]   # 样本顺序 = samples 里的顺序(默认 groups 顺序)
    grouped <- any(!is.na(gs$group))
    if (grouped) { gs$group[is.na(gs$group)] <- "Other"; gs <- gs[order(match(gs$group, unique(gs$group))), ] }
    else gs$group <- NULL
    b <- build_heatmap(expr[gs$gene, sub$sample, drop = FALSE], sub, opts,
                       row_group = if (grouped) gs$group else NULL, n_clusters = job$n_clusters,
                       col_labels = resolve_labels(job$column_labels, cfg),
                       title = if (is.null(job$title)) job$name else job$title)
    save_heatmap(b$ht, file.path(hm_dir, paste0("heatmap_", job$name)), opts, b$size)
    out <- data.frame(gene = rownames(b$mat), b$mat, check.names = FALSE)
    if (!is.null(b$row_group)) out <- cbind(gene_group = b$row_group, out)
    write_table(out, file.path(hm_dir, paste0("heatmap_", job$name, "_matrix.csv")))
  }
  invisible(TRUE)
}


# =============================================================================
# 第五部分(续):PCA 与火山图(有/无重复都可用),ggplot2 bw 风格
#   PCA 用与热图相同的 vst 表达量;火山图读取 DE/ 目录里已生成的差异结果表
#   风格要点: Arial、5-7 pt 小字号、theme_bw 边框与网格、NPG 配色、
#             图尺寸按期刊栏宽(单栏 89 mm、1.5 栏 120 mm、双栏 183 mm)用毫米设定
# =============================================================================

pt2mm <- function(pt) pt / ggplot2::.pt                            # geom_text 的 size 以 mm 计

# 标签白色衬底:文字压在散点/引线上时笔画会被盖住,看着像"字缺一块";加一圈白底就不会。
# 关掉:plots$label_halo = FALSE
label_halo <- function(cfg) {
  if (!isTRUE(nz(cfg$plots$label_halo, TRUE))) return(list())
  list(bg.color = "white", bg.r = 0.15)
}

# 量出坐标框(panel)四周「固定」装饰的宽/高,单位英寸:轴标题、刻度文字、图例、plot.margin。
# 坐标框本身是弹性(null)单位,不计入 —— 由调用方按需求定它的边长。
grob_decor_in <- function(g) {
  lay <- g$layout; i <- which(lay$name == "panel")[1]
  l <- lay$l[i]; r <- lay$r[i]; t <- lay$t[i]; b <- lay$b[i]
  sw <- function(u) if (!length(u)) 0 else sum(grid::convertWidth(u, "in", valueOnly = TRUE))
  sh <- function(u) if (!length(u)) 0 else sum(grid::convertHeight(u, "in", valueOnly = TRUE))
  list(left   = if (l > 1) sw(g$widths[seq_len(l - 1)]) else 0,
       right  = if (r < length(g$widths)) sw(g$widths[seq(r + 1, length(g$widths))]) else 0,
       top    = if (t > 1) sh(g$heights[seq_len(t - 1)]) else 0,
       bottom = if (b < length(g$heights)) sh(g$heights[seq(b + 1, length(g$heights))]) else 0)
}

# 打开位图设备:优先 ragg(灰度抗锯齿,字边缘没有彩色描边;cairo 的 subpixel 渲染
# 在 6 pt 小字上会让笔画看着"缺一截")。没有 ragg 时退回 cairo png。
open_bitmap <- function(f, w, h, dpi) {
  if (requireNamespace("ragg", quietly = TRUE)) {
    ragg::agg_png(filename = f, width = w, height = h, units = "in", res = dpi, background = "white")
  } else {
    grDevices::png(f, width = w, height = h, units = "in", res = dpi, type = "cairo", bg = "white")
  }
}

# 保存 ggplot 图:width_mm/height_mm 是画布上限;实际画布 = 坐标框 + 图例/轴标题 + 留白,
# 因此文字永远不会被画布边缘切掉(旧做法固定画布,框一挤就把图例或轴标题挤到画布外)。
# square = TRUE 时坐标框取正方形,边长由「宽 - 左右装饰」与「高 - 上下装饰」中较小者决定。
save_plot <- function(p, file_base, plots, width_mm, height_mm, square = FALSE) {
  fmts <- nz(plots$formats, "png"); dpi <- nz(plots$dpi, 300)
  pad  <- nz(plots$plot_pad_mm, 2)
  # plot.margin 会计入 gtable,所以先定好边距,下面量到的装饰尺寸就包含了它
  p <- p + ggplot2::theme(plot.margin = ggplot2::margin(pad, pad, pad, pad, "mm"))

  # 量尺寸必须用与最终输出同一个设备:字体度量不同会量偏;而落到默认 pdf 设备时
  # Arial 找不到,expression() 轴标题会直接报 "PDF CID font"。
  # convertWidth 也要在设备存活期内调用,所以整段测量都放在 tryCatch 里面。
  probe <- tempfile(fileext = ".png")
  open_bitmap(probe, 6, 6, 72)
  d <- tryCatch(grob_decor_in(ggplot2::ggplotGrob(p)), finally = grDevices::dev.off())
  unlink(probe)

  w <- width_mm / 25.4; h <- height_mm / 25.4
  if (isTRUE(square)) {
    s <- min(w - d$left - d$right, h - d$top - d$bottom)   # 正方形边长
    s <- max(s, 0.6)                                       # 兜底:至少 15 mm
    w <- s + d$left + d$right; h <- s + d$top + d$bottom
  } else {
    w <- max(w, d$left + d$right + 0.6); h <- max(h, d$top + d$bottom + 0.6)
  }
  for (fmt in fmts) {
    f <- paste0(file_base, ".", fmt)
    if (fmt == "png") {
      # ragg 在含中文的 Windows 路径下会把路径转成乱码(E:\fd;6),所以先写到
      # 纯 ASCII 的临时文件,渲染完再拷到目标位置
      tmp <- tempfile(fileext = ".png")
      open_bitmap(tmp, w, h, dpi)
      tryCatch(print(p), finally = grDevices::dev.off())
      if (!file.copy(tmp, f, overwrite = TRUE)) stop("cannot write ", f, call. = FALSE)
      unlink(tmp)
    } else if (fmt == "pdf") {
      grDevices::cairo_pdf(f, width = w, height = h)
      tryCatch(print(p), finally = grDevices::dev.off())
    } else stop("Unsupported format: ", fmt, call. = FALSE)
  }
  msg("   saved ", basename(file_base), " (", paste(fmts, collapse = "/"), "; ",
      round(w * 25.4), " x ", round(h * 25.4), " mm)")
}

run_pca <- function(cfg, st, expr, out_dir) {
  jobs <- cfg$plots$pca
  if (is.null(jobs) || !length(jobs)) { msg("No PCA jobs defined; skipped"); return(invisible(NULL)) }
  pdir <- ensure_dir(out_dir, "plots")
  fam  <- nz(cfg$plots$font_family, "Arial"); bs <- nz(cfg$plots$base_size, 6)
  for (job in jobs) {
    if (is.null(job$name)) stop("Each PCA entry needs a `name`", call. = FALSE)
    if (identical(job$enabled, FALSE)) next
    msg("== PCA: ", job$name)
    samples <- select_samples(job$samples, st)
    if (length(samples) < 3) { warn("PCA '", job$name, "' needs >= 3 samples; skipped"); next }
    if (length(samples) <= 4) warn("PCA '", job$name, "': only ", length(samples),
                                   " samples, so at most ", length(samples) - 1, " components carry variance; interpret with care")
    sub <- st[samples, , drop = FALSE]; sub$group <- droplevels(sub$group)

    # 取所选样本中方差最大的 ntop 个基因,中心化后做 PCA(与 DESeq2::plotPCA 的做法一致)
    m <- expr[, samples, drop = FALSE]
    v <- matrixStats::rowVars(m); names(v) <- rownames(m); v <- v[v > 0]
    ntop <- nz(job$ntop, 500)
    top  <- names(sort(v, decreasing = TRUE))[seq_len(min(ntop, length(v)))]
    pc   <- stats::prcomp(t(m[top, , drop = FALSE]), center = TRUE, scale. = FALSE)
    pct  <- 100 * pc$sdev^2 / sum(pc$sdev^2)
    pcs  <- nz(job$pcs, c(1, 2))
    if (length(pcs) != 2 || max(pcs) > ncol(pc$x))
      stop("PCA '", job$name, "': pcs must be two components, each <= ", ncol(pc$x), call. = FALSE)
    msg("   PCA on top ", length(top), " variable genes")

    lab  <- map_labels(samples, resolve_labels(job$sample_labels, cfg))   # 点旁显示的样本名,可自定义
    used <- unique(as.character(sub$group))                               # 图例顺序 = 样本出现顺序
    df <- data.frame(Sample = lab, Group = factor(as.character(sub$group), levels = used),
                     PCx = pc$x[, pcs[1]], PCy = pc$x[, pcs[2]], stringsAsFactors = FALSE)
    opts <- job_options(cfg, job)
    pal  <- nz(job$palette, nz(cfg$plots$group_palette, "npg"))           # PCA 分组配色,默认 NPG
    cols <- discrete_colors(levels(st$group), pal, opts$group_colors)[used]
    # 坐标轴以 0 为中心:x、y 各取 [-L, L],L = 最大绝对值的 1.35 倍(给标签留空间)
    half <- function(v) { m <- max(abs(v)); if (m == 0) 1 else 1.35 * m }
    lx <- half(df$PCx); ly <- half(df$PCy)
    dot <- nz(job$point_size, 2.2)                  # 图例里彩色点的直径(mm)
    gap <- nz(cfg$plots$legend_gap_mm, 0.8)         # 点右缘到文字左缘的净间距(mm)
    p <- ggplot2::ggplot(df, ggplot2::aes(PCx, PCy, color = Group)) +
      ggplot2::geom_hline(yintercept = 0, linetype = "dashed", linewidth = 0.2, color = "grey55") +
      ggplot2::geom_vline(xintercept = 0, linetype = "dashed", linewidth = 0.2, color = "grey55") +
      ggplot2::geom_point(size = nz(job$point_size, 2.2), stroke = 0) +
      ggplot2::scale_color_manual(values = cols, name = NULL) +
      ggplot2::scale_x_continuous(limits = c(-lx, lx), expand = ggplot2::expansion(0)) +
      ggplot2::scale_y_continuous(limits = c(-ly, ly), expand = ggplot2::expansion(0)) +
      ggplot2::labs(x = sprintf("PC%d (%.1f%%)", pcs[1], pct[pcs[1]]),
                    y = sprintf("PC%d (%.1f%%)", pcs[2], pct[pcs[2]]), title = job$title) +
      ggplot2::theme_bw(base_size = bs, base_family = fam) +
      ggplot2::theme(legend.position = nz(job$legend_pos, "right"),      # 图例位置:right | bottom | top | none
                     # 绘图区(坐标框)强制正方形:框随较短的一边定宽高,不是整张图正方形
                     aspect.ratio = if (isTRUE(job$square_panel)) 1 else NULL,
                     # ggplot 默认 key 列 1.2 lines(≈6.1 mm)、文字还带 1.23 mm 左内边距,
                     # 彩色点居中后离文字约 3.2 mm。把 key 宽设为「点直径 + 2*gap」
                     # 并清掉文字左内边距,点右缘到文字左缘就精确等于 legend_gap_mm。
                     legend.key.width = grid::unit(dot + 2 * gap, "mm"),
                     legend.text = ggplot2::element_text(margin = ggplot2::margin(0, 0, 0, 0, "mm"))) +
      # clip = "off":样本名标签贴到坐标框边缘时不会被裁掉半截
      ggplot2::coord_cartesian(clip = "off")
    if (isTRUE(job$ellipse)) {
      big <- names(which(table(df$Group) >= 4))
      if (length(big)) p <- p + ggplot2::stat_ellipse(data = df[df$Group %in% big, ], level = 0.95, linewidth = 0.25)
      else warn("PCA '", job$name, "': no group has >= 4 samples; ellipse skipped")
    }
    if (!identical(job$label_samples, FALSE))
      p <- p + do.call(ggrepel::geom_text_repel,
                       c(list(mapping = ggplot2::aes(label = Sample), color = "black", size = pt2mm(bs - 1),
                              family = fam, show.legend = FALSE, max.overlaps = Inf,
                              segment.size = 0.2, box.padding = 0.4), label_halo(cfg)))

    save_plot(p, file.path(pdir, job$name), cfg$plots, nz(job$width_mm, 89), nz(job$height_mm, 70),
              square = isTRUE(job$square_panel))
    write_table(data.frame(sample = samples, group = as.character(sub$group), pc$x, check.names = FALSE),
                file.path(pdir, paste0(job$name, "_coords.csv")))
    write_table(data.frame(PC = colnames(pc$x), percent_variance = pct),
                file.path(pdir, paste0(job$name, "_variance.csv")))
  }
  invisible(TRUE)
}

# 火山图:读取 DE/DE_<比较名>.csv。阈值取自 DE_summary.csv(含各比较自己覆盖的阈值)
# 绘图区为正方形(aspect.ratio = 1);图例默认放在标题下方(legend_pos = "top"),颜色默认取 NPG(上调红、下调蓝、不显著灰)
run_volcano <- function(cfg, out_dir) {
  vc <- cfg$plots$volcano
  if (is.null(vc) || identical(vc$enabled, FALSE)) return(invisible(NULL))
  if (is.null(cfg$comparisons) || !length(cfg$comparisons)) { warn("No comparisons defined; volcano skipped"); return(invisible(NULL)) }
  pdir   <- ensure_dir(out_dir, "plots")
  fam    <- nz(cfg$plots$font_family, "Arial"); bs <- nz(cfg$plots$base_size, 6)
  all_nm <- vapply(cfg$comparisons, function(x) as.character(x$name), "")
  nms    <- if (is.null(vc$comparisons)) all_nm else vc$comparisons
  sf     <- file.path(out_dir, "DE", "DE_summary.csv")
  summ   <- if (file.exists(sf)) utils::read.csv(sf, check.names = FALSE, stringsAsFactors = FALSE) else NULL
  npg    <- palette_colors("npg", 10)
  cols   <- c(Up = nz(vc$up_color, npg[1]), Down = nz(vc$down_color, npg[4]), NS = nz(vc$ns_color, "grey75"))

  for (n in nms) {
    if (!n %in% all_nm) stop("Volcano: unknown comparison '", n, "'", call. = FALSE)
    f <- file.path(out_dir, "DE", paste0("DE_", n, ".csv"))
    if (!file.exists(f)) { warn("Volcano: ", f, " not found (run the 'de' step first); skipped"); next }
    msg("== volcano: ", n)
    cmp <- cfg$comparisons[[match(n, all_nm)]]
    d <- utils::read.csv(f, check.names = FALSE, stringsAsFactors = FALSE)
    d <- d[!is.na(d$padj) & !is.na(d$log2FC), , drop = FALSE]     # padj 为 NA(被过滤)的基因不画
    s <- if (!is.null(summ)) summ[summ$comparison == n, , drop = FALSE] else NULL
    has_s    <- !is.null(s) && nrow(s) == 1
    padj_cut <- if (has_s) s$padj_cutoff else cfg$de$padj
    lfc_cut  <- if (has_s) s$log2fc_cutoff else cfg$de$log2fc
    pos <- d$padj[d$padj > 0]
    if (length(pos)) d$padj[d$padj == 0] <- min(pos) / 10         # 避免 -log10(0) = Inf
    d$nlp <- -log10(d$padj)
    d$regulation <- factor(d$regulation, levels = c("Up", "Down", "NS"))
    cnt <- table(d$regulation)
    d <- d[order(d$regulation, decreasing = TRUE), ]              # NS 先画,显著基因压在上层
    xm <- max(abs(d$log2FC[is.finite(d$log2FC)]), lfc_cut) * 1.05

    sub_txt <- sprintf("adj. P < %g, |log2FC| >= %g", padj_cut, lfc_cut)
    if (has_s) sub_txt <- paste0(s$method, " | ", sub_txt)
    if (has_s && identical(s$path, "noreplicate"))
      sub_txt <- paste0(sub_txt, "\nNo replicates: P values are exploratory (fixed dispersion)")
    lp <- nz(vc$legend_pos, "right")                 # 图例位置:right(竖排) | top/bottom(一行) | none
    in_line <- lp %in% c("top", "bottom")
    p <- ggplot2::ggplot(d, ggplot2::aes(log2FC, nlp, color = regulation)) +
      ggplot2::geom_point(size = nz(vc$point_size, 0.5), alpha = 0.7, stroke = 0) +
      ggplot2::geom_vline(xintercept = c(-lfc_cut, lfc_cut), linetype = "dashed", linewidth = 0.2, color = "grey40") +
      ggplot2::geom_hline(yintercept = -log10(padj_cut), linetype = "dashed", linewidth = 0.2, color = "grey40") +
      ggplot2::scale_color_manual(values = cols, breaks = names(cols), name = NULL, drop = FALSE,
                                  labels = sprintf("%s (%d)", names(cols), as.integer(cnt[names(cols)]))) +
      # 3% 外扩:点不贴框,框边也留出写基因名的位置(标签不会被挤出画布)
      ggplot2::scale_x_continuous(limits = c(-xm, xm), expand = ggplot2::expansion(mult = 0.03)) +
      ggplot2::scale_y_continuous(expand = ggplot2::expansion(mult = c(0.03, 0.06))) +
      ggplot2::labs(x = expression(log[2]~"fold change"), y = expression(-log[10]~"(adj."~italic(P)*")"),
                    title = sprintf("%s vs %s", cmp$case, cmp$control),
                    subtitle = if (isTRUE(vc$show_subtitle)) sub_txt else NULL) +
      ggplot2::guides(color = ggplot2::guide_legend(nrow = if (in_line) 1L else NULL,
                                                    override.aes = list(size = 1.8, alpha = 1))) +
      ggplot2::theme_bw(base_size = bs, base_family = fam) +
      ggplot2::theme(aspect.ratio = 1, legend.position = lp,
                     legend.margin = ggplot2::margin(0, 0, 0, 0),
                     legend.key.height = grid::unit(2.4, "mm"),
                     legend.key.width = grid::unit(3.2, "mm")) +
      # 图例在上/下方时把它压紧到标题下面;放右侧时不需要这个负边距
      if (in_line) ggplot2::theme(legend.box.margin = ggplot2::margin(-1, 0, 2, 0)) else NULL

    # 标注基因:指定 label_genes,或 padj 最显著的 label_top 个差异基因
    if (!is.null(vc$label_genes)) {
      g <- unlist(vc$label_genes)
      if (any(!g %in% d$gene)) warn("Volcano '", n, "': label genes not in the table: ", paste(setdiff(g, d$gene), collapse = ", "))
      lab <- d[d$gene %in% g, , drop = FALSE]
    } else {
      nl  <- nz(vc$label_top, 10)
      sig <- d[d$regulation != "NS", , drop = FALSE]
      lab <- sig[order(sig$padj, -abs(sig$log2FC)), , drop = FALSE]
      lab <- lab[seq_len(min(nl, nrow(lab))), , drop = FALSE]
    }
    if (nrow(lab)) p <- p + do.call(ggrepel::geom_text_repel,
                                    c(list(data = lab, mapping = ggplot2::aes(label = gene), color = "black",
                                           size = pt2mm(bs - 1), family = fam, fontface = "italic",
                                           min.segment.length = 0, max.overlaps = Inf, show.legend = FALSE,
                                           segment.size = 0.2, box.padding = 0.25), label_halo(cfg)))
    # clip = "off":基因标签靠近坐标框边缘时不被裁掉半截
    p <- p + ggplot2::coord_cartesian(clip = "off")
    save_plot(p, file.path(pdir, paste0("volcano_", n)), cfg$plots, nz(vc$width_mm, 89), nz(vc$height_mm, 100))
  }
  invisible(TRUE)
}
# =============================================================================
# 第六部分:主流程
# =============================================================================
run_pipeline <- function(cfg = CONFIG, steps = c("de", "heatmap", "plots")) {
  if (!all(steps %in% c("de", "heatmap", "plots"))) stop("Unknown step; use de, heatmap, plots or all", call. = FALSE)
  out_dir <- ensure_dir(cfg$output_dir)
  # 绘图函数在没有打开设备时会在当前目录生成 Rplots.pdf;先开一个空设备接住,结束时关闭
  grDevices::pdf(NULL); on.exit(try(grDevices::graphics.off(), silent = TRUE), add = TRUE)
  .tk$log_file <- file.path(ensure_dir(out_dir, "logs"), "run.log")
  cat("", file = .tk$log_file)
  msg("steps: ", paste(steps, collapse = ", "))
  check_dependencies(cfg)

  # 1. 读数据、清洗、取整,并按配置建立样本表
  counts <- clean_counts(cfg)
  st     <- build_sample_table(cfg, colnames(counts))
  counts <- counts[, st$sample]
  msg("Groups: ", paste(sprintf("%s(n=%d)", levels(st$group), as.integer(table(st$group))), collapse = ", "))
  ensure_dir(out_dir, "data")
  write_table(data.frame(gene = rownames(counts), counts, check.names = FALSE),
              file.path(out_dir, "data", "counts_clean_integer.csv"))
  write_table(st, file.path(out_dir, "data", "sample_table.csv"))

  # 2. 差异分析(结果写入 DE/ 目录,热图的 deg 模式会从这里读取)
  if ("de" %in% steps) run_all_comparisons(cfg, counts, st, out_dir)

  # 3. 热图(表达量只计算一次,供整体热图和所有选定基因热图共用)
  need_expr <- "heatmap" %in% steps || ("plots" %in% steps && length(cfg$plots$pca) > 0)
  if (need_expr) expr <- compute_expression(counts, st, cfg$heatmap$transform)
  if ("heatmap" %in% steps) {
    run_overall_heatmap(cfg, counts, st, expr, out_dir)
    run_selected_heatmaps(cfg, st, expr, out_dir)
  }

  # 3b. PCA 与火山图(PCA 用上面的 vst 表达量;火山图读取 DE/ 目录里的结果)
  if ("plots" %in% steps) {
    run_pca(cfg, st, if (need_expr) expr else NULL, out_dir)
    run_volcano(cfg, out_dir)
  }

  # 4. 记录运行环境和所用配置,方便复现
  writeLines(capture.output(sessionInfo()), file.path(out_dir, "logs", "sessionInfo.txt"))
  writeLines(capture.output(dput(cfg)), file.path(out_dir, "logs", "config_used.txt"))
  msg("Done. Results in ", out_dir)
  invisible(NULL)
}

# 步骤优先级:CLI 第二参数 > params.json 的 steps > 全部(de + heatmap + plots)
if (!isTRUE(getOption("rnaseq.no_run"))) {
  steps <- if (!is.null(.steps_cli)) .steps_cli
           else if (!is.null(CONFIG$steps) && length(CONFIG$steps)) as.character(CONFIG$steps)
           else c("de", "heatmap", "plots")
  if ("all" %in% steps) steps <- c("de", "heatmap", "plots")
  run_pipeline(CONFIG, steps)
}
