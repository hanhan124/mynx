import { describe, expect, it } from "vitest";
import {
  CHART_FAMILY_EN,
  CHART_TEMPLATE_EN,
  ROLE_FIELD_MAP,
  chartTemplates,
  legacyTemplateMigration,
  localizedFamily,
  localizedTemplate,
  templateById,
  templateDefaults,
  verifiedChartTemplates,
  type MappedField,
} from "./catalog.js";

/** Ported catalog integrity: the Rust resource dir serves exactly these 57
 * verified templates; the mapping tables must stay in sync with them. */
describe("chart catalog integrity", () => {
  it("serves exactly 57 verified templates with unique ids", () => {
    expect(chartTemplates).toHaveLength(57);
    expect(verifiedChartTemplates).toHaveLength(57);
    const ids = chartTemplates.map((item) => item.id);
    expect(new Set(ids).size).toBe(57);
  });

  it("keeps catalog fields non-empty and verified status", () => {
    for (const template of chartTemplates) {
      expect(template.id.length).toBeGreaterThan(0);
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
      expect(template.kind.length).toBeGreaterThan(0);
      expect(template.galleryUrl).toMatch(/^https:\/\//);
      expect(template.status).toBe("verified");
      expect(template.icon).toBeDefined();
    }
  });

  it("offers the shared publication output formats", () => {
    for (const template of chartTemplates) {
      expect(template.outputs).toEqual(["png", "tiff", "svg", "pdf", "eps"]);
    }
  });

  it("resolves templates by id via the lookup map", () => {
    expect(templateById.size).toBe(57);
    expect(templateById.get("bar-basic-ggplot2")?.kind).toBe("bar");
    expect(templateById.get("km-survival-ggplot2")?.family).toBe("高级图");
  });

  it("covers every catalog id in the role-field map and defaults tables", () => {
    for (const template of chartTemplates) {
      expect(ROLE_FIELD_MAP[template.id], `ROLE_FIELD_MAP[${template.id}]`).toBeDefined();
      expect(templateDefaults[template.id], `templateDefaults[${template.id}]`).toBeDefined();
    }
  });

  it("maps each role onto a valid config field at most once", () => {
    const fields: MappedField[] = ["x", "y", "group", "size"];
    for (const [templateId, roleMap] of Object.entries(ROLE_FIELD_MAP)) {
      const used = Object.values(roleMap);
      for (const field of used) {
        expect(fields, `${templateId}: ${field}`).toContain(field);
      }
      expect(new Set(used).size, `${templateId} duplicate field`).toBe(used.length);
    }
  });

  it("keeps defaults aligned with the mapped config fields", () => {
    for (const [templateId, defaults] of Object.entries(templateDefaults)) {
      const roleMap = ROLE_FIELD_MAP[templateId];
      const mappedFields = new Set(Object.values(roleMap ?? {}));
      for (const [field, value] of Object.entries(defaults)) {
        if (value === "") continue;
        expect(mappedFields.has(field as MappedField), `${templateId}.${field}`).toBe(true);
      }
    }
  });

  it("ships English copy for every template and family", () => {
    for (const template of chartTemplates) {
      expect(CHART_TEMPLATE_EN[template.id], template.id).toBeDefined();
      expect(CHART_FAMILY_EN[template.family], template.family).toBeDefined();
    }
  });

  it("localizes templates and families per language", () => {
    const bar = templateById.get("bar-basic-ggplot2");
    expect(bar).toBeDefined();
    expect(localizedTemplate(bar!, "zh").name).toBe("基础柱状图");
    expect(localizedTemplate(bar!, "en").name).toBe("Basic bar chart");
    expect(localizedFamily("基础比较", "en")).toBe("Basic comparison");
    expect(localizedFamily("基础比较", "zh")).toBe("基础比较");
    expect(localizedFamily("未知族", "en")).toBe("未知族");
  });

  it("migrates every legacy parameter id onto a catalog template", () => {
    for (const targetId of Object.values(legacyTemplateMigration)) {
      expect(templateById.has(targetId), targetId).toBe(true);
    }
  });
});
