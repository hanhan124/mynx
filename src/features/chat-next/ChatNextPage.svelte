<script lang="ts">
  /**
   * Chat-next: ChatGPT / Claude-class chat. Sidebar (projects, time groups,
   * search, archive), centred thread with branches, side-by-side compare,
   * artifacts panel, glass composer, settings sheet.
   */
  import { onMount, tick, untrack } from "svelte";
  import { DropdownMenu } from "bits-ui";
  import IconDots from "@tabler/icons-svelte/icons/dots";
  import IconFlask from "@tabler/icons-svelte/icons/flask";
  import IconDna from "@tabler/icons-svelte/icons/dna";
  import IconChartDots from "@tabler/icons-svelte/icons/chart-dots";
  import IconWriting from "@tabler/icons-svelte/icons/writing";
  import { confirmDialog } from "../rnaseq/client.js";
  import { consumePendingPrompt, consumeSettingsRequest } from "./handoff.js";
  import { exportConversation } from "./state/files.svelte.js";
  import ConversationSettings from "./ui/ConversationSettings.svelte";
  import IconLayoutSidebar from "@tabler/icons-svelte/icons/layout-sidebar";
  import IconPlus from "@tabler/icons-svelte/icons/plus";
  import IconArrowDown from "@tabler/icons-svelte/icons/arrow-down";
  import IconCode from "@tabler/icons-svelte/icons/code";
  import IconGhost from "@tabler/icons-svelte/icons/ghost";
  import IconAlertCircle from "@tabler/icons-svelte/icons/alert-circle";
  import IconCheck from "@tabler/icons-svelte/icons/check";
  import { pushToast } from "../../app/state.svelte";
  import { t } from "../../app/i18n.svelte";
  import { artifactsOfNode, collectArtifacts } from "./core/artifacts.js";
  import { childrenOf } from "./core/tree.js";
  import type { MessageNode } from "./core/types.js";
  import {
    activeConversation,
    chatNext,
    chooseAnswer,
    compactConversation,
    deleteConversation,
    initChatNext,
    isStreaming,
    newConversation,
    nodesOf,
    openSettings,
    providerName,
    renameConversation,
    sendMessage,
    setSidebarOpen,
    stopConversation,
    usableProviders,
    visiblePath,
  } from "./state/chat-next.svelte.js";
  import Sidebar from "./ui/Sidebar.svelte";
  import MessageItem from "./ui/MessageItem.svelte";
  import Composer from "./ui/Composer.svelte";
  import ArtifactPanel from "./ui/ArtifactPanel.svelte";
  import ChatSettings from "./ui/ChatSettings.svelte";
  import "./chat-next.css";

  let scroller = $state<HTMLElement | null>(null);
  let composer = $state<ReturnType<typeof Composer> | null>(null);
  let stickToBottom = $state(true);
  let width = $state(1200);
  const narrow = $derived(width < 960);

  let renaming = $state(false);
  let renameText = $state("");
  let liveMessage = $state("");
  let reducedMotion = false;

  const STARTERS = [
    { key: "qpcr", icon: IconFlask },
    { key: "rnaseq", icon: IconDna },
    { key: "chart", icon: IconChartDots },
    { key: "methods", icon: IconWriting },
  ] as const;

  onMount(() => {
    reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void (async () => {
      await initChatNext();
      await tick();
      const pending = consumePendingPrompt();
      await playGhostHandoff();
      if (pending && usableProviders().length > 0) {
        newConversation();
        sendMessage(pending);
      }
      if (consumeSettingsRequest()) openSettings("providers");
      composer?.focus();
    })();
    return () => document.getElementById("mynx-chat-ghost")?.remove();
  });

  /** Home search box handoff: its ghost glides onto the composer, then goes. */
  async function playGhostHandoff(): Promise<void> {
    const ghost = document.getElementById("mynx-chat-ghost");
    if (!ghost) return;
    const target = document.getElementById("mynx-chat-composer")?.getBoundingClientRect();
    if (target && !reducedMotion) {
      const animation = ghost.animate(
        [{}, { left: `${target.left}px`, top: `${target.top}px`, width: `${target.width}px`, height: `${target.height}px`, borderRadius: "22px", opacity: 0.6 }],
        { duration: 320, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "forwards" },
      );
      await animation.finished.catch(() => {});
    }
    ghost.remove();
  }

  // Announce finished answers to screen readers.
  let lastStreaming = 0;
  $effect(() => {
    const count = chatNext.streaming.length;
    untrack(() => {
      if (count < lastStreaming) {
        liveMessage = t("chatNext.answerDone");
        setTimeout(() => (liveMessage = ""), 2500);
      }
      lastStreaming = count;
    });
  });

  function startRename(): void {
    if (!conversation) return;
    renameText = conversation.title;
    renaming = true;
    void tick().then(() => document.getElementById("mynx-cn-title-input")?.focus());
  }

  function commitRename(): void {
    if (conversation && renaming) renameConversation(conversation.id, renameText);
    renaming = false;
  }

  async function removeConversation(): Promise<void> {
    if (!conversation) return;
    const id = conversation.id;
    let ok: boolean;
    try {
      ok = await confirmDialog({ title: t("chatNext.delete"), message: t("chatNext.confirmDeleteChat", { title: conversation.title || t("chatNext.untitled") }), kind: "warning" });
    } catch {
      ok = window.confirm(t("chatNext.confirmDeleteChat", { title: conversation.title || t("chatNext.untitled") }));
    }
    if (ok) deleteConversation(id);
  }

  const conversation = $derived(activeConversation());
  const path = $derived(visiblePath());
  const providers = $derived(usableProviders());
  const artifacts = $derived(collectArtifacts(path));
  const sidebarVisible = $derived(chatNext.sidebarOpen);

  /** Rows of the thread: compare groups render as one row of columns. */
  type Row = { key: string; nodes: MessageNode[]; compare: boolean };
  const rows = $derived.by<Row[]>(() => {
    const out: Row[] = [];
    for (const node of path) {
      if (node.role === "assistant" && node.compareGroup) {
        const group = childrenOf(nodesOf(node.conversationId), node.parentId).filter((n) => n.compareGroup === node.compareGroup);
        if (group.length > 1) {
          out.push({ key: `cmp-${node.compareGroup}`, nodes: group, compare: true });
          continue;
        }
      }
      out.push({ key: node.id, nodes: [node], compare: false });
    }
    return out;
  });

  // Follow the stream only while the reader is at the bottom.
  $effect(() => {
    void path.length;
    void path[path.length - 1]?.content;
    void path[path.length - 1]?.reasoning;
    if (!stickToBottom || !scroller) return;
    const el = scroller;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  });

  $effect(() => {
    void chatNext.activeId;
    stickToBottom = true;
  });

  function onScroll(): void {
    if (!scroller) return;
    stickToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  }

  function jumpToBottom(): void {
    stickToBottom = true;
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }

  function openArtifact(key: string): void {
    chatNext.artifactKey = key;
    chatNext.artifactsOpen = true;
  }

  async function copyLast(): Promise<void> {
    const last = [...path].reverse().find((n) => n.role === "assistant" && n.content);
    if (!last) return;
    try {
      await navigator.clipboard.writeText(last.content);
      pushToast("success", t("chatNext.copied"));
    } catch {
      /* clipboard unavailable */
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.shiftKey && event.code === "KeyO") {
      event.preventDefault();
      newConversation();
      void tick().then(() => composer?.focus());
    } else if (mod && event.shiftKey && event.code === "KeyS") {
      event.preventDefault();
      setSidebarOpen(!chatNext.sidebarOpen);
    } else if (mod && event.shiftKey && event.code === "Semicolon") {
      event.preventDefault();
      void copyLast();
    } else if (event.key === "Escape" && event.shiftKey) {
      event.preventDefault();
      composer?.focus();
    } else if (event.key === "Escape" && !event.defaultPrevented && isStreaming() && !chatNext.settingsOpen) {
      stopConversation();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} bind:innerWidth={width} />

<section class="mynx-cn {narrow ? 'is-narrow' : ''} {sidebarVisible ? 'has-sidebar' : ''}">
  {#if sidebarVisible}
    {#if narrow}
      <button type="button" class="mynx-cn-scrim" aria-label={t("chatNext.toggleSidebar")} onclick={() => setSidebarOpen(false)}></button>
    {/if}
    <Sidebar onpick={() => { if (narrow) setSidebarOpen(false); void tick().then(() => composer?.focus()); }} />
  {/if}

  <div class="mynx-cn-main">
    <header class="mynx-cn-header">
      <button
        type="button"
        class="mynx-btn mynx-btn-ghost mynx-btn-compact"
        aria-label={t("chatNext.toggleSidebar")}
        aria-pressed={sidebarVisible}
        title={t("chatNext.toggleSidebarHint")}
        onclick={() => setSidebarOpen(!chatNext.sidebarOpen)}
      >
        <IconLayoutSidebar size={16} />
      </button>
      {#if !sidebarVisible}
        <button type="button" class="mynx-btn mynx-btn-ghost mynx-btn-compact" aria-label={t("chatNext.newChat")} title={t("chatNext.newChatHint")} onclick={() => newConversation()}>
          <IconPlus size={16} />
        </button>
      {/if}
      {#if renaming}
        <input
          id="mynx-cn-title-input"
          class="mynx-input mynx-cn-title-input"
          bind:value={renameText}
          aria-label={t("chatNext.rename")}
          onkeydown={(event) => {
            if (event.key === "Enter" && !event.isComposing) commitRename();
            else if (event.key === "Escape") { event.preventDefault(); renaming = false; }
          }}
          onblur={commitRename}
        />
      {:else if conversation && !conversation.temporary && path.length > 0}
        <button type="button" class="mynx-cn-title" title={t("chatNext.renameHint")} onclick={startRename}>
          <span class="mynx-truncate text-headline">{conversation.title || t("chatNext.untitled")}</span>
        </button>
      {:else}
        <span class="mynx-truncate text-headline">{conversation?.title || t("chatNext.title")}</span>
      {/if}
      {#if conversation?.temporary}
        <span class="mynx-chip"><IconGhost size={12} aria-hidden="true" />{t("chatNext.temporaryBadge")}</span>
      {/if}
      <span class="flex-1"></span>
      {#if artifacts.length > 0}
        <button
          type="button"
          class="mynx-btn mynx-btn-ghost mynx-btn-compact {chatNext.artifactsOpen ? 'mynx-cn-on' : ''}"
          aria-pressed={chatNext.artifactsOpen}
          aria-label={t("chatNext.artifacts")}
          title={t("chatNext.artifacts")}
          onclick={() => (chatNext.artifactsOpen = !chatNext.artifactsOpen)}
        >
          <IconCode size={16} />
        </button>
      {/if}
      {#if conversation && path.length > 0}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger class="mynx-btn mynx-btn-ghost mynx-btn-compact" aria-label={t("chatNext.more")} title={t("chatNext.more")}>
            <IconDots size={16} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="mynx-popover mynx-cn-menu" sideOffset={6} align="end">
              <DropdownMenu.Item class="mynx-cn-menu-item" onSelect={() => (chatNext.conversationSettingsId = conversation.id)}>{t("chatNext.chatSettings")}</DropdownMenu.Item>
              {#if !conversation.temporary}
                <DropdownMenu.Item class="mynx-cn-menu-item" onSelect={startRename}>{t("chatNext.rename")}</DropdownMenu.Item>
              {/if}
              <DropdownMenu.Item class="mynx-cn-menu-item" disabled={isStreaming() || chatNext.compacting !== null} onSelect={() => void compactConversation(conversation.id)}>{t("chatNext.compact")}</DropdownMenu.Item>
              <DropdownMenu.Separator class="mynx-cn-menu-sep" />
              <DropdownMenu.Item class="mynx-cn-menu-item" onSelect={() => void exportConversation(conversation.id, "md")}>{t("chatNext.exportMd")}</DropdownMenu.Item>
              <DropdownMenu.Item class="mynx-cn-menu-item" onSelect={() => void exportConversation(conversation.id, "json")}>{t("chatNext.exportJson")}</DropdownMenu.Item>
              <DropdownMenu.Separator class="mynx-cn-menu-sep" />
              <DropdownMenu.Item class="mynx-cn-menu-item is-danger" onSelect={() => void removeConversation()}>{t("chatNext.delete")}</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      {/if}
    </header>

    <div class="mynx-cn-body">
      <div class="mynx-cn-scroll" bind:this={scroller} onscroll={onScroll}>
        <div class="mynx-cn-column">
          {#if !chatNext.ready}
            <p class="mynx-note text-center">{t("common.loading")}</p>
          {:else if providers.length === 0}
            <div class="mynx-cn-empty">
              <IconAlertCircle size={32} />
              <p class="text-body">{t("chatNext.noProvider")}</p>
              <button type="button" class="mynx-btn mynx-btn-primary" onclick={() => openSettings("providers")}>{t("chatNext.setupProvider")}</button>
            </div>
          {:else if path.length === 0}
            <div class="mynx-cn-empty">
              <h2 class="mynx-cn-hello">{conversation?.temporary ? t("chatNext.temporaryEmpty") : t("chatNext.empty")}</h2>
              {#if chatNext.imported}<p class="mynx-note">{t("chatNext.migrated", { count: chatNext.imported })}</p>{/if}
              <div class="mynx-cn-starters">
                {#each STARTERS as starter (starter.key)}
                  {@const StarterIcon = starter.icon}
                  <button type="button" class="mynx-cn-starter" onclick={() => composer?.fill(t(`chatNext.starter.${starter.key}.prompt`))}>
                    <StarterIcon size={18} aria-hidden="true" />
                    <span class="text-body font-semibold">{t(`chatNext.starter.${starter.key}.title`)}</span>
                    <span class="text-footnote text-text-secondary">{t(`chatNext.starter.${starter.key}.hint`)}</span>
                  </button>
                {/each}
              </div>
            </div>
          {/if}

          {#each rows as row (row.key)}
            {#if row.compare}
              <div class="mynx-cn-compare-grid" style={`--cols: ${row.nodes.length}`}>
                {#each row.nodes as node (node.id)}
                  {@const chosen = conversation ? path.some((p) => p.id === node.id) : false}
                  <div class="mynx-cn-compare-col {chosen ? 'is-chosen' : ''}">
                    <MessageItem {node} compact artifacts={artifactsOfNode(artifacts, node.id)} onartifact={openArtifact} />
                    {#if node.status !== "streaming"}
                      <button type="button" class="mynx-btn {chosen ? 'mynx-btn-primary' : ''} mynx-cn-choose" disabled={chosen || isStreaming()} onclick={() => chooseAnswer(node.id)}>
                        {#if chosen}<IconCheck size={14} />{t("chatNext.chosen")}{:else}{t("chatNext.useAnswer", { model: node.modelId ?? providerName(node.providerId) })}{/if}
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else}
              {@const node = row.nodes[0]}
              {#if node}
                <MessageItem {node} artifacts={artifactsOfNode(artifacts, node.id)} onartifact={openArtifact} />
              {/if}
            {/if}
          {/each}
        </div>
      </div>

      {#if !stickToBottom && path.length > 0}
        <button type="button" class="mynx-btn mynx-cn-jump" aria-label={t("chatNext.jumpToBottom")} title={t("chatNext.jumpToBottom")} onclick={jumpToBottom}>
          <IconArrowDown size={16} />
        </button>
      {/if}

      {#if chatNext.artifactsOpen && artifacts.length > 0}
        <ArtifactPanel {artifacts} selected={chatNext.artifactKey} onselect={(key) => (chatNext.artifactKey = key)} onclose={() => (chatNext.artifactsOpen = false)} />
      {/if}
    </div>

    <Composer bind:this={composer} onsent={() => (stickToBottom = true)} />
  </div>
</section>

<ChatSettings />
<ConversationSettings />
<div class="sr-only" role="status" aria-live="polite">{liveMessage}</div>
