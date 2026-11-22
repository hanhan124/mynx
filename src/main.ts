import { mount } from "svelte";
import "katex/dist/katex.min.css";
import "./styles/app.css";
import App from "./components/App.svelte";
import { applyWindowMaterial } from "./app/window-material";
import { installPopupMenus } from "./lib/popup-menu";

applyWindowMaterial();
installPopupMenus();

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;
