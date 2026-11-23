<script module lang="ts">
  import type { Component } from "svelte";

  // svelte-streamdown (marked + highlighting + math + mermaid) loads on the
  // first rendered answer, not with the page.
  let cached: Component<any> | null = null;
  let cachedMath: Component<any> | null = null;
  let loading: Promise<{ renderer: Component<any>; math: Component<any> }> | null = null;

  function loadRenderer(): Promise<{ renderer: Component<any>; math: Component<any> }> {
    // The Math component brings KaTeX styles (~25 KB + fonts) only when an
    // answer is rendered.
    loading ??= Promise.all([
      import("svelte-streamdown"),
      import("svelte-streamdown/math"),
    ])
      .then(([mod, math]) => {
        cached = mod.Streamdown as Component<any>;
        cachedMath = math.default as Component<any>;
        return { renderer: cached, math: cachedMath };
      })
      .catch((error: unknown) => {
        // Let the next answer try again instead of staying plain text forever.
        loading = null;
        throw error;
      });
    return loading;
  }

  /** Formulas with an unknown command still render (in red) instead of vanishing. */
  const KATEX_CONFIG = { throwOnError: false, strict: "ignore", trust: false } as const;
</script>

<script lang="ts">
  import { openExternal } from "../../../app/tauri.js";
  import { t } from "../../../app/i18n.svelte";
  import { normalizeMath } from "../core/markdown.js";

  let { content, streaming = false }: { content: string; streaming?: boolean } = $props();
  let Renderer = $state<Component<any> | null>(cached);
  let MathRenderer = $state<Component<any> | null>(cachedMath);
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
  let loadFailed = $state(false);
  const source = $derived(normalizeMath(content));

  $effect(() => {
    if (Renderer && MathRenderer) return;
    void loadRenderer().then(
      ({ renderer, math }) => {
        Renderer = renderer;
        MathRenderer = math;
        loadFailed = false;
      },
      (error: unknown) => {
        loadFailed = true;
        console.error("Markdown renderer failed to load", error);
      },
    );
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
  {#if Renderer && MathRenderer}
    <Renderer
      content={source}
      {translations}
      components={{ math: MathRenderer }}
      katexConfig={KATEX_CONFIG}
      static={!streaming}
      parseIncompleteMarkdown={streaming}
      renderHtml={false}
    />
  {:else}
    <div class="mynx-cn-plain" title={loadFailed ? t("chatNext.md.loadFailed") : undefined}>{content}</div>
  {/if}
</div>
