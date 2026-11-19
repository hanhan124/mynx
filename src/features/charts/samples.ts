/**
 * Per-template demo datasets (legacy ChartStudioPage `samples` map). Each
 * sample's header matches the template's manifest dataRoles + sample.csv, so
 * the auto field mapping lands on the correct columns.
 */
export const samples: Record<string, string> = {
  "bar-basic-ggplot2": "group,value\nA,12\nB,19\nC,9\nD,15\n",
  "line-basic-ggplot2": "day,value\n1,8\n2,11\n3,9\n4,14\n5,17\n",
  "scatter-basic-ggplot2": "x,y\n1,2\n2,3\n3,2.5\n4,5\n5,4.5\n",
  "histogram-basic-ggplot2": "value\n4\n5\n6\n7\n7\n8\n9\n10\n11\n12\n",
  "boxplot-basic-ggplot2": "group,value\nA,5\nA,7\nA,6\nB,9\nB,11\nB,10\n",
  "density-basic-ggplot2": "value\n4\n5\n6\n6\n7\n7\n8\n9\n10\n11\n12\n",
  "violin-basic-ggplot2": "group,value\nA,5\nA,7\nA,6\nA,8\nB,9\nB,11\nB,10\nB,12\n",
  "pie-basic-ggplot2": "group,value\nA,12\nB,19\nC,9\nD,15\n",
  "heatmap-basic-ggplot2":
    "row,col,value\nA,X,4\nA,Y,8\nA,Z,5\nB,X,7\nB,Y,3\nB,Z,9\nC,X,6\nC,Y,5\nC,Z,8\n",
  "radar-basic-ggplot2": "metric,value\n速度,8\n质量,7\n稳定性,9\n易用性,6\n扩展性,8\n",
  "area-basic-ggplot2": "day,value\n1,8\n2,11\n3,9\n4,14\n5,17\n",
  "regression-basic-ggplot2": "x,y\n1,2\n2,3\n3,2.5\n4,5\n5,4.5\n6,6\n",
  "lollipop-basic-ggplot2": "group,value\nA,12\nB,19\nC,9\nD,15\n",
  "donut-basic-ggplot2": "group,value\nA,12\nB,19\nC,9\nD,15\n",
  "circular-bar-basic-ggplot2": "group,value\nA,12\nB,19\nC,9\nD,15\nE,13\n",
  "grouped-bar-basic-ggplot2":
    "group,series,value\nA,一组,12\nA,二组,18\nB,一组,9\nB,二组,15\nC,一组,14\nC,二组,11\n",
  "stacked-bar-basic-ggplot2":
    "group,series,value\nA,一组,12\nA,二组,18\nB,一组,9\nB,二组,15\nC,一组,14\nC,二组,11\n",
  "bubble-basic-ggplot2": "x,y,size\n1,2,10\n2,3,16\n3,2.5,12\n4,5,24\n5,4.5,19\n",
  "correlogram-basic-ggplot2":
    "speed,quality,stability\n8,7,9\n7,8,8\n9,9,7\n6,7,8\n8,6,9\n",
  "dendrogram-basic-ggplot2":
    "speed,quality,stability\n8,7,9\n7,8,8\n9,9,7\n6,7,8\n8,6,9\n",
  "parallel-basic-ggplot2":
    "speed,quality,stability,usability\n8,7,9,6\n7,8,8,8\n9,9,7,7\n6,7,8,9\n8,6,9,7\n",
  "network-basic-ggplot2": "from,to,weight\nA,B,4\nA,C,2\nB,C,3\nC,D,5\nD,A,1\n",
  "sankey-basic-ggplot2":
    "from,to,value\n访问,注册,42\n访问,离开,18\n注册,购买,25\n注册,离开,17\n",
  "chord-basic-ggplot2": "from,to,value\n甲,乙,4\n甲,丙,2\n乙,丙,3\n丙,丁,5\n丁,甲,1\n",
  "map-points-basic-ggplot2":
    "longitude,latitude,value\n116.38,39.90,12\n121.47,31.23,19\n113.26,23.13,9\n114.06,22.54,15\n",
  "wordcloud-basic": "word,freq\n分析,42\n可视化,35\n数据,31\n实验,22\n结果,18\n",
  "venn-basic": "set,size\nA,12\nB,10\nAB,5\n",
  "connected-scatter-basic-ggplot2": "step,x,y\n1,1,2\n2,2,3\n3,3,2.5\n4,4,5\n5,5,4.5\n",
  "slope-basic-ggplot2": "group,before,after\nA,12,18\nB,19,15\nC,9,14\nD,15,17\n",
  "table-basic": "指标,数值\n速度,8\n质量,7\n稳定性,9\n易用性,6\n",
  "ridgeline-basic": "group,value\nA,5\nA,7\nA,6\nA,8\nB,9\nB,11\nB,10\nB,12\n",
  "beeswarm-basic": "group,value\nA,5\nA,7\nA,6\nA,8\nB,9\nB,11\nB,10\nB,12\n",
  "waffle-basic": "group,value\nA,12\nB,19\nC,9\nD,15\n",
  "treemap-basic": "group,value\nA,12\nB,19\nC,9\nD,15\n",
  "alluvial-basic":
    "stage1,stage2,stage3,value\n新客,注册,购买,25\n新客,注册,离开,17\n回访,购买,复购,18\n回访,购买,离开,12\n",
  "upset-basic": "A,B,C\n1,1,0\n1,1,1\n1,0,1\n0,1,1\n1,1,0\n",
  "hexbin-basic":
    "x,y\n1,2\n1.2,2.1\n1.1,1.9\n2,3\n2.1,3.2\n3,2.5\n3.1,2.6\n4,5\n4.2,4.8\n",
  "bubble-map-basic":
    "longitude,latitude,value\n116.38,39.90,12\n121.47,31.23,19\n113.26,23.13,9\n114.06,22.54,15\n",
  "choropleth-basic":
    'region,value,wkt\n甲区,12,"POLYGON ((0 0, 1 0, 1 1, 0 1, 0 0))"\n乙区,19,"POLYGON ((1 0, 2 0, 2 1, 1 1, 1 0))"\n丙区,9,"POLYGON ((0 1, 1 1, 1 2, 0 2, 0 1))"\n丁区,15,"POLYGON ((1 1, 2 1, 2 2, 1 2, 1 1))"\n',
  "density2d-basic-ggplot2":
    "x,y\n1,2\n1.2,2.1\n1.1,1.9\n2,3\n2.1,3.2\n3,2.5\n3.1,2.6\n4,5\n4.2,4.8\n",
  "arc-basic": "from,to\nA,B\nA,C\nB,C\nC,D\nD,A\n",
  "edge-bundling-basic": "from,to\nA,B\nA,C\nA,D\nB,C\nB,D\nC,D\n",
  "stacked-area-basic-ggplot2":
    "day,series,value\n1,一组,8\n1,二组,5\n2,一组,11\n2,二组,6\n3,一组,9\n3,二组,8\n4,一组,14\n4,二组,9\n5,一组,17\n5,二组,11\n",
  "streamchart-basic-ggplot2":
    "day,series,value\n1,一组,8\n1,二组,5\n2,一组,11\n2,二组,6\n3,一组,9\n3,二组,8\n4,一组,14\n4,二组,9\n5,一组,17\n5,二组,11\n",
  "circular-packing-basic": "group,value\nA,12\nB,19\nC,9\nD,15\n",
  "time-series-basic-ggplot2":
    "date,value\n2026-01-01,8\n2026-02-01,11\n2026-03-01,9\n2026-04-01,14\n2026-05-01,17\n",
  "connection-basic": "from,to\n北京,上海\n北京,广州\n上海,深圳\n广州,成都\n",
  "cartogram-basic": "region,value\n甲区,12\n乙区,19\n丙区,9\n丁区,15\n",
  "dotplot-basic-ggplot2": "group,value\nA,12\nB,19\nC,9\nD,15\n",
  "cleveland-basic-ggplot2": "group,before,after\nA,12,18\nB,19,15\nC,9,14\nD,15,17\n",
  "volcano-basic-ggplot2":
    "gene,log2FC,padj\nGene_A,2.8,0.0004\nGene_B,-2.3,0.0012\nGene_C,1.6,0.018\nGene_D,-1.4,0.031\nGene_E,0.4,0.42\nGene_F,-0.2,0.68\nGene_G,3.2,0.00008\nGene_H,-2.8,0.0003\n",
  "ma-basic-ggplot2":
    "gene,baseMean,log2FC,padj\nGene_A,120,2.1,0.002\nGene_B,35,-1.8,0.01\nGene_C,680,0.8,0.12\nGene_D,240,-0.9,0.08\nGene_E,42,1.4,0.03\nGene_F,920,-2.2,0.0007\nGene_G,150,0.1,0.85\nGene_H,310,1.9,0.004\n",
  "pca-basic-ggplot2":
    "sample,group,gene_A,gene_B,gene_C,gene_D,gene_E\nS1,对照,8,7,9,6,8\nS2,对照,7,8,8,7,9\nS3,对照,9,9,7,8,8\nS4,处理,3,4,2,5,3\nS5,处理,4,3,3,4,2\nS6,处理,2,5,4,3,4\n",
  "forest-basic-ggplot2":
    "term,estimate,low,high\n总体,1.42,1.15,1.76\n年龄,1.18,1.02,1.37\n治疗组,0.68,0.52,0.88\n生物标志物,1.91,1.36,2.68\n吸烟,1.27,0.96,1.68\n",
  "enrichment-dotplot-ggplot2":
    "term,geneRatio,padj,count\n细胞周期,0.42,0.0008,38\nDNA 修复,0.31,0.003,27\n免疫反应,0.26,0.009,24\n氧化磷酸化,0.22,0.018,19\n细胞凋亡,0.18,0.041,16\nRNA 剪接,0.14,0.083,12\n",
  "km-survival-ggplot2":
    "time,event,group\n3,1,对照\n5,0,对照\n7,1,对照\n8,0,对照\n10,1,对照\n4,1,处理\n6,1,处理\n9,0,处理\n11,1,处理\n13,0,处理\n",
  "gsea-curve-ggplot2":
    "rank,score,inSet\n1,2.8,1\n2,2.5,0\n3,2.2,0\n4,2.0,1\n5,1.8,0\n6,1.5,0\n7,1.2,0\n8,1.0,1\n9,0.8,0\n10,0.6,0\n11,0.3,0\n12,0.1,1\n13,-0.2,0\n14,-0.5,0\n15,-0.8,0\n",
};
