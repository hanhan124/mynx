// Use the browser's favicon service instead of fetching each site's root favicon
// directly. Some sites redirect, reject the request, or expose an outdated path.
const favicon = (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

export const SEARCH_ENGINES = [
  { id: "google", label: "Google", logo: favicon("google.com"), fallback: "google.com" },
  { id: "bing", label: "Bing", logo: favicon("bing.com"), fallback: "bing.com" },
  { id: "baidu", label: "百度", logo: favicon("baidu.com"), fallback: "baidu.com" },
  { id: "brave", label: "Brave Search", logo: favicon("search.brave.com"), fallback: "search.brave.com" },
  { id: "perplexity", label: "Perplexity", logo: favicon("perplexity.ai"), fallback: "perplexity.ai" },
  { id: "you", label: "You.com", logo: favicon("you.com"), fallback: "you.com" },
] as const;

export type SearchEngine = (typeof SEARCH_ENGINES)[number]["id"];

export function isSearchEngine(value: string | null): value is SearchEngine {
  return SEARCH_ENGINES.some(({ id }) => id === value);
}
