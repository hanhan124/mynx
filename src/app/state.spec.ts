import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  normalizeTheme,
  resolveTheme,
  upsertTask,
  pushToast,
  dismissToast,
  app,
} from "./state.svelte";
import type { TaskRecord } from "../lib/contracts/generated/task/TaskRecord.js";

describe("normalizeTheme (legacy parity)", () => {
  it("normalizes legacy dark/light values", () => {
    expect(normalizeTheme("dark")).toBe("graphite");
    expect(normalizeTheme("light")).toBe("pearl");
    expect(normalizeTheme("DARK")).toBe("graphite");
    expect(normalizeTheme("Light")).toBe("pearl");
  });

  it("accepts explicit theme ids", () => {
    expect(normalizeTheme("system")).toBe("system");
    expect(normalizeTheme("graphite")).toBe("graphite");
    expect(normalizeTheme("pearl")).toBe("pearl");
  });

  it("falls back to the default theme", () => {
    expect(normalizeTheme(null)).toBe(DEFAULT_THEME);
    expect(normalizeTheme(undefined)).toBe(DEFAULT_THEME);
    expect(normalizeTheme("")).toBe(DEFAULT_THEME);
    expect(normalizeTheme("solarized")).toBe(DEFAULT_THEME);
  });
});

describe("resolveTheme", () => {
  it("passes concrete themes through", () => {
    expect(resolveTheme("graphite")).toBe("graphite");
    expect(resolveTheme("pearl")).toBe("pearl");
  });

  it("resolves system to a concrete theme", () => {
    const resolved = resolveTheme("system");
    expect(resolved === "graphite" || resolved === "pearl").toBe(true);
  });
});

function makeTask(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    v: 1,
    id: 1,
    kind: "imageConvert",
    label: "demo",
    status: "queued",
    createdAtMs: 1,
    startedAtMs: null,
    finishedAtMs: null,
    progress: null,
    detail: null,
    error: null,
    outputDir: null,
    ...overrides,
  };
}

describe("task list state", () => {
  it("upserts tasks and keeps them newest-first", () => {
    const originalLength = app.tasks.length;
    const older = makeTask({ id: 1, createdAtMs: 100 });
    const newer = makeTask({ id: 2, createdAtMs: 200 });
    upsertTask(older);
    upsertTask(newer);
    expect(app.tasks[0].id).toBe(2);
    upsertTask(makeTask({ id: 1, createdAtMs: 100, status: "succeeded" }));
    expect(app.tasks).toHaveLength(originalLength + 2);
    expect(app.tasks[0].id).toBe(2);
    expect(app.tasks.find((task) => task.id === 1)?.status).toBe("succeeded");
    app.tasks.splice(0, app.tasks.length);
  });
});

describe("toast state", () => {
  it("pushes and dismisses toasts", () => {
    const before = app.toasts.length;
    pushToast("info", "hello");
    expect(app.toasts.length).toBe(before + 1);
    const toast = app.toasts[app.toasts.length - 1];
    dismissToast(toast.id);
    expect(app.toasts.length).toBe(before);
  });
});
