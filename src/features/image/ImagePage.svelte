<script lang="ts">
  import { tick, untrack } from "svelte";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { open as openDialog } from "@tauri-apps/plugin-dialog";
  import { createVirtualizer, defaultRangeExtractor } from "@tanstack/svelte-virtual";
  import IconAdjustments from "@tabler/icons-svelte/icons/adjustments";
  import IconFolder from "@tabler/icons-svelte/icons/folder";
  import IconFolderOpen from "@tabler/icons-svelte/icons/folder-open";
  import IconFolderPlus from "@tabler/icons-svelte/icons/folder-plus";
  import IconInfoCircle from "@tabler/icons-svelte/icons/info-circle";
  import IconPhoto from "@tabler/icons-svelte/icons/photo";
  import IconPhotoPlus from "@tabler/icons-svelte/icons/photo-plus";
  import IconPlayerStop from "@tabler/icons-svelte/icons/player-stop";
  import IconTrash from "@tabler/icons-svelte/icons/trash";
  import IconX from "@tabler/icons-svelte/icons/x";
  import { t } from "../../app/i18n.svelte";
  import { panelWidths, savePanelWidths, setPanelWidth } from "../../app/panel-widths.svelte";
  import ColumnResizeHandle from "../../components/ColumnResizeHandle.svelte";
  import { openPath } from "../../app/tauri.js";
  import CopyableText from "../../components/CopyableText.svelte";
  import {
    IMAGE_EXTENSIONS,
    addPaths,
    baseName,
    cancelConversion,
    clearAll,
    filterImageDropPaths,
    formatBytes,
    imageState,
    loadImageSettings,
    removeItem,
    runConversion,
    scheduleThumbnails,
    updateSettings,
    updateWatermark,
    type ItemResult,
  } from "./state.svelte";

  /* Display-only option catalogs (ported from legacy OptionsPanel). */
  const MODE_OPTIONS = [
    { id: "lossless", key: "imgconv.modeLossless" },
    { id: "lossy", key: "imgconv.modeLossy" },
  ] as const;
  const LEVEL_OPTIONS = [
    { id: 1, key: "imgconv.levelFast" },
    { id: 2, key: "imgconv.levelBalanced" },
    { id: 3, key: "imgconv.levelMax" },
  ] as const;
  const COLOR_COUNTS = [256, 128, 64, 32];
  const FONTS = ["微软雅黑", "黑体", "宋体", "Arial", "Calibri", "Times New Roman"];
  const FONT_SIZES = [36, 48, 60, 72, 96, 120];
  const WM_KIND_OPTIONS = [
    { id: "text", key: "imgconv.wmText" },
    { id: "image", key: "imgconv.wmImage" },
  ] as const;
  const COLOR_OPTIONS = [
    { id: "white", key: "imgconv.white" },
    { id: "black", key: "imgconv.black" },
  ] as const;
  const POSITION_GRID = [
    { id: "top-left", key: "imgconv.posTL" },
    { id: "top-center", key: "imgconv.posTC" },
    { id: "top-right", key: "imgconv.posTR" },
    { id: "center-left", key: "imgconv.posML" },
    { id: "center", key: "imgconv.posC" },
    { id: "center-right", key: "imgconv.posMR" },
    { id: "bottom-left", key: "imgconv.posBL" },
    { id: "bottom-center", key: "imgconv.posBC" },
    { id: "bottom-right", key: "imgconv.posBR" },
  ] as const;
  const TILE_OPTION = { id: "tile", key: "imgconv.posTile" } as const;
  const BACKGROUND_OPTIONS = [
    { id: "none", key: "imgconv.bgNone" },
    { id: "opaque", key: "imgconv.bgOpaque" },
    { id: "semi", key: "imgconv.bgSemi" },
    { id: "light", key: "imgconv.bgLight" },
  ] as const;
  const SCALE_STEPS = ["0.1", "0.15", "0.25", "0.4", "0.6"];
  const FILE_ROW_HEIGHT = 64;
  const FILE_LIST_VIRTUALIZE_THRESHOLD = 200;
  const FILE_LIST_OVERSCAN = 8;
  const OUTPUT_MODES = [
    { id: "subfolder", key: "imgconv.outSubfolder" },
    { id: "alongside", key: "imgconv.outAlongside" },
    { id: "custom", key: "imgconv.outCustom" },
  ] as const;

  let dragOver = $state(false);
  let fileListEl: HTMLDivElement | null = $state(null);
  let focusedFileIndex = $state<number | null>(null);

  const fileListVirtualizer = createVirtualizer<HTMLDivElement, HTMLLIElement>({
    count: 0,
    getScrollElement: () => fileListEl,
    estimateSize: () => FILE_ROW_HEIGHT,
    overscan: FILE_LIST_OVERSCAN,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      if (focusedFileIndex !== null && !indexes.includes(focusedFileIndex)) {
        indexes.push(focusedFileIndex);
        indexes.sort((a, b) => a - b);
      }
      return indexes;
    },
  });

  const files = $derived(imageState.files);
  const running = $derived(imageState.running);
  const settings = $derived(imageState.settings);
  const wm = $derived(imageState.settings.watermark);
  const summary = $derived(imageState.summary);
  const totalSize = $derived(files.reduce((sum, item) => sum + (item.size ?? 0), 0));
  const firstOutput = $derived(
    imageState.results.find((result) => result.status === "ok")?.outputs[0] ?? null,
  );
  const totalSaved = $derived(
    summary && summary.totalInput > 0 && summary.totalOutput > 0
      ? Math.round((1 - summary.totalOutput / summary.totalInput) * 100)
      : 0,
  );

  function ratioLabel(item: ItemResult): string {
    if (item.status !== "ok" || item.originalBytes <= 0 || item.outputBytes <= 0) {
      return "—";
    }
    const saved = Math.round((1 - item.outputBytes / item.originalBytes) * 100);
    if (saved > 0) return `-${saved}%`;
    if (saved === 0) return "0%";
    return `+${-saved}%`;
  }

  function fileRemoveButton(index: number): HTMLButtonElement | null {
    return fileListEl?.querySelector<HTMLButtonElement>(
      `[data-image-remove-index="${index}"]`,
    ) ?? null;
  }

  async function handleFileRemoveKeydown(event: KeyboardEvent, index: number): Promise<void> {
    if (event.key !== "Tab" || files.length <= FILE_LIST_VIRTUALIZE_THRESHOLD) return;

    const targetIndex = index + (event.shiftKey ? -1 : 1);
    if (targetIndex < 0 || targetIndex >= files.length || fileRemoveButton(targetIndex)) return;

    event.preventDefault();
    $fileListVirtualizer.scrollToIndex(targetIndex, { align: event.shiftKey ? "end" : "auto" });
    await tick();
    fileRemoveButton(targetIndex)?.focus({ preventScroll: true });
  }

  async function handleFileToolbarKeydown(event: KeyboardEvent): Promise<void> {
    if (
      event.key !== "Tab" ||
      !event.shiftKey ||
      files.length <= FILE_LIST_VIRTUALIZE_THRESHOLD
    ) {
      return;
    }

    const lastIndex = files.length - 1;
    if (fileRemoveButton(lastIndex)) return;

    event.preventDefault();
    $fileListVirtualizer.scrollToIndex(lastIndex, { align: "end" });
    await tick();
    fileRemoveButton(lastIndex)?.focus({ preventScroll: true });
  }

  async function removeFileAt(index: number, path: string): Promise<void> {
    removeItem(path);
    const nextIndex = Math.min(index, imageState.files.length - 1);
    focusedFileIndex = nextIndex >= 0 ? nextIndex : null;
    await tick();

    if (nextIndex < 0) {
      fileListEl?.closest(".mynx-card")
        ?.querySelector<HTMLButtonElement>("[data-image-add-files]")
        ?.focus({ preventScroll: true });
      return;
    }

    if (files.length > FILE_LIST_VIRTUALIZE_THRESHOLD) {
      $fileListVirtualizer.scrollToIndex(nextIndex, { align: "auto" });
      await tick();
    }
    fileRemoveButton(nextIndex)?.focus({ preventScroll: true });
  }

  async function clearFilesAndFocus(): Promise<void> {
    clearAll();
    focusedFileIndex = null;
    await tick();
    fileListEl?.closest(".mynx-card")
      ?.querySelector<HTMLButtonElement>("[data-image-add-files]")
      ?.focus({ preventScroll: true });
  }

  /* Restore persisted options once. */
  $effect(() => {
    loadImageSettings();
  });

  /* Keep a bounded DOM for large folders while preserving the active row. */
  $effect(() => {
    const count = files.length;
    const scrollElement = fileListEl;
    const overscan = count <= FILE_LIST_VIRTUALIZE_THRESHOLD ? count : FILE_LIST_OVERSCAN;
    void focusedFileIndex;
    untrack(() => {
      $fileListVirtualizer.setOptions({
        count,
        getScrollElement: () => scrollElement,
        overscan,
      });
    });
  });

  /* Thumbnails: rescan whenever the file list changes; the pump is idempotent. */
  $effect(() => {
    void files.length;
    scheduleThumbnails();
  });

  /* Window-level drag-drop, scoped to this page ($effect cleanup). */
  $effect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          dragOver = true;
        } else if (payload.type === "drop") {
          dragOver = false;
          void addPaths(filterImageDropPaths(payload.paths));
        } else {
          dragOver = false;
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // Drag-drop events unavailable (e.g. outside the Tauri webview).
      });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  });

  async function pickFiles(): Promise<void> {
    const selected = await openDialog({
      multiple: true,
      filters: [{ name: "Images", extensions: [...IMAGE_EXTENSIONS] }],
    });
    if (Array.isArray(selected)) await addPaths(selected);
    else if (typeof selected === "string") await addPaths([selected]);
  }

  async function pickFolder(): Promise<void> {
    const selected = await openDialog({ directory: true });
    if (typeof selected === "string") await addPaths([selected]);
  }

  async function chooseLogo(): Promise<void> {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: "Images", extensions: [...IMAGE_EXTENSIONS] }],
    });
    if (typeof selected === "string") updateWatermark({ imagePath: selected });
  }

  async function chooseOutputDir(): Promise<void> {
    const selected = await openDialog({ directory: true });
    if (typeof selected === "string") updateSettings({ customDir: selected });
  }

  async function openOutputDir(): Promise<void> {
    if (!firstOutput) return;
    const dir = firstOutput.replace(/[\\/][^\\/]+$/, "");
    try {
      await openPath(dir);
    } catch {
      /* best-effort only */
    }
  }
</script>

{#snippet toggleSwitch(checked: boolean, set: (next: boolean) => void, label: string)}
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    class="relative h-5 w-9 shrink-0 rounded-full border transition-colors {checked
      ? 'border-accent bg-accent'
      : 'border-border bg-surface-2'}"
    onclick={() => set(!checked)}
  >
    <span
      class="absolute left-0.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white transition-transform {checked
        ? 'translate-x-4'
        : ''}"
    ></span>
  </button>
{/snippet}

<section
  class="flex h-full min-h-0 flex-col gap-3 p-4 {dragOver ? 'ring-2 ring-accent ring-inset' : ''}"
>
  <header class="flex items-baseline gap-3">
    <h1 class="mynx-page-title">{t("imgconv.title")}</h1>
  </header>

  <div class="mynx-resizable-two min-h-0 flex-1" style={`--mynx-first-column: ${panelWidths.imageFiles}px`}>
    <!-- ── Source files ─────────────────────────────────────────────────── -->
    <div class="mynx-card flex min-h-0 flex-col">
      <div class="flex items-center gap-2 border-b border-border px-3 py-2">
        <IconFolder size={15} stroke={1.75} aria-hidden="true" />
        <span class="text-[12px] font-semibold">{t("imgconv.files")}</span>
        {#if files.length > 0}
          <span class="mynx-chip">{files.length}</span>
        {/if}
      </div>

      <div bind:this={fileListEl} class="min-h-0 flex-1 overflow-y-auto p-3">
        {#if files.length === 0}
          <div
            class="flex h-full min-h-[120px] items-center justify-center rounded-md border border-dashed border-border p-4 text-center text-[12px] text-text-secondary"
          >
            {t("imgconv.dropHint")}
          </div>
        {:else}
          <ul
            class="relative w-full"
            aria-label={t("imgconv.files")}
            style:height={`${$fileListVirtualizer.getTotalSize()}px`}
          >
            {#each $fileListVirtualizer.getVirtualItems() as virtualRow (files[virtualRow.index]?.path)}
              {@const item = files[virtualRow.index]}
              {#if item}
                <li
                  class="absolute left-0 top-0 flex h-16 w-full items-center gap-2 rounded-md p-1.5 hover:bg-surface-2"
                  data-index={virtualRow.index}
                  aria-posinset={virtualRow.index + 1}
                  aria-setsize={files.length}
                  style:transform={`translateY(${virtualRow.start}px)`}
                >
                  <span
                    class="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-2"
                  >
                    {#if item.thumb}
                      <img src={item.thumb} alt="" aria-hidden="true" class="h-full w-full object-cover" />
                    {:else}
                      <IconPhoto size={18} stroke={1.6} class="text-text-secondary" aria-hidden="true" />
                    {/if}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="mynx-truncate block text-[12px] font-medium" title={item.path}>
                      {item.name}
                    </span>
                    <span class="mynx-truncate block text-[11px] text-text-secondary">
                      {[item.dims, item.size !== null ? formatBytes(item.size) : null]
                        .filter(Boolean)
                        .join(" · ") || item.path}
                    </span>
                  </span>
                  <button
                    type="button"
                    class="mynx-btn shrink-0 px-2"
                    data-image-remove-index={virtualRow.index}
                    disabled={running}
                    onfocus={() => (focusedFileIndex = virtualRow.index)}
                    onblur={(event) => {
                      if (
                        !(event.relatedTarget instanceof Node) ||
                        !fileListEl?.contains(event.relatedTarget)
                      ) {
                        focusedFileIndex = null;
                      }
                    }}
                    onkeydown={(event) => void handleFileRemoveKeydown(event, virtualRow.index)}
                    onclick={() => void removeFileAt(virtualRow.index, item.path)}
                    aria-label={`${t("imgconv.removeFile")}: ${item.name}`}
                    title={t("imgconv.removeFile")}
                  >
                    <IconX size={12} stroke={1.75} aria-hidden="true" />
                  </button>
                </li>
              {/if}
            {/each}
          </ul>
        {/if}
      </div>

      <div class="flex items-center gap-2 border-t border-border px-3 py-2">
        <button
          type="button"
          class="mynx-btn"
          data-image-add-files
          onkeydown={(event) => void handleFileToolbarKeydown(event)}
          onclick={() => void pickFiles()}
          disabled={running}
        >
          <IconPhotoPlus size={14} stroke={1.75} aria-hidden="true" />
          {t("imgconv.addFiles")}
        </button>
        <button type="button" class="mynx-btn" onclick={() => void pickFolder()} disabled={running}>
          <IconFolderPlus size={14} stroke={1.75} aria-hidden="true" />
          {t("imgconv.addFolder")}
        </button>
        {#if files.length > 0}
          <button
            type="button"
            class="mynx-btn mynx-btn-danger"
            onclick={() => void clearFilesAndFocus()}
            disabled={running}
          >
            <IconTrash size={14} stroke={1.75} aria-hidden="true" />
            {t("imgconv.clear")}
          </button>
        {/if}
        {#if files.length > 0}
          <span class="mynx-truncate ml-auto text-[11px] text-text-secondary">
            {t("imgconv.fileCount", { count: files.length })}{totalSize > 0
              ? ` · ${formatBytes(totalSize)}`
              : ""}
          </span>
        {/if}
      </div>
    </div>

    <ColumnResizeHandle
      label={t("layout.resizeColumn")}
      value={panelWidths.imageFiles}
      min={220}
      max={620}
      onresize={(width) => setPanelWidth("imageFiles", width)}
      oncommit={savePanelWidths}
    />

    <!-- ── Options ──────────────────────────────────────────────────────── -->
    <div class="mynx-card flex min-h-0 flex-col">
      <div class="flex items-center gap-2 border-b border-border px-3 py-2">
        <IconAdjustments size={15} stroke={1.75} aria-hidden="true" />
        <span class="text-[12px] font-semibold">{t("imgconv.options")}</span>
      </div>

      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <p
          class="flex items-start gap-1.5 rounded-md border border-border bg-surface-2 p-2 text-[11px] text-text-secondary"
        >
          <IconInfoCircle size={14} stroke={1.75} class="mt-0.5 shrink-0" aria-hidden="true" />
          {t("imgconv.compressionHint")}
        </p>

        <div class="flex flex-col gap-1.5">
          <span class="text-[12px] font-medium">{t("imgconv.compression")}</span>
          <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("imgconv.compression")}>
            {#each MODE_OPTIONS as option (option.id)}
              <label
                class="mynx-card flex cursor-pointer items-center justify-between gap-2 p-2 {settings.mode ===
                option.id
                  ? 'border-accent bg-accent/10'
                  : 'border-border bg-surface hover:border-text-secondary'}"
              >
                <span class="mynx-truncate text-[12px] font-medium">{t(option.key)}</span>
                <input
                  type="radio"
                  name="imgconv-mode"
                  class="sr-only"
                  checked={settings.mode === option.id}
                  onchange={() => updateSettings({ mode: option.id })}
                />
              </label>
            {/each}
          </div>
        </div>

        {#if settings.mode === "lossless"}
          <div class="flex flex-col gap-1.5">
            <span class="text-[12px] font-medium">{t("imgconv.optimizeLevel")}</span>
            <div
              class="grid grid-cols-3 gap-2"
              role="radiogroup"
              aria-label={t("imgconv.optimizeLevel")}
            >
              {#each LEVEL_OPTIONS as option (option.id)}
                <label
                  class="mynx-card flex cursor-pointer items-center justify-center p-2 {settings.optimizeLevel ===
                  option.id
                    ? 'border-accent bg-accent/10'
                    : 'border-border bg-surface hover:border-text-secondary'}"
                >
                  <span class="text-[12px] font-medium">{t(option.key)}</span>
                  <input
                    type="radio"
                    name="imgconv-level"
                    class="sr-only"
                    checked={settings.optimizeLevel === option.id}
                    onchange={() => updateSettings({ optimizeLevel: option.id })}
                  />
                </label>
              {/each}
            </div>
          </div>
        {:else}
          <div class="grid grid-cols-2 gap-3">
            <label class="flex flex-col gap-1">
              <span class="text-[12px] font-medium">{t("imgconv.colors")}</span>
              <select
                class="mynx-input"
                value={String(settings.colors)}
                onchange={(event) => updateSettings({ colors: Number(event.currentTarget.value) })}
              >
                {#each COLOR_COUNTS as count (count)}
                  <option value={String(count)}>{count}</option>
                {/each}
              </select>
            </label>
            <div class="flex items-end justify-between gap-2 pb-1">
              <span class="text-[12px] font-medium">{t("imgconv.dither")}</span>
              {@render toggleSwitch(
                settings.dither,
                (next) => updateSettings({ dither: next }),
                t("imgconv.dither"),
              )}
            </div>
          </div>
        {/if}

        <fieldset class="flex flex-col gap-3 rounded-md border border-border p-3">
          <legend class="px-1 text-[12px] font-medium">{t("imgconv.watermark")}</legend>
          <div class="flex items-center justify-between gap-2">
            <span class="text-[12px]">{t("imgconv.watermark")}</span>
            {@render toggleSwitch(
              settings.watermarkOn,
              (next) => updateSettings({ watermarkOn: next }),
              t("imgconv.watermark"),
            )}
          </div>

          {#if settings.watermarkOn}
            <div class="flex flex-col gap-1.5">
              <span class="text-[12px] font-medium">{t("imgconv.wmKind")}</span>
              <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("imgconv.wmKind")}>
                {#each WM_KIND_OPTIONS as option (option.id)}
                  <label
                    class="mynx-card flex cursor-pointer items-center justify-center p-2 {wm.kind ===
                    option.id
                      ? 'border-accent bg-accent/10'
                      : 'border-border bg-surface hover:border-text-secondary'}"
                  >
                    <span class="text-[12px] font-medium">{t(option.key)}</span>
                    <input
                      type="radio"
                      name="imgconv-wm-kind"
                      class="sr-only"
                      checked={wm.kind === option.id}
                      onchange={() => updateWatermark({ kind: option.id })}
                    />
                  </label>
                {/each}
              </div>
            </div>

            {#if wm.kind === "text"}
              <label class="flex flex-col gap-1">
                <span class="text-[12px] font-medium">{t("imgconv.wmContent")}</span>
                <input
                  type="text"
                  class="mynx-input"
                  value={wm.content}
                  placeholder={t("imgconv.wmContentHint")}
                  oninput={(event) => updateWatermark({ content: event.currentTarget.value })}
                />
              </label>
              <div class="grid grid-cols-2 gap-3">
                <label class="flex flex-col gap-1">
                  <span class="text-[12px] font-medium">{t("imgconv.font")}</span>
                  <select
                    class="mynx-input"
                    value={wm.font}
                    onchange={(event) => updateWatermark({ font: event.currentTarget.value })}
                  >
                    {#each FONTS as font (font)}
                      <option value={font}>{font}</option>
                    {/each}
                  </select>
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-[12px] font-medium">{t("imgconv.fontSize")}</span>
                  <select
                    class="mynx-input"
                    value={String(wm.fontSize)}
                    onchange={(event) =>
                      updateWatermark({ fontSize: Number(event.currentTarget.value) })}
                  >
                    {#each FONT_SIZES as size (size)}
                      <option value={String(size)}>{size}</option>
                    {/each}
                  </select>
                </label>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[12px] font-medium">{t("imgconv.bold")}</span>
                  {@render toggleSwitch(wm.bold, (next) => updateWatermark({ bold: next }), t("imgconv.bold"))}
                </div>
                <div class="flex flex-col gap-1" role="radiogroup" aria-label={t("imgconv.color")}>
                  <span class="text-[12px] font-medium">{t("imgconv.color")}</span>
                  <div class="flex items-center gap-2">
                    {#each COLOR_OPTIONS as option (option.id)}
                      <label
                        class="flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border p-1.5 {wm.color ===
                        option.id
                          ? 'border-accent bg-accent/10'
                          : 'border-border bg-surface hover:border-text-secondary'}"
                      >
                        <input
                          type="radio"
                          name="imgconv-wm-color"
                          class="sr-only"
                          checked={wm.color === option.id}
                          onchange={() => updateWatermark({ color: option.id })}
                        />
                        <span
                          class="h-3 w-3 shrink-0 rounded-full border border-border {option.id === 'white'
                            ? 'bg-white'
                            : 'bg-black'}"
                          aria-hidden="true"
                        ></span>
                        <span class="text-[11px]">{t(option.key)}</span>
                      </label>
                    {/each}
                  </div>
                </div>
              </div>
            {:else}
              <button type="button" class="mynx-btn w-full" onclick={() => void chooseLogo()}>
                <IconPhoto size={14} stroke={1.75} aria-hidden="true" />
                <span class="mynx-truncate">
                  {wm.imagePath ? baseName(wm.imagePath) : t("imgconv.chooseLogo")}
                </span>
              </button>
            {/if}

            <label class="flex flex-col gap-1">
              <span class="flex items-center justify-between text-[12px] font-medium">
                {t("imgconv.opacity")}
                <span class="text-[11px] font-normal text-text-secondary">
                  {Math.round(wm.opacity * 100)}%
                </span>
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={wm.opacity}
                oninput={(event) => updateWatermark({ opacity: Number(event.currentTarget.value) })}
                aria-label={t("imgconv.opacity")}
                class="accent-accent"
              />
            </label>

            <div class="flex items-start justify-between gap-3">
              <div class="flex flex-col gap-1.5">
                <span class="text-[12px] font-medium">{t("imgconv.position")}</span>
                <div class="grid grid-cols-3 gap-1">
                  {#each POSITION_GRID as option (option.id)}
                    <button
                      type="button"
                      class="flex h-8 w-8 items-center justify-center rounded-md border {wm.position ===
                      option.id
                        ? 'border-accent bg-accent/10'
                        : 'border-border bg-surface hover:border-accent/50'}"
                      aria-label={t(option.key)}
                      aria-pressed={wm.position === option.id}
                      title={t(option.key)}
                      onclick={() => updateWatermark({ position: option.id })}
                    >
                      <span
                        class="h-1.5 w-1.5 rounded-full {wm.position === option.id
                          ? 'bg-accent'
                          : 'bg-border'}"
                        aria-hidden="true"
                      ></span>
                    </button>
                  {/each}
                </div>
              </div>
              <button
                type="button"
                class="mynx-btn shrink-0 {wm.position === TILE_OPTION.id
                  ? 'border-accent bg-accent/10 text-accent'
                  : ''}"
                aria-pressed={wm.position === TILE_OPTION.id}
                title={t(TILE_OPTION.key)}
                onclick={() => updateWatermark({ position: TILE_OPTION.id })}
              >
                {t(TILE_OPTION.key)}
              </button>
            </div>

            {#if wm.kind === "image"}
              <label class="flex flex-col gap-1">
                <span class="text-[12px] font-medium">{t("imgconv.logoScale")}</span>
                <select
                  class="mynx-input"
                  value={String(wm.scale)}
                  onchange={(event) => updateWatermark({ scale: Number(event.currentTarget.value) })}
                >
                  {#each SCALE_STEPS as step (step)}
                    <option value={step}>{step}</option>
                  {/each}
                </select>
              </label>
            {:else}
              <label class="flex flex-col gap-1">
                <span class="text-[12px] font-medium">{t("imgconv.background")}</span>
                <select
                  class="mynx-input"
                  value={wm.background}
                  onchange={(event) => {
                    const found = BACKGROUND_OPTIONS.find(
                      (option) => option.id === event.currentTarget.value,
                    );
                    if (found) updateWatermark({ background: found.id });
                  }}
                >
                  {#each BACKGROUND_OPTIONS as option (option.id)}
                    <option value={option.id}>{t(option.key)}</option>
                  {/each}
                </select>
              </label>
            {/if}
          {/if}
        </fieldset>

        <div class="flex flex-col gap-1.5">
          <span class="text-[12px] font-medium">{t("imgconv.output")}</span>
          <div class="flex flex-col gap-1.5" role="radiogroup" aria-label={t("imgconv.output")}>
            {#each OUTPUT_MODES as option (option.id)}
              <label
                class="mynx-card flex cursor-pointer items-center justify-between gap-2 p-2 {settings.outputMode ===
                option.id
                  ? 'border-accent bg-accent/10'
                  : 'border-border bg-surface hover:border-text-secondary'}"
              >
                <span class="mynx-truncate text-[12px]">{t(option.key)}</span>
                <input
                  type="radio"
                  name="imgconv-output"
                  class="sr-only"
                  checked={settings.outputMode === option.id}
                  onchange={() => updateSettings({ outputMode: option.id })}
                />
              </label>
            {/each}
          </div>
          {#if settings.outputMode === "custom"}
            <button type="button" class="mynx-btn w-full" onclick={() => void chooseOutputDir()}>
              <IconFolderOpen size={14} stroke={1.75} aria-hidden="true" />
              <span class="mynx-truncate">
                {settings.customDir ? baseName(settings.customDir) : t("imgconv.chooseDir")}
              </span>
            </button>
          {/if}
          <p class="text-[11px] text-text-secondary">{t("imgconv.outputHint")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-2 border-t border-border px-3 py-2">
        {#if imageState.collectingFiles}
          <p class="text-[11px] text-text-secondary" role="status">
            {t("imgconv.collectingFiles")}
          </p>
        {/if}
        {#if running}
          <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between gap-2 text-[11px] text-text-secondary">
              <span class="mynx-truncate">{imageState.progressText}</span>
              {#if imageState.progress !== null}
                <span class="shrink-0">{imageState.progress}%</span>
              {/if}
            </div>
            {#if imageState.progress !== null}
              <progress
                class="mynx-progress"
                value={imageState.progress}
                max={100}
                aria-label={t("imgconv.progress")}
              ></progress>
            {/if}
          </div>
        {/if}
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="mynx-btn mynx-btn-primary min-w-0 flex-1"
            onclick={() => void runConversion()}
            disabled={running || imageState.collectingFiles || files.length === 0}
          >
            <span class="mynx-truncate">
              {#if running}
                {t("imgconv.converting")}
              {:else if imageState.collectingFiles}
                {t("imgconv.collectingFiles")}
              {:else if files.length > 0}
                {t("imgconv.convert")}
              {:else}
                {t("imgconv.chooseFirst")}
              {/if}
            </span>
          </button>
          {#if running}
            <button
              type="button"
              class="mynx-btn mynx-btn-danger shrink-0"
              onclick={cancelConversion}
              disabled={imageState.cancelling}
            >
              <IconPlayerStop size={14} stroke={1.75} aria-hidden="true" />
              {imageState.cancelling ? t("imgconv.cancelling") : t("common.cancel")}
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <!-- ── Results ────────────────────────────────────────────────────────── -->
  {#if summary}
    <div class="mynx-card flex max-h-[42%] min-h-[140px] shrink-0 flex-col">
      <div class="flex items-center gap-2 border-b border-border px-3 py-2">
        <span class="text-[12px] font-semibold">{t("imgconv.result")}</span>
        {#if firstOutput}
          <button type="button" class="mynx-link ml-auto" onclick={() => void openOutputDir()}>
            <IconFolderOpen size={14} stroke={1.75} aria-hidden="true" />
            {t("imgconv.openFolder")}
          </button>
        {/if}
      </div>

      <div class="min-h-0 flex-1 overflow-auto">
        <table class="w-full border-collapse text-[12px]">
          <thead>
            <tr class="sticky top-0 bg-surface text-left text-[11px] text-text-secondary">
              <th class="px-2 py-1.5 font-medium">#</th>
              <th class="px-2 py-1.5 font-medium">{t("imgconv.colFile")}</th>
              <th class="px-2 py-1.5 font-medium">{t("imgconv.colOriginal")}</th>
              <th class="px-2 py-1.5 font-medium">{t("imgconv.colOutput")}</th>
              <th class="px-2 py-1.5 font-medium">{t("imgconv.colRatio")}</th>
              <th class="px-2 py-1.5 font-medium">{t("imgconv.colStatus")}</th>
              <th class="px-2 py-1.5 font-medium">{t("imgconv.colError")}</th>
              <th class="px-2 py-1.5 font-medium">{t("imgconv.colOutputs")}</th>
            </tr>
          </thead>
          <tbody>
            {#each imageState.results as item (item.index)}
              <tr class="border-t border-border {item.status === 'failed' ? 'bg-danger/5' : ''}">
                <td class="px-2 py-1.5 text-text-secondary">{item.index + 1}</td>
                <td class="max-w-[220px] px-2 py-1.5">
                  <CopyableText text={item.source} label={baseName(item.source)} />
                  {#if item.outputs.length > 1}
                    <span class="mynx-chip ml-1">
                      {t("imgconv.pages", { count: item.outputs.length })}
                    </span>
                  {/if}
                </td>
                <td class="whitespace-nowrap px-2 py-1.5">{formatBytes(item.originalBytes)}</td>
                <td class="whitespace-nowrap px-2 py-1.5">
                  {item.status === "ok" ? formatBytes(item.outputBytes) : "—"}
                </td>
                <td class="whitespace-nowrap px-2 py-1.5">{ratioLabel(item)}</td>
                <td class="px-2 py-1.5">
                  {#if item.status === "ok"}
                    <span class="mynx-badge mynx-badge-success">{t("imgconv.ok")}</span>
                  {:else}
                    <span class="mynx-badge mynx-badge-error">{t("imgconv.failed")}</span>
                  {/if}
                </td>
                <td class="max-w-[200px] px-2 py-1.5">
                  {#if item.error}
                    <span class="mynx-truncate block text-[11px] text-danger" title={item.error}>
                      {item.error}
                    </span>
                  {:else}
                    <span class="text-text-secondary">—</span>
                  {/if}
                </td>
                <td class="max-w-[220px] px-2 py-1.5">
                  {#if item.outputs.length > 0}
                    <CopyableText text={item.outputs[0]} label={baseName(item.outputs[0])} />
                    {#if item.outputs.length > 1}
                      <span class="text-[11px] text-text-secondary">+{item.outputs.length - 1}</span>
                    {/if}
                  {:else}
                    <span class="text-text-secondary">—</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <div class="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-[12px]">
        <span class="mynx-truncate text-text-secondary">
          {t("imgconv.summary", { ok: summary.ok, failed: summary.failed })}
          {#if summary.status === "cancelled"}
            &nbsp;· {t("imgconv.cancelled")}
          {/if}
        </span>
        {#if totalSaved > 0}
          <strong class="shrink-0 text-success">{t("imgconv.saved", { percent: totalSaved })}</strong>
        {/if}
      </div>
    </div>
  {/if}
</section>
