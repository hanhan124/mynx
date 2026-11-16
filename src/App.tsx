import { Suspense, useEffect, useState } from "react";
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { AppShell, Button, Group, Stack, Text } from "@mantine/core";
import { listen } from "@tauri-apps/api/event";
import TitleBar from "@/components/TitleBar";
import Modal from "@/components/Modal";
import AboutModal from "@/components/AboutModal";
import Sidebar from "@/components/Sidebar";
import Home from "@/pages/Home";
import SettingsPage from "@/pages/SettingsPage";
import ToastContainer from "@/components/Toast";
import UpdateNotification from "@/components/UpdateNotification";
import UiShowcasePage from "@/pages/UiShowcasePage";
import { tools, getPageTitle } from "@/lib/tools";
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
      : location.pathname === "/ui-showcase"
        ? t("uiShowcase.title")
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

  if (location.pathname === "/search-window") return <Navigate to="/" replace />;

  return (
    <div className="app-layout">
      <TitleBar title={title} />
      <AppShell
        className="mynx-app-shell"
        header={{ height: 38 }}
        navbar={{ width: 56, breakpoint: "0px" }}
        padding={0}
        withBorder={false}
      >
        <AppShell.Header className="mynx-app-header">
          <Group h="100%" justify="space-between" px="md" gap="sm">
            <Group gap="xs" wrap="nowrap">
              <Text size="sm" fw={650} c="var(--text-primary)" truncate>
                {title}
              </Text>
              <Text className="mynx-app-header-context" size="xs" c="dimmed">
                {t("app.name")}
              </Text>
            </Group>
            <Text size="xs" c="dimmed" className="mynx-app-header-status">
              {t("app.ready")}
            </Text>
          </Group>
        </AppShell.Header>
        <AppShell.Navbar className="mynx-app-navbar">
          <Sidebar />
        </AppShell.Navbar>
        <AppShell.Main className="app-main">
          <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{title}</div>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/ui-showcase" element={<UiShowcasePage />} />
            <Route path="/tiff" element={<Navigate to="/image" replace />} />
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
        </AppShell.Main>
      </AppShell>
      <ToastContainer />
      <UpdateNotification />
      <AboutModal open={showAbout} onClose={() => setShowAbout(false)} />
      <Modal open={showHelp} onClose={() => setShowHelp(false)} title={t("help.center.title")}>
        <Stack gap="md">
          <Text c="dimmed" size="sm">{t("help.center.intro")}</Text>
          <Group className="help-center-actions" gap="sm">
          {tools.map((tool) => (
            <Button
              key={tool.path}
              variant="light"
              justify="flex-start"
              fullWidth
              onClick={() => {
                setShowHelp(false);
                navigate(tool.path);
              }}
            >
              {t(getToolTranslationKey(tool.path, "title"))}
            </Button>
          ))}
          </Group>
          <Text c="dimmed" size="xs">{t("help.center.note")}</Text>
        </Stack>
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
