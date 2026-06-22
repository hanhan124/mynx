import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTheme } from "../hooks/useTheme";
import Modal from "./Modal";

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
  const [showAbout, setShowAbout] = useState(false);

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
        <button className="sidebar-bottom-btn" title="About" onClick={() => setShowAbout(true)}>
          <span>ℹ️</span>
        </button>
      </div>

      <Modal open={showAbout} onClose={() => setShowAbout(false)}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, minWidth: 220 }}>
          <svg width="52" height="52" viewBox="0 0 52 52">
            <defs>
              <linearGradient id="aboutGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#8AB4F8" />
                <stop offset="100%" stopColor="#81C995" />
              </linearGradient>
            </defs>
            <rect width="52" height="52" rx="12" fill="url(#aboutGrad)" />
            <text x="26" y="36" textAnchor="middle" fill="white" fontSize="26" fontWeight="bold" fontFamily="Segoe UI, system-ui, sans-serif">M</text>
          </svg>
          <div style={{ fontSize: 16, fontWeight: "bold" }}>Mynx</div>
          <div style={{ fontSize: 13, opacity: 0.6 }}>v1.0.0</div>
          <div style={{ fontSize: 13, opacity: 0.6 }}>效率工具集</div>
          <div style={{ fontSize: 13, opacity: 0.6 }}>作者: Fang Guanghan</div>
          <button className="btn btn-accent" style={{ marginTop: 8, width: "100%" }} onClick={() => alert("当前已是最新版本")}>
            检查更新
          </button>
        </div>
      </Modal>
    </div>
  );
}
