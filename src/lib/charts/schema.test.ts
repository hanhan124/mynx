import { validateTemplateCatalog, validateTemplateManifest } from "./schema.ts";

// 可由未来的 Vitest 直接复用；保持无副作用，避免把测试框架带入生产包。
export const chartSchemaTestCases = {
  rejectsMissingSource: () => !validateTemplateManifest({ id: "x", name: "x", family: "x", status: "draft", packages: [], outputs: ["png"], dataRoles: [] }).valid,
  rejectsDuplicateIds: () => !validateTemplateCatalog([
    { id: "x", name: "x", family: "x", status: "draft", sourceUrl: "https://example.com", packages: [], outputs: ["png"], dataRoles: [{ key: "x", label: "x", acceptedTypes: ["number"], required: true, description: "x" }] },
    { id: "x", name: "y", family: "x", status: "draft", sourceUrl: "https://example.com", packages: [], outputs: ["png"], dataRoles: [{ key: "x", label: "x", acceptedTypes: ["number"], required: true, description: "x" }] },
  ]).valid,
  acceptsPublicationOutputs: () => validateTemplateManifest({
    id: "publication",
    name: "投稿图",
    family: "barplot",
    status: "draft",
    sourceUrl: "https://example.com",
    packages: [],
    outputs: ["png", "tiff", "svg", "pdf", "eps"],
    dataRoles: [{ key: "x", label: "X", acceptedTypes: ["number"], required: true, description: "X" }],
  }).valid,
};
