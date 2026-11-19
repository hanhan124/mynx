/* Generate a qPCR long-format xlsx fixture (dev-only audit harness).
   2 groups x 3 samples x 2 technical replicates x 4 genes. */
import ExcelJS from "exceljs";

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Raw Data");
ws.addRow(["Target", "Sample", "Cq"]);

const genes = {
  ACTB: { Control: [18.2, 18.3, 18.15], Treat: [18.1, 18.4, 18.25] },
  GAPDH: { Control: [19.0, 19.1, 18.95], Treat: [19.2, 19.0, 19.1] },
  TP53: { Control: [24.5, 24.7, 24.6], Treat: [22.3, 22.5, 22.4] },
  MYC: { Control: [26.0, 26.2, 26.1], Treat: [28.4, 28.6, 28.5] },
};

for (const [gene, groups] of Object.entries(genes)) {
  for (const [group, sampleMeans] of Object.entries(groups)) {
    for (let s = 0; s < 3; s++) {
      for (let r = 0; r < 2; r++) {
        const jitter = r === 0 ? 0 : 0.15;
        ws.addRow([gene, `${group}_${s + 1}`, +(sampleMeans[s] + jitter).toFixed(3)]);
      }
    }
  }
}

await wb.xlsx.writeFile("C:/Users/HAN/AppData/Local/Temp/mynx-audit-fixtures/qpcr-test-data.xlsx");
console.log("fixture written: rows =", ws.rowCount);
