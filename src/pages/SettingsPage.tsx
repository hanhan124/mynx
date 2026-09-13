import { useEffect, useState } from "react";
import { IconChevronRight } from "@tabler/icons-react";
import AboutModal from "@/components/AboutModal";
import ThemePicker from "@/components/ThemePicker";
import { loadConfig, saveAlwaysOnTop } from "@/lib/config";
import { useLanguage, type Language } from "@/lib/i18n";
import { useTheme } from "@/hooks/useTheme";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type SettingsSectionId = "appearance" | "language" | "window" | "support";

export default function SettingsPage() {
  const { language, setLanguage, t } = useLanguage();
  const { theme, setTheme } = useTheme();
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("appearance");

  useEffect(() => {
    void loadConfig().then((config) => setAlwaysOnTop(config.alwaysOnTop));
  }, []);

  const setWindowPinned = async (next: boolean) => {
    setAlwaysOnTop(next);
    await saveAlwaysOnTop(next);
    if (!isTauri) return;
    const [{ getCurrentWindow }, { emit }] = await Promise.all([
      import("@tauri-apps/api/window"),
      import("@tauri-apps/api/event"),
    ]);
    await getCurrentWindow().setAlwaysOnTop(next);
    await emit("mynx://always-on-top", next);
  };

  const openHelp = async () => {
    if (!isTauri) return;
    const { emit } = await import("@tauri-apps/api/event");
    await emit("mynx://help");
  };

  const openWebsite = async () => {
    if (!isTauri) return;
    const { open } = await import("@tauri-apps/plugin-shell");
    await open("https://www.fanguanghan.homes");
  };

  const settingsSections = [
    { id: "appearance" as const, label: t("settings.appearance") },
    { id: "language" as const, label: t("settings.language") },
    { id: "window" as const, label: t("settings.window") },
    { id: "support" as const, label: t("settings.support") },
  ];
  const activeItem = settingsSections.find((item) => item.id === activeSection) ?? settingsSections[0];

  return (
    <div className="settings-page page-shell">
      <div className="settings-layout">
        <aside className="settings-nav" aria-label={t("settings.title")}>
          <div className="settings-nav-title">
            <strong>{t("settings.title")}</strong>
          </div>
          <div className="settings-nav-list" role="tablist" aria-orientation="vertical">
            {settingsSections.map((item) => {
              const selected = item.id === activeSection;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`settings-tab-${item.id}`}
                  aria-selected={selected}
                  aria-controls="settings-panel"
                  className={`settings-nav-item${selected ? " is-active" : ""}`}
                  onClick={() => setActiveSection(item.id)}
                >
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <main id="settings-panel" className="settings-detail" role="tabpanel" aria-labelledby={`settings-tab-${activeSection}`}>
          <header className="settings-detail-header">
            <h1>{activeItem.label}</h1>
          </header>

          {activeSection === "appearance" && (
            <section className="settings-panel-section" aria-labelledby="settings-appearance-title">
              <h2 id="settings-appearance-title">{t("theme.title")}</h2>
              <div className="settings-card settings-card--theme">
                <ThemePicker value={theme} onSelect={setTheme} />
              </div>
            </section>
          )}

          {activeSection === "language" && (
            <section className="settings-panel-section" aria-labelledby="settings-language-title">
              <h2 id="settings-language-title">{t("settings.language")}</h2>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t("settings.language")}</strong>
                  </div>
                  <div className="settings-segmented" role="radiogroup" aria-label={t("settings.language")}>
                    {(["zh", "en"] as Language[]).map((item) => (
                      <button
                        key={item}
                        type="button"
                        role="radio"
                        aria-checked={language === item}
                        className={language === item ? "is-active" : ""}
                        onClick={() => setLanguage(item)}
                      >
                        {item === "zh" ? t("settings.language.zh") : t("settings.language.en")}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeSection === "window" && (
            <section className="settings-panel-section" aria-labelledby="settings-window-title">
              <h2 id="settings-window-title">{t("settings.window")}</h2>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{t("settings.alwaysOnTop")}</strong>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={alwaysOnTop}
                    aria-label={t("settings.alwaysOnTop")}
                    className={`settings-switch${alwaysOnTop ? " is-on" : ""}`}
                    onClick={() => void setWindowPinned(!alwaysOnTop)}
                  >
                    <span />
                  </button>
                </div>
              </div>
            </section>
          )}

          {activeSection === "support" && (
            <section className="settings-panel-section" aria-labelledby="settings-support-title">
              <h2 id="settings-support-title">{t("settings.support")}</h2>
              <div className="settings-card">
                <button type="button" className="settings-link-row" onClick={() => void openHelp()}>
                  <span className="settings-row-copy"><strong>{t("settings.help")}</strong></span>
                  <IconChevronRight size={16} stroke={1.75} />
                </button>
                <button type="button" className="settings-link-row" onClick={() => void openWebsite()}>
                  <span className="settings-row-copy"><strong>{t("settings.website")}</strong></span>
                  <IconChevronRight size={16} stroke={1.75} />
                </button>
                <button type="button" className="settings-link-row" onClick={() => setShowAbout(true)}>
                  <span className="settings-row-copy"><strong>{t("settings.about")}</strong></span>
                  <IconChevronRight size={16} stroke={1.75} />
                </button>
              </div>
            </section>
          )}
        </main>
      </div>

      <AboutModal open={showAbout} onClose={() => setShowAbout(false)} />
    </div>
  );
}
