import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  IconArrowLeft,
  IconArrowRight,
  IconChevronDown,
  IconHome2,
  IconPrinter,
  IconRefresh,
  IconSquare,
  IconZoomIn,
  IconZoomOut,
  IconMinus,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { isSearchEngine, SEARCH_ENGINES, type SearchEngine } from "@/lib/search-engines";
import { useLanguage } from "@/lib/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";

const initialSearchParams = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
type SearchTab = { id: number; query: string; engine: SearchEngine; title?: string; url?: string };
const initialEngineValue = initialSearchParams.get("engine") ?? localStorage.getItem("mynx-search-engine");
const initialEngine: SearchEngine = isSearchEngine(initialEngineValue) ? initialEngineValue : "bing";

export default function SearchWindow() {
  const appWindow = getCurrentWindow();
  const { t } = useLanguage();
  const [engine, setEngine] = useState<SearchEngine>(() => {
    return initialEngine;
  });
  const [query, setQuery] = useState(initialSearchParams.get("query") ?? "");
  const [addressValue, setAddressValue] = useState(initialSearchParams.get("query") ?? "");
  const [pageLoading, setPageLoading] = useState(true);
  const [commandError, setCommandError] = useState("");
  const [tabs, setTabs] = useState<SearchTab[]>([{ id: 0, query: initialSearchParams.get("query") ?? "", engine: initialEngine }]);
  const [activeTab, setActiveTab] = useState(0);
  const [lastClosedTab, setLastClosedTab] = useState<SearchTab | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function showCommandError(error: unknown) {
    setPageLoading(false);
    setCommandError(typeof error === "string" ? error : t("search.failed"));
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void appWindow
      .listen<{ engine: SearchEngine; query: string; tab?: number }>("search-query", (event) => {
        if (event.payload.tab !== undefined && event.payload.tab !== activeTab) return;
        setEngine(event.payload.engine);
        setQuery(event.payload.query);
        setAddressValue(event.payload.query);
        setTabs((current) => current.map((tab) => tab.id === activeTab ? { ...tab, query: event.payload.query, engine: event.payload.engine } : tab));
      })
      .then((dispose) => {
        unlisten = dispose;
      });
    return () => unlisten?.();
  }, [activeTab, appWindow]);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    const listeners = Promise.all([
      appWindow.listen<{ id: number; query: string; engine: SearchEngine }>("search-tab-created", (event) => {
        setTabs((current) => current.some((tab) => tab.id === event.payload.id)
          ? current
          : [...current, { id: event.payload.id, query: event.payload.query, engine: event.payload.engine }]);
        setActiveTab(event.payload.id);
        setQuery(event.payload.query);
        setAddressValue(event.payload.query);
        setPageLoading(true);
      }),
      appWindow.listen<{ id: number }>("search-tab-switched", (event) => setActiveTab(event.payload.id)),
      appWindow.listen<{ id: number; active: number; query?: string; engine?: SearchEngine }>("search-tab-closed", (event) => {
        setTabs((current) => {
          const closed = current.find((tab) => tab.id === event.payload.id);
          if (closed) setLastClosedTab({ ...closed, query: event.payload.query ?? closed.query, engine: event.payload.engine ?? closed.engine });
          return current.filter((tab) => tab.id !== event.payload.id);
        });
        setActiveTab(event.payload.active);
      }),
      appWindow.listen<{ id?: number; title: string }>("search-tab-title", (event) => {
        if (event.payload.id === undefined) return;
        setTabs((current) => current.map((tab) => tab.id === event.payload.id ? { ...tab, title: event.payload.title } : tab));
      }),
      appWindow.listen<{ id?: number; url: string }>("search-tab-url", (event) => {
        if (event.payload.id !== undefined && event.payload.id !== activeTab) return;
        setAddressValue(event.payload.url);
        setTabs((current) => current.map((tab) => tab.id === activeTab ? { ...tab, url: event.payload.url } : tab));
      }),
    ]);
    void listeners.then((cleanups) => { dispose = () => cleanups.forEach((cleanup) => cleanup()); });
    return () => dispose?.();
  }, [activeTab, appWindow]);

  useEffect(() => {
    const current = tabs.find((tab) => tab.id === activeTab);
    if (!current) return;
    // These fields are intentionally mirrored into controlled toolbar inputs
    // when the active native WebView tab changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEngine(current.engine);
    setQuery(current.query);
    setAddressValue(current.url ?? current.query);
  }, [activeTab, tabs]);

  function runContentAction(action: "back" | "forward" | "reload" | "print" | "zoom-in" | "zoom-out") {
    setCommandError("");
    if (action !== "print" && !action.startsWith("zoom")) setPageLoading(true);
    void invoke("search_content_action", { action, tab: activeTab }).catch(showCommandError);
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void appWindow
      .listen<{ state: "started" | "finished"; tab?: number }>("search-page-load", (event) => {
        if (event.payload.tab === undefined || event.payload.tab === activeTab) {
          setPageLoading(event.payload.state === "started");
        }
      })
      .then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, [activeTab, appWindow]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "l") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        runContentAction("back");
      } else if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        runContentAction("forward");
      } else if ((event.ctrlKey || event.metaKey) && key === "r") {
        event.preventDefault();
        runContentAction("reload");
      } else if (event.key === "F5") {
        event.preventDefault();
        runContentAction("reload");
      } else if ((event.ctrlKey || event.metaKey) && key === "p") {
        event.preventDefault();
        runContentAction("print");
      } else if ((event.ctrlKey || event.metaKey) && key === "t") {
        event.preventDefault();
        if (event.shiftKey && lastClosedTab) {
          void invoke("search_new_tab", { engine: lastClosedTab.engine, query: lastClosedTab.query }).catch(showCommandError);
          setLastClosedTab(null);
        } else {
          void invoke("search_new_tab", { engine, query: "" }).catch(showCommandError);
        }
      } else if ((event.ctrlKey || event.metaKey) && (key === "w" || (event.shiftKey && key === "w"))) {
        event.preventDefault();
        if (activeTab === 0 && tabs.length === 1) void appWindow.close();
        else {
          const currentTab = tabs.find((tab) => tab.id === activeTab);
          void invoke("search_close_tab", { tab: activeTab, query: currentTab?.query ?? query, engine: currentTab?.engine ?? engine }).catch(showCommandError);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab, appWindow, engine, lastClosedTab, query, tabs]);

  function handleToolbarDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, form")) return;
    void appWindow.toggleMaximize();
  }

  function handleToolbarMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, form")) return;
    void appWindow.startDragging();
  }

  function search(nextEngine = engine) {
    const value = addressValue.trim();
    if (!value) return;
    setCommandError("");
    setEngine(nextEngine);
    localStorage.setItem("mynx-search-engine", nextEngine);
    setTabs((current) => current.map((tab) => tab.id === activeTab ? { ...tab, query: value, engine: nextEngine } : tab));
    setPageLoading(true);
    if (/^https?:\/\//i.test(value)) {
      void invoke("navigate_search_window", { url: value, tab: activeTab }).catch(showCommandError);
    } else {
      void invoke("open_search_window", { query: value, engine: nextEngine, tab: activeTab }).catch(showCommandError);
    }
  }

  function createTab() {
    void invoke("search_new_tab", { engine, query: "" }).catch(showCommandError);
  }

  return (
    <div className="search-window-shell" data-tauri-drag-region onDoubleClick={handleToolbarDoubleClick}>
      <div className="search-window-toolbar" data-tauri-drag-region onMouseDown={handleToolbarMouseDown}>
        {pageLoading && <span className="search-window-loading-line" aria-label={t("search.loading")} />}
        <div className="search-window-brand" aria-label={t("search.brand")}>
          <span>Mynx <em>Search</em></span>
        </div>
        <div className="search-window-nav">
          <button data-tauri-no-drag type="button" title={t("search.back")} onClick={() => runContentAction("back")}>
            <IconArrowLeft size={17} />
          </button>
          <button data-tauri-no-drag type="button" title={t("search.forward")} onClick={() => runContentAction("forward")}>
            <IconArrowRight size={17} />
          </button>
          <button data-tauri-no-drag type="button" title={t("search.reload")} onClick={() => runContentAction("reload")}>
            <IconRefresh size={16} />
          </button>
          <button data-tauri-no-drag type="button" title={t("search.print")} onClick={() => runContentAction("print")}>
            <IconPrinter size={16} />
          </button>
          <button data-tauri-no-drag type="button" title={t("search.zoomIn")} onClick={() => runContentAction("zoom-in")}>
            <IconZoomIn size={16} />
          </button>
          <button data-tauri-no-drag type="button" title={t("search.zoomOut")} onClick={() => runContentAction("zoom-out")}>
            <IconZoomOut size={16} />
          </button>
          <button data-tauri-no-drag type="button" title={t("search.home")} onClick={() => void appWindow.close()}>
            <IconHome2 size={16} />
          </button>
        </div>
        <div className="search-window-tabs" role="tablist" aria-label={t("search.tabs")}>
          {tabs.map((tab) => (
            <div key={tab.id} className={`search-window-tab${activeTab === tab.id ? " is-active" : ""}`}>
              <button
                data-tauri-no-drag
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                title={tab.title || tab.query || t("search.newTab")}
                onClick={() => {
                  setActiveTab(tab.id);
                  void invoke("search_switch_tab", { tab: tab.id }).catch(showCommandError);
                }}
              >
                {tab.title || tab.query || t("search.newTab")}
              </button>
              {tab.id !== 0 && (
                <button data-tauri-no-drag type="button" className="search-window-tab-close" title={t("search.closeTab")} onClick={() => void invoke("search_close_tab", { tab: tab.id, query: tab.query, engine: tab.engine }).catch(showCommandError)}>
                  <IconX size={12} />
                </button>
              )}
            </div>
          ))}
          <button data-tauri-no-drag type="button" className="search-window-tab-new" title={t("search.newTab")} onClick={createTab}>
            <IconPlus size={15} />
          </button>
        </div>
        <form data-tauri-no-drag className="search-window-address" onSubmit={(event) => { event.preventDefault(); search(); }}>
          <div className="search-window-engine-picker" title={t("search.chooseEngine")}>
            <span className={`search-engine-mark search-engine-mark--${engine}`} aria-hidden="true">
              <img
                className="search-engine-logo"
                src={SEARCH_ENGINES.find((item) => item.id === engine)?.logo}
                alt=""
                onError={(event) => {
                  const current = SEARCH_ENGINES.find((item) => item.id === engine);
                  if (!current) return;
                  event.currentTarget.onerror = null;
                  event.currentTarget.src = `https://icons.duckduckgo.com/ip3/${current.fallback}.ico`;
                }}
              />
            </span>
            <select
              data-tauri-no-drag
              value={engine}
              aria-label={t("search.chooseEngine")}
              onChange={(event) => {
                const nextEngine = event.target.value as SearchEngine;
                setEngine(nextEngine);
                localStorage.setItem("mynx-search-engine", nextEngine);
                setTabs((current) => current.map((tab) => tab.id === activeTab ? { ...tab, engine: nextEngine } : tab));
              }}
            >
              {SEARCH_ENGINES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <IconChevronDown size={13} />
          </div>
          <input ref={inputRef} data-tauri-no-drag value={addressValue} onChange={(event) => { setAddressValue(event.target.value); setQuery(event.target.value); }} placeholder={t("search.placeholder")} aria-label={t("search.placeholder")} />
          {addressValue && <button data-tauri-no-drag type="button" title={t("home.clear")} onClick={() => { setAddressValue(""); setQuery(""); }}><IconX size={14} /></button>}
        </form>
        {commandError && <span className="search-window-command-error" role="alert" title={commandError}>{t("search.failed")}</span>}
        <LanguageSwitcher />
        <div className="search-window-window-controls" aria-label={t("search.windowControls")}>
          <button data-tauri-no-drag type="button" title={t("window.minimize")} onClick={() => void appWindow.minimize()}>
            <IconMinus size={15} />
          </button>
          <button data-tauri-no-drag type="button" title={t("window.maximize")} onClick={() => void appWindow.toggleMaximize()}>
            <IconSquare size={14} />
          </button>
          <button data-tauri-no-drag type="button" title={t("window.close")} onClick={() => void appWindow.close()}>
            <IconX size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
