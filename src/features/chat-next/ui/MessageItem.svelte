<script lang="ts">
  import { untrack } from "svelte";
  import { DropdownMenu } from "bits-ui";
  import IconChevronDown from "@tabler/icons-svelte/icons/chevron-down";
  import IconPlayerPlay from "@tabler/icons-svelte/icons/player-play";
  import IconRotateClockwise from "@tabler/icons-svelte/icons/rotate-clockwise";
  import IconX from "@tabler/icons-svelte/icons/x";
  import IconCopy from "@tabler/icons-svelte/icons/copy";
  import IconCheck from "@tabler/icons-svelte/icons/check";
  import IconRefresh from "@tabler/icons-svelte/icons/refresh";
  import IconPencil from "@tabler/icons-svelte/icons/pencil";
  import IconTrash from "@tabler/icons-svelte/icons/trash";
  import IconChevronLeft from "@tabler/icons-svelte/icons/chevron-left";
  import IconChevronRight from "@tabler/icons-svelte/icons/chevron-right";
  import IconVolume from "@tabler/icons-svelte/icons/volume";
  import IconPlayerStop from "@tabler/icons-svelte/icons/player-stop";
  import IconGitFork from "@tabler/icons-svelte/icons/git-fork";
  import IconBookmark from "@tabler/icons-svelte/icons/bookmark";
  import IconPaperclip from "@tabler/icons-svelte/icons/paperclip";
  import IconTool from "@tabler/icons-svelte/icons/tool";
  import IconCode from "@tabler/icons-svelte/icons/code";
  import { app } from "../../../app/state.svelte";
  import { openExternal } from "../../../app/tauri.js";
  import { t } from "../../../app/i18n.svelte";
  import type { Artifact } from "../core/artifacts.js";
  import { estimateCost, formatCost } from "../core/helpers.js";
  import { classifyFetchError } from "../core/remote.js";
  import { siblingsOf } from "../core/tree.js";
  import type { MessageNode } from "../core/types.js";
  import {
    chatNext,
    choiceKey,
    continueAnswer,
    deleteMessage,
    editAndResend,
    forkConversation,
    isStreaming,
    modelInfo,
    nodesOf,
    openSettings,
    providerName,
    regenerate,
    resolveApproval,
    retry,
    switchBranch,
    usableProviders,
  } from "../state/chat-next.svelte.js";
  import Markdown from "./Markdown.svelte";

  let {
    node,
    artifacts = [],
    onartifact,
    compact = false,
  }: {
    node: MessageNode;
    artifacts?: Artifact[];
    onartifact?: (key: string) => void;
    /** Side-by-side column: no branch switcher, no edit/fork. */
    compact?: boolean;
  } = $props();

  let editing = $state(false);
  let editText = $state("");
  let copied = $state(false);
  let speaking = $state(false);
  let lightbox = $state<{ src: string; name: string } | null>(null);

  const busy = $derived(isStreaming());
  const branch = $derived(siblingsOf(nodesOf(node.conversationId), node.id));
  const streaming = $derived(node.status === "streaming");
  const searching = $derived(chatNext.searching.includes(node.id));
  const approvals = $derived(chatNext.approvals.filter((a) => a.nodeId === node.id));
  const cost = $derived(estimateCost(node.usage, modelInfo(node)?.caps));
  const canContinue = $derived(
    node.role === "assistant" && Boolean(node.content) && (node.status === "stopped" || node.finishReason === "length"),
  );

  // ↑ in an empty composer asks the last user message to open its editor.
  $effect(() => {
    if (chatNext.editRequest !== node.id) return;
    untrack(() => {
      chatNext.editRequest = null;
      if (node.role !== "user" || isStreaming()) return;
      editing = true;
      editText = node.content;
    });
  });

  // Esc closes the image viewer (capture phase, so it never stops a stream).
  $effect(() => {
    if (!lightbox) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      lightbox = null;
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(node.content);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  function speak(): void {
    if (typeof speechSynthesis === "undefined") return;
    if (speaking) {
      speechSynthesis.cancel();
      speaking = false;
      return;
    }
    const utterance = new SpeechSynthesisUtterance(node.content.replace(/```[\s\S]*?```/g, " ").replace(/[#*_`>]/g, ""));
    utterance.lang = app.language === "en" ? "en-US" : "zh-CN";
    utterance.onend = () => (speaking = false);
    utterance.onerror = () => (speaking = false);
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
    speaking = true;
  }

  function errorText(): string {
    if (node.error === "no-key") return t("chatNext.noKey");
    if (node.error === "no-provider") return t("chatNext.noProvider");
    const kind = classifyFetchError(node.error ?? "");
    const hint = kind === "unknown" ? "" : `${t(`chatNext.err.${kind}`)}\n`;
    return `${hint}${t("chatNext.error", { detail: node.error ?? "" })}`;
  }

  function formatJson(value: unknown): string {
    try {
      const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
      return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
    } catch {
      return String(value);
    }
  }

  function host(url: string): string {
    return /^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url;
  }

  function openSource(event: MouseEvent, url: string): void {
    event.preventDefault();
    void openExternal(url).catch(() => {});
  }

  function commitEdit(): void {
    editAndResend(node.id, editText);
    editing = false;
  }
</script>

{#snippet branchSwitcher()}
  {#if !compact && branch.total > 1}
    <span class="mynx-cn-branch">
      <button type="button" class="mynx-btn mynx-btn-ghost mynx-btn-compact mynx-btn-compact-sm" disabled={branch.index <= 0 || busy} aria-label={t("chatNext.prevBranch")} title={t("chatNext.prevBranch")} onclick={() => switchBranch(node.id, -1)}>
        <IconChevronLeft size={14} />
      </button>
      <span class="mynx-num text-footnote">{t("chatNext.branch", { index: branch.index + 1, total: branch.total })}</span>
      <button type="button" class="mynx-btn mynx-btn-ghost mynx-btn-compact mynx-btn-compact-sm" disabled={branch.index >= branch.total - 1 || busy} aria-label={t("chatNext.nextBranch")} title={t("chatNext.nextBranch")} onclick={() => switchBranch(node.id, 1)}>
        <IconChevronRight size={14} />
      </button>
    </span>
  {/if}
{/snippet}

{#snippet action(label: string, onclick: () => void, icon: typeof IconCopy, disabled = false)}
  {@const Icon = icon}
  <button type="button" class="mynx-btn mynx-btn-ghost mynx-btn-compact mynx-btn-compact-sm" aria-label={label} title={label} {disabled} {onclick}>
    <Icon size={14} />
  </button>
{/snippet}

{#if node.role === "user"}
  <article class="mynx-cn-user group">
    {#if node.attachments?.length}
      <div class="mynx-cn-attachments">
        {#each node.attachments as attachment (attachment.id)}
          {#if attachment.dataUrl}
            <button
              type="button"
              class="mynx-cn-thumb-btn"
              aria-label={t("chatNext.viewImage", { name: attachment.name })}
              title={attachment.name}
              onclick={() => (lightbox = { src: attachment.dataUrl ?? "", name: attachment.name })}
            >
              <img class="mynx-cn-thumb" src={attachment.dataUrl} alt={attachment.name} />
            </button>
          {:else}
            <span class="mynx-chip"><IconPaperclip size={12} aria-hidden="true" />{attachment.name}</span>
          {/if}
        {/each}
      </div>
    {/if}
    {#if editing}
      <div class="mynx-cn-edit">
        <textarea class="mynx-input" rows="4" bind:value={editText} aria-label={t("chatNext.edit")}></textarea>
        <div class="flex justify-end gap-2">
          <button type="button" class="mynx-btn" onclick={() => (editing = false)}>{t("chatNext.cancel")}</button>
          <button type="button" class="mynx-btn mynx-btn-primary" disabled={!editText.trim() || busy} onclick={commitEdit}>{t("chatNext.save")}</button>
        </div>
      </div>
    {:else}
      {#if node.content}<div class="mynx-cn-bubble text-body">{node.content}</div>{/if}
      <div class="mynx-cn-actions">
        {@render branchSwitcher()}
        {@render action(t("chatNext.edit"), () => { editing = true; editText = node.content; }, IconPencil, busy)}
        {@render action(copied ? t("chatNext.copied") : t("chatNext.copy"), () => void copy(), copied ? IconCheck : IconCopy)}
        {@render action(t("chatNext.remember"), () => openSettings("memory", node.content.slice(0, 300)), IconBookmark)}
      </div>
    {/if}
  </article>
{:else if node.role === "assistant"}
  <article class="mynx-cn-assistant group" aria-busy={streaming}>
    {#if compact}
      <p class="mynx-cn-model-label text-footnote">{providerName(node.providerId)} · {node.modelId}</p>
    {/if}
    {#if searching}
      <p class="mynx-note mynx-cn-pulse">{t("chatNext.searching")}</p>
    {/if}
    {#if node.reasoning}
      <details class="mynx-cn-reasoning" open={streaming && !node.content}>
        <summary class="text-callout">
          {node.reasoningMs ? t("chatNext.reasoningFor", { seconds: Math.max(1, Math.round(node.reasoningMs / 1000)) }) : t("chatNext.reasoning")}
        </summary>
        <div class="mynx-cn-reasoning-body text-callout">{node.reasoning}</div>
      </details>
    {/if}
    {#each node.tools ?? [] as call (call.id)}
      <details class="mynx-cn-tool">
        <summary class="text-callout">
          <IconTool size={13} aria-hidden="true" />
          <span class="mynx-truncate">{t(`chatNext.tool.${call.status}`, { name: call.name })}</span>
        </summary>
        <pre class="mynx-cn-tool-body">{formatJson(call.input)}</pre>
        {#if call.output !== undefined}<pre class="mynx-cn-tool-body">{formatJson(call.output)}</pre>{/if}
        {#if call.error}<p class="text-footnote text-danger">{call.error}</p>{/if}
      </details>
    {/each}
    {#each approvals as approval (approval.id)}
      <div class="mynx-cn-approval" role="group" aria-label={t("chatNext.approveTitle")}>
        <p class="text-callout font-semibold">{t("chatNext.approveTitle")}</p>
        <p class="text-callout">{t("chatNext.approveBody", { tool: approval.toolName, server: approval.serverName })}</p>
        <pre class="mynx-cn-tool-body">{formatJson(approval.input)}</pre>
        <div class="flex justify-end gap-2">
          <button type="button" class="mynx-btn" onclick={() => resolveApproval(approval.id, false)}>{t("chatNext.deny")}</button>
          <button type="button" class="mynx-btn mynx-btn-primary" onclick={() => resolveApproval(approval.id, true)}>{t("chatNext.allow")}</button>
        </div>
      </div>
    {/each}

    {#if node.content}
      <Markdown content={node.content} {streaming} />
    {:else if streaming && !searching && approvals.length === 0}
      <span class="mynx-chat-thinking" aria-label={t("chatNext.thinking")}><i></i><i></i><i></i></span>
    {/if}

    {#if artifacts.length > 0}
      <div class="mynx-cn-artifact-chips">
        {#each artifacts as artifact (artifact.key)}
          <button type="button" class="mynx-cn-artifact-chip" onclick={() => onartifact?.(artifact.key)}>
            <IconCode size={14} aria-hidden="true" />
            <span class="mynx-truncate">{artifact.title}</span>
            <span class="text-footnote text-text-tertiary">{t("chatNext.openArtifact")}</span>
          </button>
        {/each}
      </div>
    {/if}

    {#if node.sources?.length}
      <ol class="mynx-cn-sources" aria-label={t("chatNext.sources")}>
        {#each node.sources as source, index (source.url)}
          <li>
            <a class="mynx-cn-source" href={source.url} title={source.snippet || source.title} target="_blank" rel="noreferrer" onclick={(event) => openSource(event, source.url)}>
              <span class="mynx-cn-source-n mynx-num">{index + 1}</span>
              <span class="mynx-truncate text-callout">{source.title}</span>
              <span class="mynx-truncate text-footnote text-text-tertiary">{host(source.url)}</span>
            </a>
          </li>
        {/each}
      </ol>
    {/if}

    {#if node.status === "error"}
      <div class="mynx-cn-error text-callout" role="alert">
        <span>{errorText()}</span>
        <button type="button" class="mynx-btn mynx-cn-inline-btn" disabled={busy} onclick={() => retry(node.id)}>
          <IconRotateClockwise size={14} />{t("chatNext.retry")}
        </button>
      </div>
    {:else if canContinue}
      <div class="mynx-cn-continue">
        <span class="mynx-note">{node.finishReason === "length" ? t("chatNext.truncatedAnswer") : t("chatNext.stopped")}</span>
        <button type="button" class="mynx-btn mynx-cn-inline-btn" disabled={busy} onclick={() => continueAnswer(node.id)}>
          <IconPlayerPlay size={14} />{t("chatNext.continue")}
        </button>
      </div>
    {:else if node.status === "stopped"}
      <p class="mynx-note">{t("chatNext.stopped")}</p>
    {/if}

    {#if !streaming}
      <div class="mynx-cn-actions">
        {@render branchSwitcher()}
        {@render action(copied ? t("chatNext.copied") : t("chatNext.copy"), () => void copy(), copied ? IconCheck : IconCopy, !node.content)}
        {#if !compact}
          <span class="mynx-cn-split-btn">
            {@render action(t("chatNext.regenerate"), () => regenerate(node.id), IconRefresh, busy)}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger class="mynx-cn-split-caret" disabled={busy} aria-label={t("chatNext.regenerateWith")} title={t("chatNext.regenerateWith")}>
                <IconChevronDown size={12} />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content class="mynx-popover mynx-cn-menu" sideOffset={4} align="start">
                  <div class="mynx-cn-menu-label">{t("chatNext.regenerateWith")}</div>
                  {#each usableProviders() as provider (provider.id)}
                    {#each provider.models as model (model.id)}
                      {@const choice = { providerId: provider.id, modelId: model.id }}
                      <DropdownMenu.Item class="mynx-cn-menu-item" onSelect={() => regenerate(node.id, choice)}>
                        <span class="mynx-truncate">{model.label ?? model.id}</span>
                        <span class="mynx-cn-menu-hint">{provider.name}{choiceKey(choice) === choiceKey(chatNext.choice) ? ` · ${t("chatNext.current")}` : ""}</span>
                      </DropdownMenu.Item>
                    {/each}
                  {/each}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </span>
        {/if}
        {@render action(speaking ? t("chatNext.stopReading") : t("chatNext.readAloud"), speak, speaking ? IconPlayerStop : IconVolume, !node.content)}
        {#if !compact}
          {@render action(t("chatNext.fork"), () => forkConversation(node.id, t("chatNext.forkSuffix")), IconGitFork, busy)}
          {@render action(t("chatNext.remember"), () => openSettings("memory", node.content.slice(0, 300)), IconBookmark, !node.content)}
        {/if}
        {@render action(t("chatNext.delete"), () => deleteMessage(node.id), IconTrash, busy)}
        <span class="mynx-cn-meta text-footnote">
          {#if node.usage?.inputTokens !== undefined || node.usage?.outputTokens !== undefined}
            <span class="mynx-num">{t("chatNext.tokens", { input: node.usage?.inputTokens ?? 0, output: node.usage?.outputTokens ?? 0 })}</span>
          {/if}
          {#if cost !== undefined}<span class="mynx-num">≈ {formatCost(cost)}</span>{/if}
          {#if node.modelId && !compact}<span class="mynx-truncate">{node.modelId}</span>{/if}
        </span>
      </div>
    {/if}
  </article>
{/if}

{#if lightbox}
  <div class="mynx-cn-lightbox" role="dialog" aria-modal="true" aria-label={lightbox.name}>
    <button type="button" class="mynx-cn-lightbox-scrim" aria-label={t("common.close")} onclick={() => (lightbox = null)}></button>
    <img src={lightbox.src} alt={lightbox.name} />
    <button type="button" class="mynx-btn mynx-cn-lightbox-close" aria-label={t("common.close")} title={t("common.close")} onclick={() => (lightbox = null)}>
      <IconX size={16} />
    </button>
  </div>
{/if}
