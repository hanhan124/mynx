<script lang="ts">
  import IconX from "@tabler/icons-svelte/icons/x";
  import IconCopy from "@tabler/icons-svelte/icons/copy";
  import IconCheck from "@tabler/icons-svelte/icons/check";
  import IconDownload from "@tabler/icons-svelte/icons/download";
  import IconChevronLeft from "@tabler/icons-svelte/icons/chevron-left";
  import IconChevronRight from "@tabler/icons-svelte/icons/chevron-right";
  import { t } from "../../../app/i18n.svelte";
  import { artifactFileName, previewDocument, type Artifact } from "../core/artifacts.js";
  import { saveFile } from "../state/files.svelte.js";
  import Markdown from "./Markdown.svelte";

  let { artifacts, selected, onselect, onclose }: {
    artifacts: Artifact[];
    selected: string | null;
    onselect: (key: string) => void;
    onclose: () => void;
  } = $props();

  let view = $state<"preview" | "code">("preview");
  let versionIndex = $state<number | null>(null);
  let copied = $state(false);

  const artifact = $derived(artifacts.find((a) => a.key === selected) ?? artifacts[artifacts.length - 1]);
  const index = $derived(
    artifact ? Math.min(versionIndex ?? artifact.versions.length - 1, artifact.versions.length - 1) : 0,
  );
  const version = $derived(artifact?.versions[index]);

  // A newly selected artifact (or a new version) shows its latest version.
  $effect(() => {
    void artifact?.key;
    void artifact?.versions.length;
    versionIndex = null;
  });

  async function copy(): Promise<void> {
    if (!version) return;
    try {
      await navigator.clipboard.writeText(version.code);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  function download(): void {
    if (!artifact || !version) return;
    const type = artifact.kind === "svg" ? "image/svg+xml" : artifact.kind === "html" ? "text/html" : "text/plain";
    void saveFile(artifactFileName(artifact), version.code, artifactFileName(artifact).split(".").pop() ?? "txt", type).catch(() => {});
  }
</script>

<aside class="mynx-cn-artifacts" aria-label={t("chatNext.artifacts")}>
  <header class="mynx-cn-artifacts-head">
    {#if artifacts.length > 1}
      <select class="mynx-input mynx-cn-select" value={artifact?.key ?? ""} aria-label={t("chatNext.artifacts")} onchange={(event) => onselect(event.currentTarget.value)}>
        {#each artifacts as item (item.key)}
          <option value={item.key}>{item.title}</option>
        {/each}
      </select>
    {:else}
      <span class="mynx-truncate text-headline">{artifact?.title ?? t("chatNext.artifacts")}</span>
    {/if}
    <span class="flex-1"></span>
    <button type="button" class="mynx-btn mynx-btn-ghost mynx-btn-compact" aria-label={t("common.close")} title={t("common.close")} onclick={onclose}>
      <IconX size={15} />
    </button>
  </header>

  {#if artifact && version}
    <div class="mynx-cn-artifacts-bar">
      <div class="mynx-cn-segmented" role="group" aria-label={t("chatNext.artifactView")}>
        {#if artifact.kind !== "mermaid"}
          <button type="button" aria-pressed={view === "preview"} onclick={() => (view = "preview")}>{t("chatNext.preview")}</button>
        {:else}
          <button type="button" aria-pressed={view === "preview"} onclick={() => (view = "preview")}>{t("chatNext.diagram")}</button>
        {/if}
        <button type="button" aria-pressed={view === "code"} onclick={() => (view = "code")}>{t("chatNext.code")}</button>
      </div>
      <span class="flex-1"></span>
      {#if artifact.versions.length > 1}
        <button type="button" class="mynx-btn mynx-btn-ghost mynx-btn-compact mynx-btn-compact-sm" disabled={index <= 0} aria-label={t("chatNext.prevVersion")} title={t("chatNext.prevVersion")} onclick={() => (versionIndex = index - 1)}>
          <IconChevronLeft size={14} />
        </button>
        <span class="mynx-num text-footnote">{t("chatNext.version", { index: index + 1, total: artifact.versions.length })}</span>
        <button type="button" class="mynx-btn mynx-btn-ghost mynx-btn-compact mynx-btn-compact-sm" disabled={index >= artifact.versions.length - 1} aria-label={t("chatNext.nextVersion")} title={t("chatNext.nextVersion")} onclick={() => (versionIndex = index + 1)}>
          <IconChevronRight size={14} />
        </button>
      {/if}
      <button type="button" class="mynx-btn mynx-btn-ghost mynx-btn-compact" aria-label={t("chatNext.copy")} title={t("chatNext.copy")} onclick={() => void copy()}>
        {#if copied}<IconCheck size={15} />{:else}<IconCopy size={15} />{/if}
      </button>
      <button type="button" class="mynx-btn mynx-btn-ghost mynx-btn-compact" aria-label={t("chatNext.download")} title={t("chatNext.download")} onclick={download}>
        <IconDownload size={15} />
      </button>
    </div>

    <div class="mynx-cn-artifacts-body">
      {#if view === "code"}
        <pre class="mynx-cn-artifact-code">{version.code}</pre>
      {:else if artifact.kind === "mermaid"}
        <Markdown content={"```mermaid\n" + version.code + "\n```"} />
      {:else}
        <!-- Sandboxed: no same-origin (no app/IPC access), no network (CSP), scripts blocked. -->
        <iframe
          class="mynx-cn-artifact-frame"
          title={artifact.title}
          sandbox=""
          referrerpolicy="no-referrer"
          srcdoc={previewDocument(artifact.kind, version.code)}
        ></iframe>
      {/if}
    </div>
    <p class="mynx-note px-3 pb-2">{t("chatNext.artifactSandbox")}</p>
  {:else}
    <p class="mynx-note p-4">{t("chatNext.noArtifacts")}</p>
  {/if}
</aside>
