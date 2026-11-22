/**
 * File dialogs for chat-next: export one conversation (Markdown / JSON),
 * export everything (ZIP), import a ZIP or JSON bundle, download artifacts.
 * Tauri dialogs + fs in the app, anchor/file-input fallbacks in previews.
 */
import JSZip from "jszip";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { pushToast } from "../../../app/state.svelte";
import { t } from "../../../app/i18n.svelte";
import { conversationMarkdown, exportBundle, fileNameFor, parseBundle } from "../core/exporting.js";
import { chatNext, importConversations, nodesOf } from "./chat-next.svelte.js";
import { isTauri } from "./repository.js";

const BUNDLE_ENTRY = "mynx-chat.json";

function labels() {
  return { user: t("chatNext.you"), assistant: t("chatNext.assistant"), untitled: t("chatNext.untitled") };
}

function anchorDownload(data: Uint8Array | string, name: string, type: string): void {
  const blob = typeof data === "string" ? new Blob([data], { type }) : new Blob([data.buffer as ArrayBuffer], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Save text or bytes through the native dialog (browser download fallback). */
export async function saveFile(name: string, data: string | Uint8Array, extension: string, type: string): Promise<boolean> {
  if (!isTauri()) {
    anchorDownload(data, name, type);
    return true;
  }
  const path = await saveDialog({ defaultPath: name, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
  if (typeof path !== "string" || !path) return false;
  if (typeof data === "string") await writeTextFile(path, data);
  else await writeFile(path, data);
  return true;
}

async function guarded(action: () => Promise<boolean>): Promise<void> {
  try {
    if (await action()) pushToast("success", t("chatNext.exported"));
  } catch (error) {
    pushToast("error", t("chatNext.exportFailed", { detail: error instanceof Error ? error.message : String(error) }));
  }
}

export function exportConversation(id: string, format: "md" | "json"): Promise<void> {
  const conversation = chatNext.snapshot.conversations.find((c) => c.id === id);
  if (!conversation) return Promise.resolve();
  const nodes = nodesOf(id);
  const snapshotConversation = $state.snapshot(conversation);
  const snapshotNodes = $state.snapshot(nodes);
  return guarded(() =>
    format === "md"
      ? saveFile(fileNameFor(conversation.title, "md"), conversationMarkdown(snapshotConversation, snapshotNodes, labels()), "md", "text/markdown")
      : saveFile(
          fileNameFor(conversation.title, "json"),
          JSON.stringify(exportBundle([{ conversation: snapshotConversation, nodes: snapshotNodes }]), null, 2),
          "json",
          "application/json",
        ),
  );
}

export function exportAll(): Promise<void> {
  return guarded(async () => {
    const items = $state
      .snapshot(chatNext.snapshot.conversations)
      .filter((c) => !c.temporary)
      .map((conversation) => ({ conversation, nodes: $state.snapshot(nodesOf(conversation.id)) }));
    const zip = new JSZip();
    zip.file(BUNDLE_ENTRY, JSON.stringify(exportBundle(items)));
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const used = new Set<string>();
    for (const item of items) {
      let name = fileNameFor(item.conversation.title, "md");
      for (let n = 2; used.has(name); n += 1) name = fileNameFor(`${item.conversation.title} ${n}`, "md");
      used.add(name);
      zip.file(`markdown/${name}`, conversationMarkdown(item.conversation, item.nodes, labels()));
    }
    const data = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    return saveFile("mynx-chat-export.zip", data, "zip", "application/zip");
  });
}

function applyImport(json: string | null): void {
  const items = json ? parseBundle(json) : null;
  if (!items) {
    pushToast("error", t("chatNext.importFailed"));
    return;
  }
  pushToast("success", t("chatNext.imported", { count: importConversations(items) }));
}

async function bundleFrom(bytes: Uint8Array, name: string): Promise<string | null> {
  if (name.toLowerCase().endsWith(".json")) return new TextDecoder().decode(bytes);
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file(BUNDLE_ENTRY) ?? zip.file(/\.json$/i)[0] ?? null;
  return entry ? entry.async("string") : null;
}

export async function importArchive(): Promise<void> {
  try {
    if (isTauri()) {
      const picked = await openDialog({ multiple: false, directory: false, filters: [{ name: "ZIP / JSON", extensions: ["zip", "json"] }] });
      if (typeof picked !== "string" || !picked) return;
      applyImport(await bundleFrom(await readFile(picked), picked));
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,.json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.arrayBuffer().then(async (buffer) => applyImport(await bundleFrom(new Uint8Array(buffer), file.name)));
    };
    input.click();
  } catch {
    pushToast("error", t("chatNext.importFailed"));
  }
}
