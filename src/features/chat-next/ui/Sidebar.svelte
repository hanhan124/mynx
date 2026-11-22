<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import IconPlus from "@tabler/icons-svelte/icons/plus";
  import IconSearch from "@tabler/icons-svelte/icons/search";
  import IconX from "@tabler/icons-svelte/icons/x";
  import IconDots from "@tabler/icons-svelte/icons/dots";
  import IconPin from "@tabler/icons-svelte/icons/pin";
  import IconFolder from "@tabler/icons-svelte/icons/folder";
  import IconFolderPlus from "@tabler/icons-svelte/icons/folder-plus";
  import IconChevronRight from "@tabler/icons-svelte/icons/chevron-right";
  import IconGhost from "@tabler/icons-svelte/icons/ghost";
  import IconArchive from "@tabler/icons-svelte/icons/archive";
  import IconSettings from "@tabler/icons-svelte/icons/settings";
  import IconDownload from "@tabler/icons-svelte/icons/download";
  import IconUpload from "@tabler/icons-svelte/icons/upload";
  import { t } from "../../../app/i18n.svelte";
  import { conversationsInFolder, groupConversations, matchExcerpt, searchConversations } from "../core/helpers.js";
  import type { Conversation } from "../core/types.js";
  import {
    chatNext,
    createFolder,
    deleteConversation,
    deleteFolder,
    moveToFolder,
    newConversation,
    nodesOf,
    openSettings,
    renameConversation,
    renameFolder,
    selectConversation,
    setArchived,
    togglePin,
  } from "../state/chat-next.svelte.js";
  import { exportAll, exportConversation, importArchive } from "../state/files.svelte.js";

  let { onpick }: { onpick?: () => void } = $props();

  let renamingId = $state<string | null>(null);
  let renameText = $state("");
  let renamingFolder = $state<string | null>(null);
  let collapsed = $state<Record<string, boolean>>({});
  let confirmDelete = $state<string | null>(null);
  let now = $state(Date.now());

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  const query = $derived(chatNext.query.trim());
  const sections = $derived(
    groupConversations(
      chatNext.snapshot.conversations.filter((c) => !c.temporary),
      now,
      { archived: chatNext.showArchived },
    ),
  );
  const results = $derived(query ? searchConversations(chatNext.snapshot.conversations, chatNext.snapshot.nodes, query) : []);
  const folders = $derived(chatNext.snapshot.folders);

  function pick(id: string): void {
    selectConversation(id);
    onpick?.();
  }

  function startRename(conversation: Conversation): void {
    renamingId = conversation.id;
    renameText = conversation.title;
  }

  function commitRename(): void {
    if (renamingId) renameConversation(renamingId, renameText);
    renamingId = null;
  }

  function startFolderRename(id: string, name: string): void {
    renamingFolder = id;
    renameText = name;
  }

  function commitFolderRename(): void {
    if (renamingFolder) renameFolder(renamingFolder, renameText);
    renamingFolder = null;
  }

  function addFolder(): void {
    const folder = createFolder(t("chatNext.newFolder"));
    if (folder) startFolderRename(folder.id, folder.name);
  }

  function onRenameKey(event: KeyboardEvent, commit: () => void): void {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      renamingId = null;
      renamingFolder = null;
    }
  }

  function sectionLabel(kind: string, group?: string): string {
    return kind === "pinned" ? t("chatNext.pinned") : t(`chatNext.group.${group}`);
  }
</script>

{#snippet item(conversation: Conversation, excerpt = "")}
  <div class="mynx-cn-conv {conversation.id === chatNext.activeId ? 'is-active' : ''}">
    {#if renamingId === conversation.id}
      <input
        class="mynx-input mynx-cn-rename"
        bind:value={renameText}
        aria-label={t("chatNext.rename")}
        onkeydown={(event) => onRenameKey(event, commitRename)}
        onblur={commitRename}
      />
    {:else}
      <button
        type="button"
        class="mynx-cn-conv-main"
        aria-current={conversation.id === chatNext.activeId ? "true" : undefined}
        onclick={() => pick(conversation.id)}
        ondblclick={() => startRename(conversation)}
      >
        {#if conversation.pinned}<IconPin size={12} class="shrink-0 text-text-tertiary" aria-hidden="true" />{/if}
        <span class="mynx-truncate text-body">{conversation.title || t("chatNext.untitled")}</span>
        {#if excerpt}<span class="mynx-truncate text-footnote text-text-secondary">{excerpt}</span>{/if}
      </button>
      {#if confirmDelete === conversation.id}
        <span class="mynx-cn-confirm">
          <button type="button" class="mynx-btn mynx-btn-danger mynx-cn-mini" onclick={() => { deleteConversation(conversation.id); confirmDelete = null; }}>
            {t("chatNext.delete")}
          </button>
          <button type="button" class="mynx-btn mynx-btn-ghost mynx-btn-compact mynx-btn-compact-sm" aria-label={t("chatNext.cancel")} onclick={() => (confirmDelete = null)}>
            <IconX size={13} />
          </button>
        </span>
      {:else}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger class="mynx-cn-conv-action" aria-label={t("chatNext.more")} title={t("chatNext.more")}>
            <IconDots size={14} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="mynx-popover mynx-cn-menu" sideOffset={4} align="start">
              <DropdownMenu.Item class="mynx-cn-menu-item" onSelect={() => startRename(conversation)}>{t("chatNext.rename")}</DropdownMenu.Item>
              <DropdownMenu.Item class="mynx-cn-menu-item" onSelect={() => togglePin(conversation.id)}>
                {conversation.pinned ? t("chatNext.unpin") : t("chatNext.pin")}
              </DropdownMenu.Item>
              <DropdownMenu.Item class="mynx-cn-menu-item" onSelect={() => setArchived(conversation.id, !conversation.archived)}>
                {conversation.archived ? t("chatNext.unarchive") : t("chatNext.archive")}
              </DropdownMenu.Item>
              {#if folders.length > 0 || conversation.folderId}
                <DropdownMenu.Separator class="mynx-cn-menu-sep" />
                <div class="mynx-cn-menu-label">{t("chatNext.moveTo")}</div>
                {#if conversation.folderId}
                  <DropdownMenu.Item class="mynx-cn-menu-item" onSelect={() => moveToFolder(conversation.id, null)}>{t("chatNext.noFolder")}</DropdownMenu.Item>
                {/if}
                {#each folders.filter((f) => f.id !== conversation.folderId) as folder (folder.id)}
                  <DropdownMenu.Item class="mynx-cn-menu-item" onSelect={() => moveToFolder(conversation.id, folder.id)}>{folder.name}</DropdownMenu.Item>
                {/each}
              {/if}
              <DropdownMenu.Separator class="mynx-cn-menu-sep" />
              <DropdownMenu.Item class="mynx-cn-menu-item" onSelect={() => void exportConversation(conversation.id, "md")}>{t("chatNext.exportMd")}</DropdownMenu.Item>
              <DropdownMenu.Item class="mynx-cn-menu-item" onSelect={() => void exportConversation(conversation.id, "json")}>{t("chatNext.exportJson")}</DropdownMenu.Item>
              <DropdownMenu.Separator class="mynx-cn-menu-sep" />
              <DropdownMenu.Item class="mynx-cn-menu-item is-danger" onSelect={() => (confirmDelete = conversation.id)}>{t("chatNext.delete")}</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      {/if}
    {/if}
  </div>
{/snippet}

<aside class="mynx-cn-sidebar" aria-label={t("chatNext.conversations")}>
  <div class="mynx-cn-sidebar-top">
    <button type="button" class="mynx-btn mynx-cn-new" onclick={() => { newConversation(); onpick?.(); }} title={t("chatNext.newChatHint")}>
      <IconPlus size={15} />
      <span>{t("chatNext.newChat")}</span>
    </button>
    <button
      type="button"
      class="mynx-btn mynx-btn-ghost mynx-btn-compact"
      aria-label={t("chatNext.temporary")}
      title={t("chatNext.temporaryHint")}
      onclick={() => { newConversation(true); onpick?.(); }}
    >
      <IconGhost size={16} />
    </button>
  </div>

  <label class="mynx-search-field mynx-cn-search">
    <IconSearch size={14} class="shrink-0 text-text-secondary" aria-hidden="true" />
    <input type="search" class="min-w-0 flex-1 bg-transparent text-body outline-none" placeholder={t("chatNext.search")} aria-label={t("chatNext.search")} bind:value={chatNext.query} />
  </label>

  <nav class="mynx-cn-list">
    {#if query}
      <p class="mynx-cn-section">{t("chatNext.results", { count: results.length })}</p>
      {#each results as conversation (conversation.id)}
        {@render item(conversation, matchExcerpt(nodesOf(conversation.id), query))}
      {:else}
        <p class="mynx-note px-2">{t("chatNext.noResults")}</p>
      {/each}
    {:else}
      {#if !chatNext.showArchived}
        <div class="mynx-cn-section mynx-cn-section-row">
          <span>{t("chatNext.projects")}</span>
          <button type="button" class="mynx-btn mynx-btn-ghost mynx-btn-compact mynx-btn-compact-sm" aria-label={t("chatNext.newFolder")} title={t("chatNext.newFolder")} onclick={addFolder}>
            <IconFolderPlus size={14} />
          </button>
        </div>
        {#each folders as folder (folder.id)}
          {@const inside = conversationsInFolder(chatNext.snapshot.conversations, folder.id)}
          <div class="mynx-cn-folder">
            {#if renamingFolder === folder.id}
              <input class="mynx-input mynx-cn-rename" bind:value={renameText} aria-label={t("chatNext.rename")} onkeydown={(event) => onRenameKey(event, commitFolderRename)} onblur={commitFolderRename} />
            {:else}
              <button type="button" class="mynx-cn-folder-main" aria-expanded={!collapsed[folder.id]} onclick={() => (collapsed[folder.id] = !collapsed[folder.id])}>
                <IconChevronRight size={12} class="mynx-cn-caret {collapsed[folder.id] ? '' : 'is-open'}" aria-hidden="true" />
                <IconFolder size={14} aria-hidden="true" />
                <span class="mynx-truncate text-body">{folder.name}</span>
                <span class="mynx-num text-footnote text-text-tertiary">{inside.length}</span>
              </button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger class="mynx-cn-conv-action" aria-label={t("chatNext.more")} title={t("chatNext.more")}>
                  <IconDots size={14} />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content class="mynx-popover mynx-cn-menu" sideOffset={4} align="start">
                    <DropdownMenu.Item class="mynx-cn-menu-item" onSelect={() => { newConversation(false, folder.id); onpick?.(); }}>{t("chatNext.newChatHere")}</DropdownMenu.Item>
                    <DropdownMenu.Item class="mynx-cn-menu-item" onSelect={() => startFolderRename(folder.id, folder.name)}>{t("chatNext.rename")}</DropdownMenu.Item>
                    <DropdownMenu.Separator class="mynx-cn-menu-sep" />
                    <DropdownMenu.Item class="mynx-cn-menu-item is-danger" onSelect={() => deleteFolder(folder.id)}>{t("chatNext.deleteFolder")}</DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            {/if}
          </div>
          {#if !collapsed[folder.id]}
            <div class="mynx-cn-folder-items">
              {#each inside as conversation (conversation.id)}
                {@render item(conversation)}
              {:else}
                <p class="mynx-note px-2">{t("chatNext.folderEmpty")}</p>
              {/each}
            </div>
          {/if}
        {/each}
      {/if}

      {#each sections as section (section.key)}
        <p class="mynx-cn-section">{chatNext.showArchived ? t("chatNext.archived") : sectionLabel(section.kind, section.group)}</p>
        {#each section.conversations as conversation (conversation.id)}
          {@render item(conversation)}
        {/each}
      {:else}
        {#if folders.length === 0}
          <p class="mynx-note px-2">{chatNext.showArchived ? t("chatNext.noArchived") : t("chatNext.noChats")}</p>
        {/if}
      {/each}
    {/if}
  </nav>

  <div class="mynx-cn-sidebar-foot">
    <button
      type="button"
      class="mynx-btn mynx-btn-ghost mynx-btn-compact {chatNext.showArchived ? 'text-accent' : ''}"
      aria-pressed={chatNext.showArchived}
      aria-label={t("chatNext.showArchived")}
      title={t("chatNext.showArchived")}
      onclick={() => (chatNext.showArchived = !chatNext.showArchived)}
    >
      <IconArchive size={15} />
    </button>
    <button type="button" class="mynx-btn mynx-btn-ghost mynx-btn-compact" aria-label={t("chatNext.exportAll")} title={t("chatNext.exportAll")} onclick={() => void exportAll()}>
      <IconDownload size={15} />
    </button>
    <button type="button" class="mynx-btn mynx-btn-ghost mynx-btn-compact" aria-label={t("chatNext.importChats")} title={t("chatNext.importChats")} onclick={() => void importArchive()}>
      <IconUpload size={15} />
    </button>
    <span class="flex-1"></span>
    <button type="button" class="mynx-btn mynx-btn-ghost mynx-btn-compact" aria-label={t("chatNext.settings")} title={t("chatNext.settings")} onclick={() => openSettings()}>
      <IconSettings size={15} />
    </button>
  </div>
</aside>
