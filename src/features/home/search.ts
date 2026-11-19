export const SEARCH_ENGINES = [
  { id: "google", label: "Google", baseUrl: "https://www.google.com/search?q=" },
  { id: "bing", label: "Bing", baseUrl: "https://www.bing.com/search?q=" },
  { id: "baidu", label: "百度", baseUrl: "https://www.baidu.com/s?wd=" },
  { id: "brave", label: "Brave Search", baseUrl: "https://search.brave.com/search?q=" },
  { id: "perplexity", label: "Perplexity", baseUrl: "https://www.perplexity.ai/search/new?q=" },
  { id: "you", label: "You.com", baseUrl: "https://you.com/search?q=" },
] as const;

export type SearchEngine = (typeof SEARCH_ENGINES)[number]["id"];

export function isSearchEngine(value: string): value is SearchEngine {
  return SEARCH_ENGINES.some((engine) => engine.id === value);
}

/** Build a fixed-provider HTTPS URL; user text is encoded as a query value. */
export function searchUrl(engine: SearchEngine, query: string): string {
  const provider = SEARCH_ENGINES.find((candidate) => candidate.id === engine);
  if (!provider) throw new Error("Unsupported search engine");
  return `${provider.baseUrl}${encodeURIComponent(query)}`;
}
