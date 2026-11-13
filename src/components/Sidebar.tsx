import { useNavigate, useLocation } from "react-router-dom";
import { Tooltip, UnstyledButton } from "@mantine/core";
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
              <Tooltip
                key={item.path}
                label={item.badge
                  ? `${t(getToolTranslationKey(item.path, "title"))}（${t("nav.beta")}）`
                  : (item.path === "/" ? t("nav.home") : t(getToolTranslationKey(item.path, "title")))}
                position="right"
                withArrow
              >
                <UnstyledButton
                  className={`sidebar-btn ${active ? "sidebar-btn--active" : ""}`}
                  onClick={() => navigate(item.path)}
                  aria-label={item.path === "/" ? t("nav.home") : t(getToolTranslationKey(item.path, "title"))}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon size={18} stroke={2} />
                  {item.badge && <span className="sidebar-btn-dot" aria-label={t("nav.beta")} />}
                </UnstyledButton>
              </Tooltip>
            );
          })}
        </div>

        <div className="sidebar-footer">
          <Tooltip label={t("nav.settings")} position="right" withArrow>
            <UnstyledButton
            className={`sidebar-btn ${location.pathname === "/settings" ? "sidebar-btn--active" : ""}`}
            aria-label={t("nav.settings")}
            aria-current={location.pathname === "/settings" ? "page" : undefined}
            onClick={() => navigate("/settings")}
          >
            <IconSettings size={17} stroke={2} />
            </UnstyledButton>
          </Tooltip>
        </div>
      </div>
    </>
  );
}
