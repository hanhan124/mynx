import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import App from "./App";
import { ThemeProvider } from "./lib/theme-context";
import { mynxColorSchemeManager, mynxTheme } from "./lib/mantine-theme";
import "@mantine/core/styles.css";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MantineProvider
      theme={mynxTheme}
      colorSchemeManager={mynxColorSchemeManager}
      defaultColorScheme="light"
    >
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </MantineProvider>
  </React.StrictMode>,
);
