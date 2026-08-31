import type { ChartTemplateManifest, ManifestValidationResult } from "./types.ts";

// 与 R 运行时及 ChartOutputFormat 保持一致：投稿常用位图与矢量格式都可声明。
const outputs = new Set(["png", "svg", "pdf", "tiff", "eps", "html"]);
const dataTypes = new Set(["string", "number", "date", "boolean"]);

export function validateTemplateManifest(value: unknown): ManifestValidationResult {
  const errors: string[] = [];
  if (!value || typeof value !== "object") return { valid: false, errors: ["模板配置必须是对象"] };
  const manifest = value as Partial<ChartTemplateManifest>;
  if (!manifest.id?.trim()) errors.push("缺少模板 ID");
  if (!manifest.name?.trim()) errors.push("缺少模板名称");
  if (!manifest.family?.trim()) errors.push("缺少图表类型");
  if (!/^https:\/\//.test(manifest.sourceUrl ?? "")) errors.push("缺少有效的官网来源链接");
  if (manifest.status !== "draft" && manifest.status !== "verified") errors.push("模板状态必须为 draft 或 verified");
  if (manifest.status === "verified" && !manifest.sourceRepoPath?.trim()) errors.push("已验证模板必须提供官方源文件路径");
  if (!Array.isArray(manifest.packages)) errors.push("packages 必须为数组");
  if (!Array.isArray(manifest.outputs) || manifest.outputs.length === 0) errors.push("至少需要一种输出格式");
  else if (manifest.outputs.some((format) => !outputs.has(format))) errors.push("输出格式不受支持");
  if (!Array.isArray(manifest.dataRoles) || manifest.dataRoles.length === 0) errors.push("至少需要一个数据字段定义");
  else {
    for (const role of manifest.dataRoles) {
      if (!role.key || !role.label) errors.push("数据字段缺少 key 或标签");
      if (!Array.isArray(role.acceptedTypes) || role.acceptedTypes.length === 0) errors.push(`${role.key || "数据字段"} 未定义可接受类型`);
      else if (role.acceptedTypes.some((type) => !dataTypes.has(type))) errors.push(`${role.key || "数据字段"} 包含不受支持的数据类型`);
    }
  }
  if (manifest.status === "verified") {
    if (!manifest.samplePath) errors.push("已验证模板必须附带示例数据");
    if (!manifest.renderPath) errors.push("已验证模板必须附带独立 R 脚本");
    if (!manifest.referencePath) errors.push("已验证模板必须附带参考图");
  }
  return { valid: errors.length === 0, errors };
}

export function validateTemplateCatalog(manifests: unknown[]): ManifestValidationResult {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const manifest of manifests) {
    const result = validateTemplateManifest(manifest);
    errors.push(...result.errors);
    const id = (manifest as Partial<ChartTemplateManifest>)?.id;
    if (id && ids.has(id)) errors.push(`模板 ID 重复：${id}`);
    if (id) ids.add(id);
  }
  return { valid: errors.length === 0, errors };
}
