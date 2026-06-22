import { useNavigate, useLocation } from "react-router-dom";
import { useTheme } from "../hooks/useTheme";

interface NavItem {
  icon: string;
  label: string;
  path: string;
}

const navItems: NavItem[] = [
  { icon: "🏠", label: "主页", path: "/" },
  { icon: "🧬", label: "qPCR", path: "/qpcr" },
  { icon: "🖼️", label: "TIFF", path: "/tiff" },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="sidebar">
      <div className="sidebar-top">
        <div className="sidebar-logo">
          <svg width="32" height="32" viewBox="0 0 32 32">
            <defs>
              <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#8AB4F8" />
                <stop offset="100%" stopColor="#81C995" />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="8" fill="url(#logoGrad)" />
            <text
              x="16"
              y="22"
              textAnchor="middle"
              fill="white"
              fontSize="16"
              fontWeight="bold"
              fontFamily="Segoe UI, system-ui, sans-serif"
            >
              M
            </text>
          </svg>
        </div>
      </div>

      <div className="sidebar-nav">
        {navItems.map((item) => {
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              className={`sidebar-nav-item ${active ? "sidebar-nav-item--active" : ""}`}
              onClick={() => navigate(item.path)}
              title={item.label}
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              <span className="sidebar-nav-label">{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="sidebar-bottom">
        <button className="sidebar-bottom-btn" title="Website">
          <span>🌐</span>
        </button>
        <button className="sidebar-bottom-btn" title="Theme" onClick={toggleTheme}>
          <span>{theme === "dark" ? "☀️" : "🌙"}</span>
        </button>
        <button className="sidebar-bottom-btn" title="About">
          <span>ℹ️</span>
        </button>
      </div>
    </div>
  );
}
