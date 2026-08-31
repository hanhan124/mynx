import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CSSProperties } from "react";
import { IconArrowBadgeRight, IconSearch, IconX, IconChevronDown } from "@tabler/icons-react";
import AppMark from "@/components/AppMark";
import WeatherWidget from "@/components/WeatherWidget";
import { tools } from "@/lib/tools";
import { invoke } from "@tauri-apps/api/core";
import { isSearchEngine, SEARCH_ENGINES, type SearchEngine } from "@/lib/search-engines";
import { getToolTranslationKey, useLanguage } from "@/lib/i18n";

export default function Home() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [searchEngine, setSearchEngine] = useState<SearchEngine>(() => {
    const saved = localStorage.getItem("mynx-search-engine");
    return isSearchEngine(saved) ? saved : "bing";
  });
  const [engineMenuOpen, setEngineMenuOpen] = useState(false);
  const enginePickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (!enginePickerRef.current?.contains(event.target as Node)) setEngineMenuOpen(false);
    };
    document.addEventListener("mousedown", closeMenu);
    return () => document.removeEventListener("mousedown", closeMenu);
  }, []);

  const kw = query.trim().toLowerCase();
  const filtered =
    kw
      ? tools.filter(
          (tool) =>
            t(getToolTranslationKey(tool.path, "title")).toLowerCase().includes(kw) ||
            t(getToolTranslationKey(tool.path, "description")).toLowerCase().includes(kw),
        )
      : tools;

  function openSearch() {
    const q = query.trim();
    if (!q) return;
    void invoke("open_search_window", { query: q, engine: searchEngine, tab: null });
  }

  return (
    <div className="home-shell">
      <div className="home-head">
        <header className="home-top">
          <div className="home-brand">
            <AppMark size={44} className="home-logo" />
            <div className="home-brand-copy">
              <span className="home-brand-name">Mynx</span>
            </div>
          </div>
          <WeatherWidget />
        </header>

        <form
          className="home-search"
          onSubmit={(event) => {
            event.preventDefault();
            openSearch();
          }}
        >
          <div className="home-search-box">
            <div ref={enginePickerRef} className="home-search-engine-picker">
              <button
                type="button"
                className="home-search-engine-trigger"
                onClick={() => setEngineMenuOpen((open) => !open)}
                aria-label={t("home.chooseEngine")}
                aria-expanded={engineMenuOpen}
                title={t("home.chooseEngine")}
              >
              <IconSearch size={18} stroke={1.8} aria-hidden="true" />
              <IconChevronDown className="home-search-engine-chevron" size={12} stroke={2} aria-hidden="true" />
              </button>
              {engineMenuOpen && (
                <div className="home-search-engine-menu" role="menu">
                  <div className="home-search-engine-menu-title">{t("home.chooseEngine")}</div>
                  {SEARCH_ENGINES.map((engine) => (
                    <button
                      key={engine.id}
                      type="button"
                      className={searchEngine === engine.id ? "is-active" : ""}
                      title={engine.label}
                      aria-label={engine.label}
                      onClick={() => {
                        setSearchEngine(engine.id);
                        localStorage.setItem("mynx-search-engine", engine.id);
                        setEngineMenuOpen(false);
                      }}
                      role="menuitemradio"
                      aria-checked={searchEngine === engine.id}
                    >
                      <img
                        className="search-engine-logo"
                        src={engine.logo}
                        alt=""
                        aria-hidden="true"
                        onError={(event) => {
                          event.currentTarget.onerror = null;
                          event.currentTarget.src = `https://icons.duckduckgo.com/ip3/${engine.fallback}.ico`;
                        }}
                      />
                      {searchEngine === engine.id && <span className="home-search-engine-check">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              className="home-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  openSearch();
                }
              }}
              placeholder={t("home.searchPlaceholder")}
              aria-label={t("home.searchAria")}
            />
            {query && (
              <button
                type="button"
                className="home-search-clear"
                onClick={() => setQuery("")}
                aria-label={t("home.clear")}
              >
                <IconX size={14} stroke={1.75} />
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="home-divider" />

      <div className="home-workspace">
        <section className="home-tools">
          <div className="home-tools-head">
            <div>
              <span className="home-tools-count">{filtered.length}</span>
              <span className="home-tools-unit">{t("home.tools")}</span>
            </div>
            {kw && <span className="home-tools-hint">{t("home.related", { query: query.trim() })}</span>}
          </div>
          <div className="tool-grid">
            {filtered.length > 0 ? (
              filtered.map((tool) => {
                const Icon = tool.icon;
                return (
                  <button
                    key={tool.path}
                    className="tool-card"
                    style={{ "--tile-accent": tool.accent } as CSSProperties}
                    onClick={() => navigate(tool.path)}
                  >
                    <div className="tool-card-icon">
                      <Icon size={20} color="white" stroke={1.75} />
                    </div>
                    <div className="tool-card-body">
                      <span className="tool-card-title">
                        {t(getToolTranslationKey(tool.path, "title"))}
                        {tool.badge && <em className="tool-card-badge">{t("tool.beta")}</em>}
                      </span>
                      <span className="tool-card-desc">{t(getToolTranslationKey(tool.path, "description"))}</span>
                    </div>
                    <IconArrowBadgeRight
                      size={16}
                      stroke={1.75}
                      className="tool-card-arrow"
                    />
                  </button>
                );
              })
            ) : (
              <div className="home-tools-empty">{t("home.noMatch", { query })}</div>
            )}
          </div>
        </section>

      </div>

      <footer className="home-footer">
        <a
          className="home-footer-link"
          href="https://github.com/hanhan124/mynx"
          target="_blank"
          rel="noreferrer"
        >
          {t("home.license")}
        </a>
      </footer>
    </div>
  );
}
