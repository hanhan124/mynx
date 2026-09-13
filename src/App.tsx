import { Suspense, useEffect, useState } from "react";
import { HashRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import TitleBar from "@/components/TitleBar";
import Modal from "@/components/Modal";
import AboutModal from "@/components/AboutModal";
import Sidebar from "@/components/Sidebar";
import Home from "@/pages/Home";
import SettingsPage from "@/pages/SettingsPage";
import ToastContainer from "@/components/Toast";
import UpdateNotification from "@/components/UpdateNotification";
import { tools, getPageTitle } from "@/lib/tools";
import SearchWindow from "@/pages/SearchWindow";
import { LanguageProvider, getToolTranslationKey, useLanguage } from "@/lib/i18n";
import { useAccessibilityPreferences } from "@/hooks/useAccessibilityPreferences";

function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, language, setLanguage } = useLanguage();
  const [showHelp, setShowHelp] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const title =
    location.pathname === "/"
      ? "Mynx"
      : location.pathname === "/settings"
        ? t("settings.title")
      : t(getToolTranslationKey(location.pathname, "title")) ||
        getPageTitle(location.pathname);

  useAccessibilityPreferences();

  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<string>("mynx://navigate", ({ payload }) => navigate(payload))
      .then((stop) => { unlisten = stop; })
      .catch(() => undefined);
    return () => unlisten?.();
  }, [navigate]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("mynx://toggle-language", () => {
      setLanguage(language === "zh" ? "en" : "zh");
    }).then((stop) => { unlisten = stop; }).catch(() => undefined);
    return () => unlisten?.();
  }, [language, setLanguage]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("mynx://help", () => setShowHelp(true))
      .then((stop) => { unlisten = stop; })
      .catch(() => undefined);
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("mynx://about", () => setShowAbout(true))
      .then((stop) => { unlisten = stop; })
      .catch(() => undefined);
    return () => unlisten?.();
  }, []);

  if (location.pathname === "/search-window") return <SearchWindow />;

  return (
    <div className="app-layout">
      <TitleBar title={title} />
      <div className="app-body">
        <Sidebar />
        <main className="app-main">
          <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{title}</div>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/search-window" element={<SearchWindow />} />
            {tools.map((tool) => (
              <Route
                key={tool.path}
                path={tool.path}
                element={
                  <Suspense fallback={null}>
                    <tool.component />
                  </Suspense>
                }
              />
            ))}
          </Routes>
        </main>
      </div>
      <ToastContainer />
      <UpdateNotification />
      <AboutModal open={showAbout} onClose={() => setShowAbout(false)} />
      <Modal open={showHelp} onClose={() => setShowHelp(false)} title={t("help.center.title")}>
        <p className="help-center-intro">{t("help.center.intro")}</p>
        <div className="help-center-actions">
          {tools.map((tool) => (
            <button
              key={tool.path}
              className="btn"
              onClick={() => {
                setShowHelp(false);
                navigate(tool.path);
              }}
            >
              {t(getToolTranslationKey(tool.path, "title"))}
            </button>
          ))}
        </div>
        <p className="help-center-note">{t("help.center.note")}</p>
      </Modal>
    </div>
  );
}

function App() {
  return (
    <HashRouter>
      <LanguageProvider>
        <Layout />
      </LanguageProvider>
    </HashRouter>
  );
}

export default App;
