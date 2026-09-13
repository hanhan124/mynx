import { useNavigate, useLocation } from "react-router-dom";
import { IconHomeFilled, IconSettings } from "@tabler/icons-react";
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
  const { t } = useLanguage();

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
            className={`sidebar-btn ${location.pathname === "/settings" ? "sidebar-btn--active" : ""}`}
            title={t("nav.settings")}
            aria-label={t("nav.settings")}
            aria-current={location.pathname === "/settings" ? "page" : undefined}
            onClick={() => navigate("/settings")}
          >
            <IconSettings size={17} stroke={2} />
          </button>
        </div>
      </div>
    </>
  );
}
