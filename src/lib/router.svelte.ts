import { app } from "../app/state.svelte";
import {
  beginChartNavigation,
  currentChartNavigationId,
  endChartNavigation,
  recordChartNavigationStage,
} from "./chart-navigation-timings.js";

export const ROUTES = ["/", "/settings", "/image", "/qpcr", "/rnaseq", "/charts"] as const;

export type Route = (typeof ROUTES)[number];

/** Legacy hash routes redirected onto the new route set. */
const REDIRECTS: Record<string, Route> = {
  "/tiff": "/image",
  "/search-window": "/",
};

const ROUTE_SET = new Set<string>(ROUTES);

function canonicalRoute(input: string): string {
  let raw = input.trim();
  if (raw.startsWith("#")) raw = raw.slice(1);
  if (raw === "" || raw === "/") return "/";
  if (!raw.startsWith("/")) raw = `/${raw}`;
  // Strip a trailing slash except for the root route.
  if (raw.length > 1 && raw.endsWith("/")) raw = raw.slice(0, -1);
  const redirected = REDIRECTS[raw];
  if (redirected) return redirected;
  if (ROUTE_SET.has(raw)) return raw;
  return "/";
}

function currentHashRoute(): string {
  if (typeof window === "undefined") return "/";
  return canonicalRoute(window.location.hash);
}

function applyRoute(next: string): void {
  const previous = app.route;
  if (previous === next) {
    app.route = next;
    return;
  }

  if (previous === "/charts") endChartNavigation(currentChartNavigationId());
  if (next === "/charts") {
    const sampleId = beginChartNavigation();
    app.route = next;
    recordChartNavigationStage(sampleId, "routeUpdated", "hash-router");
    return;
  }
  app.route = next;
}

/**
 * Hash router. The single source of truth is `app.route` in global state;
 * `location.hash` mirrors it so back/forward keeps working.
 */
export const router = {
  navigate(route: string): void {
    const next = canonicalRoute(route);
    if (typeof window === "undefined") {
      applyRoute(next);
      return;
    }
    if (window.location.hash === `#${next}`) {
      applyRoute(next);
      return;
    }
    // Changing the hash fires `hashchange`, which applies the route.
    window.location.hash = `#${next}`;
  },

  /** Parse a hash without mutating anything (used by tests/listeners). */
  parse(route: string): string {
    return canonicalRoute(route);
  },
};

/** Standalone navigate helper for components. */
export function navigate(route: string): void {
  router.navigate(route);
}

let started = false;

/** Install the hashchange listener and apply the current hash once. */
export function startRouter(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("hashchange", () => {
    applyRoute(canonicalRoute(window.location.hash));
  });
  applyRoute(currentHashRoute());
}

/** i18n key for the route's display name (call `t()` with it). */
export function routeTitleKey(route: string): string {
  switch (route) {
    case "/":
      return "nav.home";
    case "/settings":
      return "nav.settings";
    case "/image":
      return "nav.image";
    case "/qpcr":
      return "nav.qpcr";
    case "/rnaseq":
      return "nav.rnaseq";
    case "/charts":
      return "nav.charts";
    default:
      return "nav.home";
  }
}
