// Svelte 5 + Vite plugin options. No preprocessor needed (TS in Svelte is
// handled by vitePluginSvelte; vitePreprocess is only required for
// PostCSS-in-markup which Tailwind 4 handles at the vite layer).
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
};
