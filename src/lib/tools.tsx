import type { ComponentType } from "react";
import { IconFlask, IconPhoto } from "@tabler/icons-react";
import { lazy } from "react";

/**
 * Tool registry — single source of truth for app tools.
 *
 * To add a new tool:
 * 1. Create the page component in src/pages/<tool>/
 * 2. Add a lazy import below
 * 3. Add an entry to the `tools` array
 *
 * Routes, sidebar navigation, and home page cards are all
 * generated automatically from this array.
 */

/** Icon component type compatible with @tabler/icons-react. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IconType = ComponentType<any>;

export interface Tool {
  id: string;
  title: string;
  description: string;
  /** Route path, e.g. "/qpcr" */
  path: string;
  /** Accent color for icon background (hex) */
  accent: string;
  /** @tabler/icons-react icon component */
  icon: IconType;
  /** Lazy-loaded page component */
  component: ComponentType;
  /** Short label for sidebar (defaults to title) */
  navLabel: string;
  /** Whether to show in sidebar (default true) */
  showInSidebar: boolean;
}

const QpcrPage = lazy(() => import("@/pages/qPCR/QpcrPage"));
const TiffPage = lazy(() => import("@/pages/tiff/TiffPage"));

export const tools: Tool[] = [
  {
    id: "qpcr",
    title: "qPCR 分析",
    description: "qPCR 数据处理与图表",
    path: "/qpcr",
    accent: "#007aff",
    icon: IconFlask,
    component: QpcrPage,
    navLabel: "qPCR",
    showInSidebar: true,
  },
  {
    id: "tiff",
    title: "TIFF 转 JPG",
    description: "TIFF 批量转 JPG",
    path: "/tiff",
    accent: "#34c759",
    icon: IconPhoto,
    component: TiffPage,
    navLabel: "TIFF",
    showInSidebar: true,
  },
];

/** Get a tool by its route path. */
export function getToolByPath(path: string): Tool | undefined {
  return tools.find((t) => t.path === path);
}

/** Page title for a given route path (used by TitleBar). */
export function getPageTitle(path: string): string {
  if (path === "/") return "Mynx";
  return getToolByPath(path)?.title ?? "Mynx";
}
