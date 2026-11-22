<script lang="ts">
  import IconPlus from "@tabler/icons-svelte/icons/plus";
  import IconTrash from "@tabler/icons-svelte/icons/trash";
  import IconRefresh from "@tabler/icons-svelte/icons/refresh";
  import Modal from "../../../components/Modal.svelte";
  import Switch from "../../../components/Switch.svelte";
  import { pushToast } from "../../../app/state.svelte";
  import { t } from "../../../app/i18n.svelte";
  import { errorMessage } from "../core/stream.js";
  import { classifyFetchError, guessCaps } from "../core/remote.js";
  import { resolveEndpoint } from "../core/providers.js";
  import {
    DEFAULT_CAPS,
    type Assistant,
    type McpServerConfig,
    type ModelInfo,
    type PromptTemplate,
    type ProviderConfig,
    type ProviderKind,
    type WebSearchProviderId,
  } from "../core/types.js";
  import {
    addMemory,
    addProvider,
    chatNext,
    choiceKey,
    deleteAssistant,
    deleteMcpServer,
    deleteMemory,
    deletePrompt,
    deleteProvider,
    parseChoiceKey,
    refreshModels,
    saveAssistant,
    saveMcpServer,
    savePrompt,
    saveProvider,
    setProviderKey,
    setWebSearchKey,
    testMcpServer,
    uid,
    updateSettings,
    usableProviders,
    type SettingsTab,
  } from "../state/chat-next.svelte.js";

  const TABS: SettingsTab[] = ["providers", "assistants", "prompts", "memory", "search", "mcp", "general"];
  const KINDS: ProviderKind[] = ["openai-compatible", "openai", "anthropic", "google", "ollama"];
  const PRESETS: Array<{ name: string; kind: ProviderKind; baseUrl: string }> = [
    { name: "DeepSeek", kind: "openai-compatible", baseUrl: "https://api.deepseek.com" },
    { name: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1" },
    { name: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com/v1" },
    { name: "Google Gemini", kind: "google", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
    { name: "OpenRouter", kind: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1" },
    { name: "SiliconFlow", kind: "openai-compatible", baseUrl: "https://api.siliconflow.cn/v1" },
    { name: "Moonshot (Kimi)", kind: "openai-compatible", baseUrl: "https://api.moonshot.cn/v1" },
    { name: "Zhipu GLM", kind: "openai-compatible", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
    { name: "Qwen (DashScope)", kind: "openai-compatible", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
    { name: "xAI Grok", kind: "openai-compatible", baseUrl: "https://api.x.ai/v1" },
    { name: "Groq", kind: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1" },
    { name: "Mistral", kind: "openai-compatible", baseUrl: "https://api.mistral.ai/v1" },
    { name: "Ollama", kind: "ollama", baseUrl: "http://localhost:11434" },
    { name: "LM Studio", kind: "openai-compatible", baseUrl: "http://localhost:1234/v1" },
    { name: "Custom", kind: "openai-compatible", baseUrl: "" },
  ];

  let providerId = $state<string | null>(null);
  let providerDraft = $state<ProviderConfig | null>(null);
  let keyInput = $state("");
  let headersText = $state("");
  let newModelId = $state("");
  let fetching = $state(false);
  let modelsError = $state("");
  let confirmingDelete = $state(false);

  let assistantDraft = $state<Assistant | null>(null);
  let promptDraft = $state<PromptTemplate | null>(null);
  let memoryText = $state("");
  let searchKey = $state("");
  let mcpDraft = $state<McpServerConfig | null>(null);
  let mcpHeaders = $state("");
  let mcpResult = $state("");

  const providers = $derived(chatNext.snapshot.providers);
  const settings = $derived(chatNext.snapshot.settings);

  $effect(() => {
    if (chatNext.settingsOpen && chatNext.memoryDraft) {
      memoryText = chatNext.memoryDraft;
      chatNext.memoryDraft = "";
    }
  });

  $effect(() => {
    if (!providerId && providers.length > 0) selectProvider(providers[0]!.id);
  });

  function headerText(headers: Record<string, string> | undefined): string {
    return Object.entries(headers ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n");
  }

  function parseHeaders(text: string): Record<string, string> | undefined {
    const entries = text
      .split(/\r?\n/)
      .map((line) => line.split(/:(.*)/s).map((part) => part.trim()))
      .filter(([name, value]) => name && value !== undefined) as Array<[string, string]>;
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  function num(value: string): number | undefined {
    const n = Number(value);
    return value.trim() === "" || !Number.isFinite(n) ? undefined : n;
  }

  /* -- providers ---------------------------------------------------- */
  function selectProvider(id: string): void {
    const provider = providers.find((p) => p.id === id);
    providerId = id;
    providerDraft = provider ? $state.snapshot(provider) : null;
    headersText = headerText(provider?.headers);
    keyInput = "";
    modelsError = "";
    confirmingDelete = false;
  }

  function commitProvider(): void {
    if (!providerDraft) return;
    providerDraft.headers = parseHeaders(headersText);
    saveProvider($state.snapshot(providerDraft));
  }

  function createProvider(value: string): void {
    const preset = PRESETS.find((p) => p.name === value);
    if (!preset) return;
    const provider = addProvider(preset.kind, { name: preset.name === "Custom" ? t("chatNext.customProvider") : preset.name, baseUrl: preset.baseUrl });
    selectProvider(provider.id);
  }

  /** Save the typed key (if any). Returns false when saving failed. */
  async function saveKey(silent = false): Promise<boolean> {
    if (!providerDraft || !keyInput.trim()) return true;
    try {
      await setProviderKey(providerDraft.id, keyInput);
      keyInput = "";
      if (!silent) pushToast("success", t("chatNext.keySaved"));
      return true;
    } catch (error) {
      modelsError = t("chatNext.keySaveFailed", { detail: errorMessage(error) });
      return false;
    }
  }

  async function clearKey(): Promise<void> {
    if (!providerDraft) return;
    try {
      await setProviderKey(providerDraft.id, "");
      keyInput = "";
      pushToast("success", t("chatNext.keyCleared"));
    } catch (error) {
      pushToast("error", errorMessage(error));
    }
  }

  async function fetchModels(): Promise<void> {
    if (!providerDraft) return;
    commitProvider();
    modelsError = "";
    // A key typed but not yet saved is what users expect to be used.
    if (!(await saveKey(true))) return;
    fetching = true;
    const id = providerDraft.id;
    try {
      const result = await refreshModels(id);
      selectProvider(id);
      if (result.baseUrlFixed) pushToast("info", t("chatNext.baseUrlFixed", { url: result.baseUrlFixed }));
      if (result.count === 0) modelsError = t("chatNext.modelsEmpty");
      else pushToast("success", t("chatNext.modelsFetched", { count: result.count }));
    } catch (error) {
      const kind = classifyFetchError(error);
      modelsError = `${t(`chatNext.err.${kind}`)}\n${errorMessage(error)}`;
    } finally {
      fetching = false;
    }
  }

  function addModel(): void {
    const id = newModelId.trim();
    if (!providerDraft || !id || providerDraft.models.some((m) => m.id === id)) return;
    providerDraft.models = [...providerDraft.models, { id, caps: { ...DEFAULT_CAPS, ...guessCaps(id) } }];
    newModelId = "";
    commitProvider();
  }

  function patchModel(id: string, patch: Partial<ModelInfo["caps"]> & { label?: string }): void {
    if (!providerDraft) return;
    const { label, ...caps } = patch;
    providerDraft.models = providerDraft.models.map((m) =>
      m.id === id ? { ...m, label: label !== undefined ? label || undefined : m.label, caps: { ...m.caps, ...caps } } : m,
    );
    commitProvider();
  }

  async function removeProvider(): Promise<void> {
    if (!providerDraft) return;
    await deleteProvider(providerDraft.id);
    providerId = null;
    providerDraft = null;
  }

  /* -- assistants / prompts / mcp ----------------------------------- */
  function newAssistant(): void {
    assistantDraft = { id: uid("assistant"), name: t("chatNext.newAssistant"), icon: "🤖", system: "", params: {}, createdAt: Date.now() };
    saveAssistant($state.snapshot(assistantDraft));
  }

  function commitAssistant(): void {
    if (assistantDraft) saveAssistant($state.snapshot(assistantDraft));
  }

  function newPrompt(): void {
    promptDraft = { id: uid("prompt"), title: t("chatNext.newPrompt"), body: "", createdAt: Date.now() };
    savePrompt($state.snapshot(promptDraft));
  }

  function commitPrompt(): void {
    if (promptDraft) savePrompt({ ...$state.snapshot(promptDraft), title: promptDraft.title.replace(/\s+/g, "-") || "prompt" });
  }

  function newMcp(): void {
    mcpDraft = { id: uid("mcp"), name: "MCP", url: "https://", transport: "http", enabled: false };
    mcpHeaders = "";
    mcpResult = "";
    saveMcpServer($state.snapshot(mcpDraft));
  }

  function selectMcp(server: McpServerConfig): void {
    mcpDraft = $state.snapshot(server);
    mcpHeaders = headerText(server.headers);
    mcpResult = "";
  }

  function commitMcp(): void {
    if (!mcpDraft) return;
    mcpDraft.headers = parseHeaders(mcpHeaders);
    saveMcpServer($state.snapshot(mcpDraft));
  }

  async function probe(): Promise<void> {
    if (!mcpDraft) return;
    commitMcp();
    mcpResult = t("chatNext.testing");
    try {
      const names = await testMcpServer($state.snapshot(mcpDraft));
      mcpResult = t("chatNext.mcpTools", { count: names.length, names: names.slice(0, 12).join(", ") });
    } catch (error) {
      mcpResult = t("chatNext.error", { detail: errorMessage(error) });
    }
  }

  /* -- search / general --------------------------------------------- */
  function patchSearch(patch: Partial<NonNullable<typeof settings.webSearch>>): void {
    const current = settings.webSearch ?? { provider: "off" as WebSearchProviderId, resultCount: 5, enabled: false };
    updateSettings({ webSearch: { ...current, ...patch } });
  }

  async function saveSearchKey(): Promise<void> {
    try {
      await setWebSearchKey(searchKey);
      searchKey = "";
      pushToast("success", t("chatNext.keySaved"));
    } catch (error) {
      pushToast("error", errorMessage(error));
    }
  }
</script>

{#snippet field(label: string, hint = "")}
  <span class="mynx-cn-field-label text-callout">{label}{#if hint}<span class="mynx-note"> · {hint}</span>{/if}</span>
{/snippet}

<Modal bind:open={chatNext.settingsOpen} title={t("chatNext.settings")} width={900}>
  <div class="mynx-cn-settings">
    <nav class="mynx-cn-settings-nav" aria-label={t("chatNext.settings")}>
      {#each TABS as tab (tab)}
        <button type="button" class="mynx-cn-settings-tab {chatNext.settingsTab === tab ? 'is-active' : ''}" aria-current={chatNext.settingsTab === tab ? "true" : undefined} onclick={() => (chatNext.settingsTab = tab)}>
          {t(`chatNext.tab.${tab}`)}
        </button>
      {/each}
    </nav>

    <div class="mynx-cn-settings-body">
      {#if chatNext.settingsTab === "providers"}
        <div class="mynx-cn-split">
          <div class="mynx-cn-list-col">
            <select class="mynx-input" value="" aria-label={t("chatNext.addProvider")} onchange={(event) => { createProvider(event.currentTarget.value); event.currentTarget.value = ""; }}>
              <option value="" disabled>{t("chatNext.addProvider")}</option>
              {#each PRESETS as preset (preset.name)}
                <option value={preset.name}>{preset.name === "Custom" ? t("chatNext.customProvider") : preset.name}</option>
              {/each}
            </select>
            {#each providers as provider (provider.id)}
              <button type="button" class="mynx-cn-list-row {provider.id === providerId ? 'is-active' : ''}" onclick={() => selectProvider(provider.id)}>
                <span class="mynx-cn-dot {chatNext.keyStatus[provider.id] || provider.kind === 'ollama' ? 'is-ok' : ''}" aria-hidden="true"></span>
                <span class="mynx-truncate flex-1 text-left text-body">{provider.name}</span>
                <span class="mynx-num text-footnote text-text-tertiary">{provider.models.length}</span>
              </button>
            {:else}
              <p class="mynx-note">{t("chatNext.noProviders")}</p>
            {/each}
          </div>

          {#if providerDraft}
            <div class="mynx-cn-editor">
              <div class="mynx-cn-row">
                <label class="mynx-cn-field">{@render field(t("chatNext.providerName"))}<input class="mynx-input" bind:value={providerDraft.name} onchange={commitProvider} /></label>
                <label class="mynx-cn-field">
                  {@render field(t("chatNext.protocol"))}
                  <select class="mynx-input" bind:value={providerDraft.kind} onchange={commitProvider}>
                    {#each KINDS as kind (kind)}<option value={kind}>{t(`chatNext.kind.${kind}`)}</option>{/each}
                  </select>
                </label>
                <div class="mynx-cn-field mynx-cn-field-switch">
                  {@render field(t("chatNext.enabled"))}
                  <Switch checked={providerDraft.enabled} label={t("chatNext.enabled")} onchange={(next) => { if (providerDraft) { providerDraft.enabled = next; commitProvider(); } }} />
                </div>
              </div>
              <label class="mynx-cn-field">
                {@render field(t("chatNext.baseUrl"))}
                <input class="mynx-input mynx-mono" bind:value={providerDraft.baseUrl} spellcheck="false" placeholder="https://api.example.com/v1" onchange={commitProvider} />
                <span class="mynx-note mynx-mono mynx-truncate">{t("chatNext.endpointPreview", { url: resolveEndpoint(providerDraft).baseURL || "—" })}</span>
              </label>
              <label class="mynx-cn-field">
                {@render field(t("chatNext.apiKey"), chatNext.keyStatus[providerDraft.id] ? t("chatNext.keyStored") : t("chatNext.keyMissing"))}
                <span class="flex gap-2">
                  <input
                    class="mynx-input min-w-0 flex-1"
                    type="password"
                    autocomplete="off"
                    spellcheck="false"
                    bind:value={keyInput}
                    placeholder={chatNext.keyStatus[providerDraft.id] ? t("chatNext.keyReplace") : t("chatNext.keyPlaceholder")}
                    onkeydown={(event) => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); void saveKey(); } }}
                    onblur={() => void saveKey(true)}
                  />
                  <button type="button" class="mynx-btn" disabled={!keyInput.trim()} onclick={() => void saveKey()}>{t("chatNext.saveKey")}</button>
                  {#if chatNext.keyStatus[providerDraft.id]}
                    <button type="button" class="mynx-btn mynx-btn-ghost" onclick={() => void clearKey()}>{t("chatNext.clearKey")}</button>
                  {/if}
                </span>
              </label>
              <label class="mynx-cn-field">
                {@render field(t("chatNext.headers"), t("chatNext.headersHint"))}
                <textarea class="mynx-input mynx-mono" rows="2" bind:value={headersText} spellcheck="false" onchange={commitProvider}></textarea>
              </label>

              <div class="mynx-cn-row">
                <span class="text-headline">{t("chatNext.models")}</span>
                <span class="flex-1"></span>
                <button type="button" class="mynx-btn" disabled={fetching} onclick={() => void fetchModels()}>
                  <IconRefresh size={14} class={fetching ? "animate-spin" : ""} />{fetching ? t("chatNext.fetching") : t("chatNext.fetchModels")}
                </button>
              </div>
              {#if modelsError}
                <p class="mynx-cn-error mynx-cn-error-block text-callout" role="alert">{modelsError}</p>
              {/if}
              <div class="mynx-cn-row">
                <input class="mynx-input min-w-0 flex-1 mynx-mono" bind:value={newModelId} placeholder={t("chatNext.modelIdPlaceholder")} aria-label={t("chatNext.addModel")} onkeydown={(event) => { if (event.key === "Enter") addModel(); }} />
                <button type="button" class="mynx-btn" disabled={!newModelId.trim()} onclick={addModel}><IconPlus size={14} />{t("chatNext.addModel")}</button>
              </div>
              <div class="mynx-cn-models">
                <div class="mynx-cn-model-head text-footnote">
                  <span>{t("chatNext.model")}</span><span>{t("chatNext.cap.vision")}</span><span>{t("chatNext.cap.reasoning")}</span><span>{t("chatNext.cap.tools")}</span>
                  <span>{t("chatNext.contextWindow")}</span><span>{t("chatNext.priceIn")}</span><span>{t("chatNext.priceOut")}</span><span></span>
                </div>
                {#each providerDraft.models as model (model.id)}
                  <div class="mynx-cn-model-row">
                    <span class="mynx-truncate mynx-mono text-callout" title={model.id}>{model.id}</span>
                    <input type="checkbox" checked={model.caps.vision} aria-label={t("chatNext.cap.vision")} onchange={(event) => patchModel(model.id, { vision: event.currentTarget.checked })} />
                    <input type="checkbox" checked={model.caps.reasoning} aria-label={t("chatNext.cap.reasoning")} onchange={(event) => patchModel(model.id, { reasoning: event.currentTarget.checked })} />
                    <input type="checkbox" checked={model.caps.tools} aria-label={t("chatNext.cap.tools")} onchange={(event) => patchModel(model.id, { tools: event.currentTarget.checked })} />
                    <input class="mynx-input mynx-num" type="number" min="0" value={model.caps.contextWindow ?? ""} aria-label={t("chatNext.contextWindow")} onchange={(event) => patchModel(model.id, { contextWindow: num(event.currentTarget.value) })} />
                    <input class="mynx-input mynx-num" type="number" min="0" step="0.01" value={model.caps.inputPrice ?? ""} aria-label={t("chatNext.priceIn")} onchange={(event) => patchModel(model.id, { inputPrice: num(event.currentTarget.value) })} />
                    <input class="mynx-input mynx-num" type="number" min="0" step="0.01" value={model.caps.outputPrice ?? ""} aria-label={t("chatNext.priceOut")} onchange={(event) => patchModel(model.id, { outputPrice: num(event.currentTarget.value) })} />
                    <button type="button" class="mynx-btn mynx-btn-ghost mynx-btn-compact mynx-btn-compact-sm" aria-label={t("chatNext.removeModel")} title={t("chatNext.removeModel")} onclick={() => { if (providerDraft) { providerDraft.models = providerDraft.models.filter((m) => m.id !== model.id); commitProvider(); } }}>
                      <IconTrash size={13} />
                    </button>
                  </div>
                {:else}
                  <p class="mynx-note">{t("chatNext.noModels")}</p>
                {/each}
              </div>
              <p class="mynx-note">{t("chatNext.priceHint")}</p>

              <div class="mynx-cn-row">
                <span class="flex-1"></span>
                {#if confirmingDelete}
                  <span class="text-callout">{t("chatNext.confirmDeleteProvider")}</span>
                  <button type="button" class="mynx-btn" onclick={() => (confirmingDelete = false)}>{t("chatNext.cancel")}</button>
                  <button type="button" class="mynx-btn mynx-btn-danger" onclick={() => void removeProvider()}>{t("chatNext.delete")}</button>
                {:else}
                  <button type="button" class="mynx-btn mynx-btn-danger" onclick={() => (confirmingDelete = true)}>{t("chatNext.deleteProvider")}</button>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {:else if chatNext.settingsTab === "assistants"}
        <div class="mynx-cn-split">
          <div class="mynx-cn-list-col">
            <button type="button" class="mynx-btn" onclick={newAssistant}><IconPlus size={14} />{t("chatNext.newAssistant")}</button>
            {#each chatNext.snapshot.assistants as assistant (assistant.id)}
              <button type="button" class="mynx-cn-list-row {assistantDraft?.id === assistant.id ? 'is-active' : ''}" onclick={() => (assistantDraft = $state.snapshot(assistant))}>
                <span aria-hidden="true">{assistant.icon}</span><span class="mynx-truncate flex-1 text-left text-body">{assistant.name}</span>
              </button>
            {:else}
              <p class="mynx-note">{t("chatNext.assistantsHint")}</p>
            {/each}
          </div>
          {#if assistantDraft}
            <div class="mynx-cn-editor">
              <div class="mynx-cn-row">
                <label class="mynx-cn-field mynx-cn-field-icon">{@render field(t("chatNext.icon"))}<input class="mynx-input" maxlength="4" bind:value={assistantDraft.icon} onchange={commitAssistant} /></label>
                <label class="mynx-cn-field flex-1">{@render field(t("chatNext.assistantName"))}<input class="mynx-input" bind:value={assistantDraft.name} onchange={commitAssistant} /></label>
              </div>
              <label class="mynx-cn-field">{@render field(t("chatNext.systemPrompt"))}<textarea class="mynx-input" rows="6" bind:value={assistantDraft.system} onchange={commitAssistant}></textarea></label>
              <div class="mynx-cn-row">
                <label class="mynx-cn-field flex-1">
                  {@render field(t("chatNext.defaultModel"))}
                  <select class="mynx-input" value={assistantDraft.providerId && assistantDraft.modelId ? choiceKey({ providerId: assistantDraft.providerId, modelId: assistantDraft.modelId }) : ""} onchange={(event) => { if (!assistantDraft) return; const choice = parseChoiceKey(event.currentTarget.value); assistantDraft.providerId = choice?.providerId; assistantDraft.modelId = choice?.modelId; commitAssistant(); }}>
                    <option value="">{t("chatNext.inheritModel")}</option>
                    {#each usableProviders() as provider (provider.id)}
                      <optgroup label={provider.name}>
                        {#each provider.models as model (model.id)}<option value={choiceKey({ providerId: provider.id, modelId: model.id })}>{model.label ?? model.id}</option>{/each}
                      </optgroup>
                    {/each}
                  </select>
                </label>
                <label class="mynx-cn-field">{@render field(t("chatNext.temperature"))}<input class="mynx-input mynx-num" type="number" min="0" max="2" step="0.1" value={assistantDraft.params.temperature ?? ""} onchange={(event) => { if (assistantDraft) { assistantDraft.params.temperature = num(event.currentTarget.value); commitAssistant(); } }} /></label>
                <label class="mynx-cn-field">{@render field(t("chatNext.maxTokens"))}<input class="mynx-input mynx-num" type="number" min="1" value={assistantDraft.params.maxOutputTokens ?? ""} onchange={(event) => { if (assistantDraft) { assistantDraft.params.maxOutputTokens = num(event.currentTarget.value); commitAssistant(); } }} /></label>
              </div>
              <div class="mynx-cn-row"><span class="flex-1"></span><button type="button" class="mynx-btn mynx-btn-danger" onclick={() => { if (assistantDraft) deleteAssistant(assistantDraft.id); assistantDraft = null; }}>{t("chatNext.delete")}</button></div>
            </div>
          {/if}
        </div>
      {:else if chatNext.settingsTab === "prompts"}
        <div class="mynx-cn-split">
          <div class="mynx-cn-list-col">
            <button type="button" class="mynx-btn" onclick={newPrompt}><IconPlus size={14} />{t("chatNext.newPrompt")}</button>
            {#each chatNext.snapshot.prompts as prompt (prompt.id)}
              <button type="button" class="mynx-cn-list-row {promptDraft?.id === prompt.id ? 'is-active' : ''}" onclick={() => (promptDraft = $state.snapshot(prompt))}>
                <span class="mynx-truncate flex-1 text-left text-body">/{prompt.title}</span>
              </button>
            {:else}
              <p class="mynx-note">{t("chatNext.promptsHint")}</p>
            {/each}
          </div>
          {#if promptDraft}
            <div class="mynx-cn-editor">
              <label class="mynx-cn-field">{@render field(t("chatNext.promptTitle"), t("chatNext.promptTitleHint"))}<input class="mynx-input" bind:value={promptDraft.title} onchange={commitPrompt} /></label>
              <label class="mynx-cn-field">{@render field(t("chatNext.promptBody"))}<textarea class="mynx-input" rows="10" bind:value={promptDraft.body} onchange={commitPrompt}></textarea></label>
              <div class="mynx-cn-row"><span class="flex-1"></span><button type="button" class="mynx-btn mynx-btn-danger" onclick={() => { if (promptDraft) deletePrompt(promptDraft.id); promptDraft = null; }}>{t("chatNext.delete")}</button></div>
            </div>
          {/if}
        </div>
      {:else if chatNext.settingsTab === "memory"}
        <div class="mynx-cn-editor">
          <div class="mynx-cn-row">
            <span class="flex-1 text-body">{t("chatNext.memoryEnabled")}</span>
            <Switch checked={settings.memoryEnabled !== false} label={t("chatNext.memoryEnabled")} onchange={(next) => updateSettings({ memoryEnabled: next })} />
          </div>
          <p class="mynx-note">{t("chatNext.memoryHint")}</p>
          <label class="mynx-cn-field">
            {@render field(t("chatNext.addMemory"))}
            <textarea class="mynx-input" rows="3" bind:value={memoryText}></textarea>
          </label>
          <div class="mynx-cn-row"><span class="flex-1"></span><button type="button" class="mynx-btn mynx-btn-primary" disabled={!memoryText.trim()} onclick={() => { addMemory(memoryText); memoryText = ""; }}>{t("chatNext.saveMemory")}</button></div>
          <ul class="mynx-cn-memories">
            {#each chatNext.snapshot.memories as memory (memory.id)}
              <li>
                <span class="flex-1 text-body">{memory.text}</span>
                <button type="button" class="mynx-btn mynx-btn-ghost mynx-btn-compact mynx-btn-compact-sm" aria-label={t("chatNext.delete")} title={t("chatNext.delete")} onclick={() => deleteMemory(memory.id)}><IconTrash size={13} /></button>
              </li>
            {:else}
              <li class="mynx-note">{t("chatNext.noMemories")}</li>
            {/each}
          </ul>
        </div>
      {:else if chatNext.settingsTab === "search"}
        <div class="mynx-cn-editor">
          <label class="mynx-cn-field">
            {@render field(t("chatNext.searchProvider"))}
            <select class="mynx-input" value={settings.webSearch?.provider ?? "off"} onchange={(event) => patchSearch({ provider: event.currentTarget.value as WebSearchProviderId })}>
              <option value="off">{t("chatNext.searchOff")}</option>
              <option value="tavily">Tavily</option>
              <option value="serper">Serper (Google)</option>
              <option value="searxng">SearXNG</option>
            </select>
          </label>
          {#if settings.webSearch?.provider === "searxng"}
            <label class="mynx-cn-field">{@render field(t("chatNext.searchUrl"))}<input class="mynx-input mynx-mono" value={settings.webSearch.url ?? ""} placeholder="https://searx.example.com" onchange={(event) => patchSearch({ url: event.currentTarget.value.trim() || undefined })} /></label>
          {:else if settings.webSearch && settings.webSearch.provider !== "off"}
            <label class="mynx-cn-field">
              {@render field(t("chatNext.apiKey"), chatNext.webSearchKeySet ? t("chatNext.keyStored") : t("chatNext.keyMissing"))}
              <span class="flex gap-2">
                <input class="mynx-input min-w-0 flex-1" type="password" autocomplete="off" bind:value={searchKey} />
                <button type="button" class="mynx-btn" onclick={() => void saveSearchKey()}>{searchKey ? t("chatNext.saveKey") : t("chatNext.clearKey")}</button>
              </span>
            </label>
          {/if}
          {#if settings.webSearch && settings.webSearch.provider !== "off"}
            <label class="mynx-cn-field">{@render field(t("chatNext.searchCount"))}<input class="mynx-input mynx-num" type="number" min="1" max="10" value={settings.webSearch.resultCount} onchange={(event) => patchSearch({ resultCount: Math.min(10, Math.max(1, num(event.currentTarget.value) ?? 5)) })} /></label>
            <div class="mynx-cn-row">
              <span class="flex-1 text-body">{t("chatNext.searchDefaultOn")}</span>
              <Switch checked={settings.webSearch.enabled} label={t("chatNext.searchDefaultOn")} onchange={(next) => patchSearch({ enabled: next })} />
            </div>
          {/if}
          <p class="mynx-note">{t("chatNext.searchHint")}</p>
        </div>
      {:else if chatNext.settingsTab === "mcp"}
        <div class="mynx-cn-split">
          <div class="mynx-cn-list-col">
            <button type="button" class="mynx-btn" onclick={newMcp}><IconPlus size={14} />{t("chatNext.addMcp")}</button>
            {#each chatNext.snapshot.mcpServers as server (server.id)}
              <button type="button" class="mynx-cn-list-row {mcpDraft?.id === server.id ? 'is-active' : ''}" onclick={() => selectMcp(server)}>
                <span class="mynx-cn-dot {server.enabled ? 'is-ok' : ''}" aria-hidden="true"></span>
                <span class="mynx-truncate flex-1 text-left text-body">{server.name}</span>
              </button>
            {:else}
              <p class="mynx-note">{t("chatNext.mcpHint")}</p>
            {/each}
          </div>
          {#if mcpDraft}
            <div class="mynx-cn-editor">
              <div class="mynx-cn-row">
                <label class="mynx-cn-field flex-1">{@render field(t("chatNext.providerName"))}<input class="mynx-input" bind:value={mcpDraft.name} onchange={commitMcp} /></label>
                <label class="mynx-cn-field">
                  {@render field(t("chatNext.transport"))}
                  <select class="mynx-input" bind:value={mcpDraft.transport} onchange={commitMcp}><option value="http">Streamable HTTP</option><option value="sse">SSE</option></select>
                </label>
                <div class="mynx-cn-field mynx-cn-field-switch">
                  {@render field(t("chatNext.enabled"))}
                  <Switch checked={mcpDraft.enabled} label={t("chatNext.enabled")} onchange={(next) => { if (mcpDraft) { mcpDraft.enabled = next; commitMcp(); } }} />
                </div>
              </div>
              <label class="mynx-cn-field">{@render field("URL")}<input class="mynx-input mynx-mono" bind:value={mcpDraft.url} spellcheck="false" onchange={commitMcp} /></label>
              <label class="mynx-cn-field">{@render field(t("chatNext.headers"), t("chatNext.headersHint"))}<textarea class="mynx-input mynx-mono" rows="2" bind:value={mcpHeaders} spellcheck="false" onchange={commitMcp}></textarea></label>
              <p class="mynx-note">{t("chatNext.mcpApprovalNote")}</p>
              <div class="mynx-cn-row">
                <button type="button" class="mynx-btn" onclick={() => void probe()}>{t("chatNext.testConnection")}</button>
                <span class="mynx-truncate flex-1 text-callout text-text-secondary" title={mcpResult}>{mcpResult}</span>
                <button type="button" class="mynx-btn mynx-btn-danger" onclick={() => { if (mcpDraft) deleteMcpServer(mcpDraft.id); mcpDraft = null; }}>{t("chatNext.delete")}</button>
              </div>
            </div>
          {/if}
        </div>
      {:else}
        <div class="mynx-cn-editor">
          <label class="mynx-cn-field">{@render field(t("chatNext.globalSystem"))}<textarea class="mynx-input" rows="5" value={settings.systemPrompt ?? ""} onchange={(event) => updateSettings({ systemPrompt: event.currentTarget.value.trim() || undefined })}></textarea></label>
          <div class="mynx-cn-row">
            <label class="mynx-cn-field">{@render field(t("chatNext.temperature"), t("chatNext.blankDefault"))}<input class="mynx-input mynx-num" type="number" min="0" max="2" step="0.1" value={settings.params.temperature ?? ""} onchange={(event) => updateSettings({ params: { ...settings.params, temperature: num(event.currentTarget.value) } })} /></label>
            <label class="mynx-cn-field">{@render field(t("chatNext.maxTokens"), t("chatNext.blankDefault"))}<input class="mynx-input mynx-num" type="number" min="1" value={settings.params.maxOutputTokens ?? ""} onchange={(event) => updateSettings({ params: { ...settings.params, maxOutputTokens: num(event.currentTarget.value) } })} /></label>
          </div>
          <div class="mynx-cn-row">
            <span class="flex-1 text-body">{t("chatNext.autoTitle")}</span>
            <Switch checked={settings.autoTitle !== false} label={t("chatNext.autoTitle")} onchange={(next) => updateSettings({ autoTitle: next })} />
          </div>
          <p class="text-headline">{t("chatNext.shortcuts")}</p>
          <dl class="mynx-cn-shortcuts text-callout">
            <dt><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>O</kbd></dt><dd>{t("chatNext.newChat")}</dd>
            <dt><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>S</kbd></dt><dd>{t("chatNext.toggleSidebar")}</dd>
            <dt><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>;</kbd></dt><dd>{t("chatNext.copyLast")}</dd>
            <dt><kbd>Shift</kbd> <kbd>Esc</kbd></dt><dd>{t("chatNext.focusComposer")}</dd>
            <dt><kbd>Esc</kbd></dt><dd>{t("chatNext.stop")}</dd>
            <dt><kbd>/</kbd></dt><dd>{t("chatNext.promptLibrary")}</dd>
          </dl>
        </div>
      {/if}
    </div>
  </div>
</Modal>
