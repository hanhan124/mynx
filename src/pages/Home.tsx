import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CSSProperties } from "react";
import {
  IconArrowBadgeRight,
  IconChevronRight,
  IconExternalLink,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import AppMark from "@/components/AppMark";
import WeatherWidget from "@/components/WeatherWidget";
import { loadAiSearchApiKey, saveAiSearchApiKey } from "@/lib/config";
import { tools } from "@/lib/tools";

// 网页搜索基础地址：固定为可信 https 主机，仅拼接 encodeURIComponent 后的查询，
// 避免用户构造出 localhost / 私有地址等非法 host。
const WEB_SEARCH_BASE = "https://www.bing.com/search?q=";

interface SearchPanelProps {
  query: string;
  url: string;
  onClose: () => void;
}

interface GeminiCitation {
  title: string;
  url: string;
}
interface GeminiSearchResult {
  text: string;
  citations: GeminiCitation[];
}

function renderInlineMarkdown(text: string, keyPrefix: string) {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    if (token.startsWith("**") && token.endsWith("**")) {
      return <strong key={key}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith("`") && token.endsWith("`")) {
      return <code key={key}>{token.slice(1, -1)}</code>;
    }
    const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (link) {
      return (
        <a key={key} href={link[2]} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      );
    }
    return <span key={key}>{token}</span>;
  });
}

function MarkdownAnswer({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: JSX.Element[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; text: string }[] = [];
  let code: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(
        <p key={`p-${blocks.length}`}>
          {renderInlineMarkdown(paragraph.join(" "), `p-${blocks.length}`)}
        </p>,
      );
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      const ordered = list[0].ordered;
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={`list-${blocks.length}`}>
          {list.map((item, index) => (
            <li key={`li-${index}`}>{renderInlineMarkdown(item.text, `li-${index}`)}</li>
          ))}
        </List>,
      );
      list = [];
    }
  };

  lines.forEach((line, index) => {
    if (line.trim().startsWith("```")) {
      flushParagraph();
      flushList();
      if (code.length) {
        blocks.push(
          <pre key={`code-${index}`}>
            <code>{code.join("\n")}</code>
          </pre>,
        );
        code = [];
      } else {
        code = [];
      }
      return;
    }
    if (code.length || (index > 0 && lines[index - 1].trim().startsWith("```"))) {
      code.push(line);
      return;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      return;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const Heading = `h${heading[1].length}` as "h1" | "h2" | "h3";
      blocks.push(
        <Heading key={`h-${index}`}>
          {renderInlineMarkdown(heading[2], `h-${index}`)}
        </Heading>,
      );
      return;
    }
    const item = line.match(/^\s*(?:[-*]|(\d+)\.)\s+(.+)$/);
    if (item) {
      flushParagraph();
      const ordered = Boolean(item[1]);
      if (list.length && list[0].ordered !== ordered) flushList();
      list.push({ ordered, text: item[2] });
      return;
    }
    flushList();
    paragraph.push(line.trim());
  });
  flushParagraph();
  flushList();
  if (code.length)
    blocks.push(
      <pre key="code-final">
        <code>{code.join("\n")}</code>
      </pre>,
    );
  return <div className="home-gemini-markdown">{blocks}</div>;
}

function SearchPanel({ query, url, onClose }: SearchPanelProps) {
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "missing-key">(
    "loading",
  );
  const [result, setResult] = useState<GeminiSearchResult | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function runSearch() {
      setStatus("loading");
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const key = await loadAiSearchApiKey();
        if (!key) {
          if (!cancelled) setStatus("missing-key");
          return;
        }
        const next = await invoke<GeminiSearchResult>("ai_search", {
          apiKey: key,
          query,
        });
        if (cancelled) return;
        setResult(next);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }
    void runSearch();
    return () => {
      cancelled = true;
    };
  }, [query, retryKey]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function openExternally() {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  }

  async function openResult(resultUrl: string) {
    if (!/^https?:\/\//i.test(resultUrl)) return;
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(resultUrl);
  }

  async function saveKeyAndSearch() {
    const key = keyDraft.trim();
    if (key.length < 20) return;
    await saveAiSearchApiKey(key);
    setRetryKey((value) => value + 1);
  }

  return (
    <aside className="home-search-panel" aria-label={`聚合搜索：${query}`}>
      <div className="home-search-panel-bar">
        <div className="home-search-panel-heading">
          <span className="home-search-panel-icon" aria-hidden="true">
            <IconWorld size={15} stroke={1.8} />
          </span>
          <div className="home-search-panel-title-wrap">
            <strong className="home-search-panel-title">聚合搜索</strong>
            <span className="home-search-panel-query" title={query}>
              {query}
            </span>
          </div>
        </div>
        <div className="home-search-panel-actions">
          <button
            type="button"
            onClick={openExternally}
            title="在浏览器中打开"
            aria-label="在浏览器中打开"
          >
            <IconExternalLink size={15} stroke={1.8} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="关闭搜索面板"
            aria-label="关闭搜索面板"
          >
            <IconX size={16} stroke={1.8} />
          </button>
        </div>
      </div>
      <div className="home-search-panel-stage">
        {status === "loading" && (
          <div className="home-search-panel-state" role="status">
            <span className="home-search-panel-spinner" />
            <strong>正在聚合结果</strong>
            <span>正在从网页结果里提炼成 Markdown 摘要</span>
          </div>
        )}
        {status === "missing-key" && (
          <div className="home-search-panel-state home-search-panel-key-state">
            <IconWorld size={26} stroke={1.5} />
            <strong>先配置 AI 搜索 Key</strong>
            <span>推荐使用 OpenRouter 免费模型，Key 只保存在本机。</span>
            <input
              className="home-search-key-input"
              type="password"
              value={keyDraft}
              onChange={(event) => setKeyDraft(event.target.value)}
              placeholder="粘贴 OpenRouter API Key"
              aria-label="OpenRouter API Key"
            />
            <button
              type="button"
              className="home-search-panel-fallback"
              onClick={saveKeyAndSearch}
            >
              保存并搜索
            </button>
          </div>
        )}
        {status === "error" && (
          <div className="home-search-panel-state">
            <IconWorld size={26} stroke={1.5} />
            <strong>暂时无法获取搜索结果</strong>
            <span>请检查网络连接后重试，或在浏览器中继续搜索。</span>
            <button
              type="button"
              className="home-search-panel-fallback"
              onClick={() => setRetryKey((key) => key + 1)}
            >
              重新搜索
            </button>
          </div>
        )}
        {status === "ready" && !result?.text && (
          <div className="home-search-panel-state">
            <IconWorld size={26} stroke={1.5} />
            <strong>没有找到相关网页</strong>
            <span>可以换一个更简短的关键词再试。</span>
          </div>
        )}
        {status === "ready" && result?.text && (
          <div className="home-gemini-result">
            <MarkdownAnswer markdown={result.text} />
            {result.citations.length > 0 && (
              <div className="home-gemini-sources">
                <span className="home-gemini-sources-title">来源</span>
                {result.citations.map((citation) => (
                  <button
                    type="button"
                    className="home-gemini-source"
                    key={citation.url}
                    onClick={() => openResult(citation.url)}
                  >
                    <span>{citation.title}</span>
                    <IconChevronRight size={16} stroke={1.7} />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [webSearch, setWebSearch] = useState<{ query: string; url: string } | null>(null);

  const kw = query.trim().toLowerCase();
  const filtered =
    kw
      ? tools.filter(
          (t) =>
            t.title.toLowerCase().includes(kw) ||
            t.description.toLowerCase().includes(kw),
        )
      : tools;

  function openSearch() {
    const q = query.trim();
    if (!q) return;
    const url = WEB_SEARCH_BASE + encodeURIComponent(q);
    setWebSearch({ query: q, url });
  }

  return (
    <div className={`home-shell${webSearch ? " has-search-panel" : ""}`}>
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
              placeholder="搜索工具，或直接输入问题"
              aria-label="搜索工具或输入问题"
            />
            {query && (
              <button
                type="button"
                className="home-search-clear"
                onClick={() => setQuery("")}
                aria-label="清除"
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
              <span className="home-tools-unit">个工具</span>
            </div>
            {kw && <span className="home-tools-hint">与「{query.trim()}」相关</span>}
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
                        {tool.title}
                        {tool.badge && <em className="tool-card-badge">{tool.badge}</em>}
                      </span>
                      <span className="tool-card-desc">{tool.description}</span>
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
              <div className="home-tools-empty">暂无匹配「{query}」的工具</div>
            )}
          </div>
        </section>

        {webSearch && (
          <SearchPanel
            query={webSearch.query}
            url={webSearch.url}
            onClose={() => setWebSearch(null)}
          />
        )}
      </div>

      <footer className="home-footer">
        <a
          className="home-footer-link"
          href="https://github.com/hanhan124/mynx"
          target="_blank"
          rel="noreferrer"
        >
          Mynx · MIT License
        </a>
      </footer>
    </div>
  );
}
