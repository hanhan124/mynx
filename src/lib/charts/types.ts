export type TemplateStatus = "draft" | "verified";
export type ChartOutputFormat = "png" | "svg" | "pdf" | "tiff" | "eps" | "html";
export type DataValueType = "string" | "number" | "date" | "boolean";

export interface DataRoleDefinition {
  key: string;
  label: string;
  acceptedTypes: DataValueType[];
  required: boolean;
  description: string;
}

export interface ChartTemplateManifest {
  id: string;
  name: string;
  family: string;
  status: TemplateStatus;
  sourceUrl: string;
  /** 已验证模板必须是 R Graph Gallery 官方仓库的具体源文件路径。 */
  sourceRepoPath?: string;
  packages: string[];
  outputs: ChartOutputFormat[];
  dataRoles: DataRoleDefinition[];
  samplePath?: string;
  renderPath?: string;
  defaultsPath?: string;
  referencePath?: string;
}

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
}
