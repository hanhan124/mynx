import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTheme } from "@/hooks/useTheme";
import Modal from "@/components/Modal";
import ThemePicker from "@/components/ThemePicker";
import AboutModal from "@/components/AboutModal";
import { IconHomeFilled, IconWorldFilled, IconPaletteFilled, IconInfoCircleFilled } from "@tabler/icons-react";
import { tools } from "@/lib/tools";
import { useLanguage, getToolTranslationKey } from "@/lib/i18n";

const navItems = [
  { icon: IconHomeFilled, label: "主页", path: "/", badge: undefined },
  ...tools
    .filter((t) => t.showInSidebar)
    .map((t) => ({ icon: t.icon, label: t.navLabel, path: t.path, badge: t.badge })),
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const { t } = useLanguage();
  const [showAbout, setShowAbout] = useState(false);
  const [showThemes, setShowThemes] = useState(false);

  return (
    <>
      <div className="sidebar">
        <div className="sidebar-nav">
          {navItems.map((item) => {
            const active = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                className={`sidebar-btn ${active ? "sidebar-btn--active" : ""}`}
                onClick={() => navigate(item.path)}
                title={item.badge
                  ? `${t(getToolTranslationKey(item.path, "title"))}（${t("nav.beta")}）`
                  : (item.path === "/" ? t("nav.home") : t(getToolTranslationKey(item.path, "title")))}
              >
                <Icon size={16} stroke={2} />
                {item.badge && <span className="sidebar-btn-dot" aria-label={t("nav.beta")} />}
              </button>
            );
          })}
        </div>

        <div className="sidebar-footer">
          <button
            className="sidebar-btn"
            title={t("nav.website")}
            onClick={() => {
              import("@tauri-apps/plugin-shell").then(({ open }) =>
                open("https://www.fanguanghan.homes"),
              );
            }}
          >
            <IconWorldFilled size={16} stroke={2} />
          </button>
          <button
            className="sidebar-btn"
            title={t("nav.theme")}
            onClick={() => setShowThemes(true)}
          >
            <IconPaletteFilled size={16} stroke={2} />
          </button>
          <button
            className="sidebar-btn"
            title={t("nav.about")}
            onClick={() => setShowAbout(true)}
          >
            <IconInfoCircleFilled size={16} stroke={2} />
          </button>
        </div>
      </div>

      <Modal
        open={showThemes}
        onClose={() => setShowThemes(false)}
        title={t("theme.title")}
      >
        <div
          style={{
            marginBottom: 12,
            fontSize: 12,
            color: "var(--text-secondary)",
          }}
        >
          {t("theme.choose")}
        </div>
        <ThemePicker
          value={theme}
          onSelect={(next) => {
            setTheme(next);
            setShowThemes(false);
          }}
        />
      </Modal>

      <AboutModal
        open={showAbout}
        onClose={() => setShowAbout(false)}
      />
    </>
  );
}
