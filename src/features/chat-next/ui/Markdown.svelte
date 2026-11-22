<script module lang="ts">
  import type { Component } from "svelte";

  // svelte-streamdown (marked + highlighting + math + mermaid) loads on the
  // first rendered answer, not with the page.
  let cached: Component<any> | null = null;
  let loading: Promise<Component<any>> | null = null;

  function loadRenderer(): Promise<Component<any>> {
    loading ??= import("svelte-streamdown").then((mod) => (cached = mod.Streamdown as Component<any>));
    return loading;
  }
</script>

<script lang="ts">
  import { openExternal } from "../../../app/tauri.js";
  import { t } from "../../../app/i18n.svelte";

  let { content, streaming = false }: { content: string; streaming?: boolean } = $props();
  let Renderer = $state<Component<any> | null>(cached);
  const translations = $derived({
    controls: {
      copyCode: t("chatNext.md.copyCode"),
      copiedCode: t("chatNext.copied"),
      downloadCode: t("chatNext.md.downloadCode"),
      copyTable: t("chatNext.md.copyTable"),
      copiedTable: t("chatNext.copied"),
      downloadTable: t("chatNext.md.downloadTable"),
      tableFullscreen: t("chatNext.md.expand"),
      exitTableFullscreen: t("chatNext.md.collapse"),
      downloadDiagram: t("chatNext.md.downloadDiagram"),
      zoomIn: t("chatNext.md.zoomIn"),
      zoomOut: t("chatNext.md.zoomOut"),
      resetView: t("chatNext.md.fit"),
      fullscreen: t("chatNext.md.expand"),
      exitFullscreen: t("chatNext.md.collapse"),
    },
  });
  let root = $state<HTMLElement | null>(null);

  $effect(() => {
    if (!Renderer) void loadRenderer().then((component) => (Renderer = component));
  });

  // External links open in the system browser, never inside the app window.
  $effect(() => {
    const element = root;
    if (!element) return;
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest("a[href]");
      const href = anchor?.getAttribute("href") ?? "";
      if (!anchor || !/^https?:\/\//i.test(href)) return;
      event.preventDefault();
      void openExternal(href).catch(() => {});
    };
    element.addEventListener("click", onClick);
    return () => element.removeEventListener("click", onClick);
  });
</script>

<div class="mynx-cn-markdown text-body" bind:this={root}>
  {#if Renderer}
    <Renderer {content} {translations} parseIncompleteMarkdown={streaming} renderHtml={false} />
  {:else}
    <div class="mynx-cn-plain">{content}</div>
  {/if}
</div>
