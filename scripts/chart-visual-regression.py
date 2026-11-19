"""Generate verified templates and compare them with downloaded official references.

The official gallery uses different data in many examples, so this is a triage
report rather than a blind pass/fail pixel gate. Missing files fail; high visual
distance is reported for human review.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageChops, ImageOps, ImageStat

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_ROOT = ROOT / "src-tauri" / "r" / "chart-templates"
REPORT = ROOT / "docs" / "chart-visual-regression.json"

inventory = json.loads((ROOT / "docs" / "chart-gallery-inventory.json").read_text(encoding="utf-8"))
inventory_by_id = {item["id"]: item for item in inventory["templates"]}
verified = []
for manifest_path in sorted(TEMPLATE_ROOT.glob("*/manifest.json")):
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("status") != "verified":
        continue
    item = dict(inventory_by_id.get(manifest.get("id"), {}))
    item.update({"id": manifest.get("id", manifest_path.parent.name), "sourceUrl": manifest.get("sourceUrl", item.get("sourceUrl", ""))})
    verified.append(item)

with tempfile.TemporaryDirectory(prefix="mynx-visual-") as temp:
    output_dir = Path(temp)
    command = ["Rscript", str(ROOT / "scripts" / "chart-template-smoke.R"), str(output_dir)]
    run = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
    if run.returncode != 0:
        print(run.stdout)
        print(run.stderr, file=sys.stderr)
        raise SystemExit(run.returncode)

    results = []
    for item in verified:
        template_id = item["id"]
        reference = TEMPLATE_ROOT / template_id / "reference.png"
        generated = output_dir / f"{template_id}.png"
        result = {"id": template_id, "sourceUrl": item["sourceUrl"], "reference": reference.exists(), "generated": generated.exists()}
        if reference.exists() and generated.exists():
            ref = ImageOps.fit(Image.open(reference).convert("L"), (96, 96))
            actual = ImageOps.fit(Image.open(generated).convert("L"), (96, 96))
            ref = ImageOps.autocontrast(ref)
            actual = ImageOps.autocontrast(actual)
            difference = ImageChops.difference(ref, actual)
            result["meanAbsoluteDifference"] = round(ImageStat.Stat(difference).mean[0] / 255, 4)
            result["status"] = "review"
        else:
            result["status"] = "missing"
        results.append(result)

REPORT.write_text(json.dumps({"generatedAt": datetime.now(timezone.utc).isoformat(), "results": results}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
missing = [item["id"] for item in results if item["status"] == "missing"]
review = [item["id"] for item in results if item["status"] == "review"]
print(f"视觉回归报告已生成：{REPORT}")
print(f"完整输出：{len(review)}/{len(results)}；缺失：{len(missing)}；因官网示例数据不同需人工复核：{len(review)}")
if missing:
    print("缺失模板：" + ", ".join(missing), file=sys.stderr)
    raise SystemExit(1)
