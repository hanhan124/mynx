<script lang="ts">
  import { Popover } from "bits-ui";
  import { tick, untrack } from "svelte";
  import IconArrowUp from "@tabler/icons-svelte/icons/arrow-up";
  import IconPlayerStopFilled from "@tabler/icons-svelte/icons/player-stop-filled";
  import IconPaperclip from "@tabler/icons-svelte/icons/paperclip";
  import IconWorld from "@tabler/icons-svelte/icons/world";
  import IconLayoutColumns from "@tabler/icons-svelte/icons/layout-columns";
  import IconX from "@tabler/icons-svelte/icons/x";
  import IconPhoto from "@tabler/icons-svelte/icons/photo";
  import IconFileText from "@tabler/icons-svelte/icons/file-text";
  import IconArrowsMinimize from "@tabler/icons-svelte/icons/arrows-minimize";
  import { pushToast } from "../../../app/state.svelte";
  import { t } from "../../../app/i18n.svelte";
  import { AttachmentError, readAttachment } from "../core/attachments.js";
  import { estimateTokens, filterPrompts } from "../core/helpers.js";
  import type { AttachmentRef, PromptTemplate } from "../core/types.js";
  import {
    activeConversation,
    chatNext,
    chooseModel,
    choiceKey,
    compactConversation,
    isStreaming,
    modelInfo,
    openSettings,
    parseChoiceKey,
    requestEdit,
    sendMessage,
    setConversationAssistant,
    stopConversation,
    toggleCompare,
    updateSettings,
    usableProviders,
    visiblePath,
    webSearchReady,
  } from "../state/chat-next.svelte.js";
  import { loadDrafts, saveDrafts } from "../state/repository.js";

  let { onsent }: { onsent?: () => void } = $props();

  let textarea = $state<HTMLTextAreaElement | null>(null);
  let root = $state<HTMLElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let draft = $state("");
  let attachments = $state<AttachmentRef[]>([]);
  let reading = $state(0);
  let dragging = $state(false);
  let promptIndex = $state(0);
  let promptDismissed = $state(false);
  const drafts = loadDrafts();
  // Plain holder (not reactive): which conversation the draft belongs to.
  const draftSlot = { key: "" };
  let draftTimer: ReturnType<typeof setTimeout> | null = null;

  const providers = $derived(usableProviders());
  const busy = $derived(isStreaming());
  const conversation = $derived(activeConversation());
  const caps = $derived(modelInfo(chatNext.choice)?.caps);
  const ws = $derived(chatNext.snapshot.settings.webSearch);
  const searchOn = $derived(Boolean(ws?.enabled && webSearchReady()));
  const slash = $derived(/^\/(\S*)$/.exec(draft));
  const promptMatches = $derived(slash && !promptDismissed ? filterPrompts(chatNext.snapshot.prompts, slash[1] ?? "") : []);
  const contextTokens = $derived(estimateTokens(draft) + attachments.reduce((sum, a) => sum + estimateTokens(a.text ?? ""), 0));
  const overContext = $derived(Boolean(caps?.contextWindow && contextTokens > caps.contextWindow * 0.8));
  const canSend = $derived(providers.length > 0 && reading === 0 && (draft.trim().length > 0 || attachments.length > 0));

  // Per-conversation drafts survive switching chats and restarts.
  $effect(() => {
    const key = chatNext.activeId ?? "new";
    untrack(() => {
      if (key === draftSlot.key) return;
      if (draftSlot.key) drafts[draftSlot.key] = draft;
      draftSlot.key = key;
      draft = drafts[key] ?? "";
      attachments = [];
      void tick().then(autosize);
    });
  });

  function persistDraft(): void {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      drafts[draftSlot.key] = draft;
      saveDrafts(drafts);
    }, 500);
  }

  function autosize(): void {
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
  }

  function onInput(): void {
    promptDismissed = false;
    promptIndex = 0;
    autosize();
    persistDraft();
  }

  export function focus(): void {
    textarea?.focus();
  }

  /** Put text in the composer (starter suggestions) and focus it. */
  export function fill(text: string): void {
    draft = text;
    persistDraft();
    void tick().then(() => {
      autosize();
      textarea?.focus();
      textarea?.setSelectionRange(draft.length, draft.length);
    });
  }

  async function addFiles(files: Iterable<File>): Promise<void> {
    for (const file of files) {
      reading += 1;
      try {
        const attachment = await readAttachment(file);
        if (attachment.kind === "image" && !caps?.vision) pushToast("info", t("chatNext.noVision"));
        if (attachment.truncated) pushToast("warning", t("chatNext.truncated", { name: attachment.name }));
        attachments = [...attachments, attachment];
      } catch (error) {
        const reason = error instanceof AttachmentError ? error.reason : "unreadable";
        pushToast("error", t(`chatNext.attach.${reason}`, { name: file.name }));
      } finally {
        reading -= 1;
      }
    }
  }

  $effect(() => {
    const element = root;
    if (!element) return;
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragging = true;
    };
    const leave = (event: DragEvent) => {
      if (!element.contains(event.relatedTarget as Node | null)) dragging = false;
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragging = false;
      void addFiles(Array.from(event.dataTransfer?.files ?? []));
    };
    element.addEventListener("dragover", over);
    element.addEventListener("dragleave", leave);
    element.addEventListener("drop", drop);
    return () => {
      element.removeEventListener("dragover", over);
      element.removeEventListener("dragleave", leave);
      element.removeEventListener("drop", drop);
    };
  });

  function onPaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    void addFiles(files);
  }

  function applyPrompt(prompt: PromptTemplate): void {
    draft = prompt.body;
    promptDismissed = true;
    void tick().then(() => {
      autosize();
      textarea?.focus();
      textarea?.setSelectionRange(draft.length, draft.length);
    });
  }

  function submit(): void {
    if (busy || !canSend) return;
    sendMessage(draft, attachments);
    draft = "";
    attachments = [];
    drafts[draftSlot.key] = "";
    saveDrafts(drafts);
    void tick().then(autosize);
    onsent?.();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (promptMatches.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        promptIndex = (promptIndex + step + promptMatches.length) % promptMatches.length;
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const chosen = promptMatches[promptIndex];
        if (chosen) applyPrompt(chosen);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        promptDismissed = true;
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
      return;
    }
    // ↑ in an empty composer edits the last message you sent.
    if (event.key === "ArrowUp" && !draft && attachments.length === 0 && !busy) {
      const last = [...visiblePath()].reverse().find((node) => node.role === "user");
      if (last) {
        event.preventDefault();
        requestEdit(last.id);
      }
    }
  }

  function pickModel(value: string): void {
    const choice = parseChoiceKey(value);
    if (choice) chooseModel(choice);
  }

  function toggleSearch(): void {
    if (!webSearchReady()) {
      openSettings("search");
      return;
    }
    if (ws) updateSettings({ webSearch: { ...ws, enabled: !ws.enabled } });
  }

  function sizeLabel(bytes: number): string {
    return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
</script>

<div class="mynx-cn-composer-wrap">
  <div id="mynx-chat-composer" class="mynx-cn-composer {dragging ? 'is-dragging' : ''}" bind:this={root}>
    {#if promptMatches.length > 0}
      <ul class="mynx-cn-prompts mynx-popover" role="listbox" aria-label={t("chatNext.promptLibrary")}>
        {#each promptMatches as prompt, index (prompt.id)}
          <li role="option" aria-selected={index === promptIndex}>
            <button type="button" class="mynx-cn-prompt {index === promptIndex ? 'is-active' : ''}" onmouseenter={() => (promptIndex = index)} onclick={() => applyPrompt(prompt)}>
              <span class="text-body font-semibold">/{prompt.title}</span>
              <span class="mynx-truncate text-footnote text-text-secondary">{prompt.body}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if attachments.length > 0 || reading > 0}
      <div class="mynx-cn-attachments">
        {#each attachments as attachment (attachment.id)}
          <span class="mynx-cn-attachment">
            {#if attachment.dataUrl}
              <img src={attachment.dataUrl} alt="" />
            {:else if attachment.kind === "image"}
              <IconPhoto size={14} aria-hidden="true" />
            {:else}
              <IconFileText size={14} aria-hidden="true" />
            {/if}
            <span class="mynx-truncate text-callout">{attachment.name}</span>
            <span class="text-footnote text-text-tertiary">{sizeLabel(attachment.size)}</span>
            <button type="button" class="mynx-cn-attachment-x" aria-label={t("chatNext.removeAttachment")} title={t("chatNext.removeAttachment")} onclick={() => (attachments = attachments.filter((a) => a.id !== attachment.id))}>
              <IconX size={12} />
            </button>
          </span>
        {/each}
        {#if reading > 0}<span class="mynx-note">{t("chatNext.reading")}</span>{/if}
      </div>
    {/if}

    <textarea
      bind:this={textarea}
      bind:value={draft}
      rows="1"
      class="mynx-cn-input text-body"
      placeholder={providers.length === 0 ? t("chatNext.noProvider") : t("chatNext.placeholder")}
      aria-label={t("chatNext.placeholder")}
      disabled={providers.length === 0}
      oninput={onInput}
      onkeydown={onKeydown}
      onpaste={onPaste}
    ></textarea>

    <div class="mynx-cn-composer-bar">
      <input bind:this={fileInput} type="file" multiple class="sr-only" tabindex="-1" aria-hidden="true" onchange={(event) => { void addFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }} />
      <button type="button" class="mynx-btn mynx-btn-ghost mynx-btn-compact" aria-label={t("chatNext.attach")} title={t("chatNext.attach")} disabled={providers.length === 0} onclick={() => fileInput?.click()}>
        <IconPaperclip size={16} />
      </button>
      <button
        type="button"
        class="mynx-btn mynx-btn-ghost mynx-btn-compact {searchOn ? 'mynx-cn-on' : ''}"
        aria-pressed={searchOn}
        aria-label={t("chatNext.webSearch")}
        title={webSearchReady() ? t("chatNext.webSearch") : t("chatNext.webSearchSetup")}
        onclick={toggleSearch}
      >
        <IconWorld size={16} />
      </button>
      <Popover.Root>
        <Popover.Trigger class="mynx-btn mynx-btn-ghost mynx-btn-compact {chatNext.compare.length > 0 ? 'mynx-cn-on' : ''}" aria-label={t("chatNext.compare")} title={t("chatNext.compare")} disabled={providers.length === 0}>
          <IconLayoutColumns size={16} />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content class="mynx-popover mynx-cn-compare" sideOffset={8} align="start">
            <p class="text-callout font-semibold">{t("chatNext.compareTitle")}</p>
            <p class="mynx-note">{t("chatNext.compareHint")}</p>
            <div class="mynx-cn-compare-list">
              {#each providers as provider (provider.id)}
                {#each provider.models as model (model.id)}
                  {@const choice = { providerId: provider.id, modelId: model.id }}
                  {@const key = choiceKey(choice)}
                  {@const checked = chatNext.compare.some((c) => choiceKey(c) === key)}
                  <label class="mynx-cn-compare-row">
                    <input
                      type="checkbox"
                      {checked}
                      disabled={key === choiceKey(chatNext.choice) || (!checked && chatNext.compare.length >= 2)}
                      onchange={() => toggleCompare(choice)}
                    />
                    <span class="mynx-truncate text-callout">{model.label ?? model.id}</span>
                    <span class="mynx-truncate text-footnote text-text-tertiary">{provider.name}</span>
                  </label>
                {/each}
              {/each}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {#if chatNext.snapshot.assistants.length > 0 && conversation}
        <select
          class="mynx-input mynx-cn-select"
          value={conversation.assistantId ?? ""}
          aria-label={t("chatNext.assistantPicker")}
          onchange={(event) => setConversationAssistant(conversation.id, event.currentTarget.value || undefined)}
        >
          <option value="">{t("chatNext.noAssistant")}</option>
          {#each chatNext.snapshot.assistants as assistant (assistant.id)}
            <option value={assistant.id}>{assistant.icon} {assistant.name}</option>
          {/each}
        </select>
      {/if}

      <span class="flex-1"></span>
      {#if overContext}<span class="text-footnote text-warning" title={t("chatNext.contextWarning")}>{t("chatNext.contextShort")}</span>{/if}
      {#if conversation && visiblePath().length >= 8}
        <button
          type="button"
          class="mynx-btn mynx-btn-ghost mynx-btn-compact"
          aria-label={t("chatNext.compact")}
          title={conversation.summaryUntil ? t("chatNext.compactAgain") : t("chatNext.compactHint")}
          disabled={busy || chatNext.compacting !== null}
          onclick={() => void compactConversation(conversation.id)}
        >
          <IconArrowsMinimize size={16} class={chatNext.compacting === conversation.id ? "animate-pulse" : ""} />
        </button>
      {/if}

      <select
        class="mynx-input mynx-cn-select mynx-cn-model"
        value={choiceKey(chatNext.choice)}
        aria-label={t("chatNext.model")}
        disabled={providers.length === 0}
        onchange={(event) => pickModel(event.currentTarget.value)}
      >
        {#each providers as provider (provider.id)}
          <optgroup label={provider.name}>
            {#each provider.models as model (model.id)}
              <option value={choiceKey({ providerId: provider.id, modelId: model.id })}>{model.label ?? model.id}</option>
            {/each}
          </optgroup>
        {/each}
      </select>

      {#if busy}
        <button type="button" class="mynx-btn mynx-cn-send" aria-label={t("chatNext.stop")} title={t("chatNext.stopHint")} onclick={() => stopConversation()}>
          <IconPlayerStopFilled size={14} />
        </button>
      {:else}
        <button type="button" class="mynx-btn mynx-btn-primary mynx-cn-send" aria-label={t("chatNext.send")} title={t("chatNext.send")} disabled={!canSend} onclick={submit}>
          <IconArrowUp size={16} />
        </button>
      {/if}
    </div>
  </div>
  {#if chatNext.compare.length > 0}
    <p class="mynx-note text-center">{t("chatNext.comparing", { count: chatNext.compare.length + 1 })}</p>
  {/if}
</div>
