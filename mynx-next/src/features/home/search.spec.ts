import { describe, expect, it } from "vitest";
import { isSearchEngine, searchUrl } from "./search.js";

describe("home browser search", () => {
  it("builds an HTTPS search URL and safely encodes the query", () => {
    expect(searchUrl("bing", "RNA seq & qPCR")).toBe(
      "https://www.bing.com/search?q=RNA%20seq%20%26%20qPCR",
    );
    expect(searchUrl("baidu", "差异表达 基因")).toBe(
      "https://www.baidu.com/s?wd=%E5%B7%AE%E5%BC%82%E8%A1%A8%E8%BE%BE%20%E5%9F%BA%E5%9B%A0",
    );
  });

  it("accepts only the supported provider IDs", () => {
    expect(isSearchEngine("google")).toBe(true);
    expect(isSearchEngine("file")).toBe(false);
  });
});
