<script lang="ts">
  import Modal from "../../../components/Modal.svelte";
  import { t } from "../../../app/i18n.svelte";
  import type { ModelParams } from "../core/types.js";
  import {
    chatNext,
    clearSummary,
    setConversationAssistant,
    setConversationParams,
    setConversationSystem,
  } from "../state/chat-next.svelte.js";

  const conversation = $derived(chatNext.snapshot.conversations.find((c) => c.id === chatNext.conversationSettingsId));


  function num(value: string): number | undefined {
    const n = Number(value);
    return value.trim() === "" || !Number.isFinite(n) ? undefined : n;
  }

  function patchParams(patch: Partial<ModelParams>): void {
    if (conversation) setConversationParams(conversation.id, { ...(conversation.params ?? {}), ...patch });
  }
</script>

<!-- Open while a conversation is selected; closing clears the selection. -->
<Modal
  bind:open={() => chatNext.conversationSettingsId !== null, (value) => { if (!value) chatNext.conversationSettingsId = null; }}
  title={t("chatNext.chatSettings")} description={conversation?.title || t("chatNext.untitled")} width={560}>
  {#if conversation}
    <div class="mynx-cn-editor">
      <label class="mynx-cn-field">
        <span class="mynx-cn-field-label text-callout">{t("chatNext.assistantPicker")}</span>
        <select class="mynx-input" value={conversation.assistantId ?? ""} onchange={(event) => setConversationAssistant(conversation.id, event.currentTarget.value || undefined)}>
          <option value="">{t("chatNext.noAssistant")}</option>
          {#each chatNext.snapshot.assistants as assistant (assistant.id)}
            <option value={assistant.id}>{assistant.icon} {assistant.name}</option>
          {/each}
        </select>
      </label>
      <label class="mynx-cn-field">
        <span class="mynx-cn-field-label text-callout">{t("chatNext.chatSystem")}<span class="mynx-note"> · {t("chatNext.chatSystemHint")}</span></span>
        <textarea class="mynx-input" rows="5" value={conversation.system ?? ""} onchange={(event) => setConversationSystem(conversation.id, event.currentTarget.value)}></textarea>
      </label>
      <div class="mynx-cn-row">
        <label class="mynx-cn-field">
          <span class="mynx-cn-field-label text-callout">{t("chatNext.temperature")}<span class="mynx-note"> · {t("chatNext.blankInherit")}</span></span>
          <input class="mynx-input mynx-num" type="number" min="0" max="2" step="0.1" value={conversation.params?.temperature ?? ""} onchange={(event) => patchParams({ temperature: num(event.currentTarget.value) })} />
        </label>
        <label class="mynx-cn-field">
          <span class="mynx-cn-field-label text-callout">{t("chatNext.maxTokens")}<span class="mynx-note"> · {t("chatNext.blankInherit")}</span></span>
          <input class="mynx-input mynx-num" type="number" min="1" value={conversation.params?.maxOutputTokens ?? ""} onchange={(event) => patchParams({ maxOutputTokens: num(event.currentTarget.value) })} />
        </label>
      </div>
      {#if conversation.summary}
        <div class="mynx-cn-field">
          <span class="mynx-cn-field-label text-callout">{t("chatNext.summary")}</span>
          <p class="mynx-cn-summary text-callout">{conversation.summary}</p>
          <div class="mynx-cn-row">
            <span class="mynx-note flex-1">{t("chatNext.summaryHint")}</span>
            <button type="button" class="mynx-btn" onclick={() => clearSummary(conversation.id)}>{t("chatNext.clearSummary")}</button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</Modal>
