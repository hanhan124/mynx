import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTheme } from "../hooks/useTheme";
import Modal from "./Modal";
import { showToast } from "./Toast";
import {
  Home,
  FlaskConical,
  Image,
  Globe,
  Sun,
  Moon,
  Info,
} from "lucide-react";

const navItems = [
  { icon: Home, label: "主页", path: "/" },
  { icon: FlaskConical, label: "qPCR", path: "/qpcr" },
  { icon: Image, label: "TIFF", path: "/tiff" },
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
          <img
            src="/ref/icon.svg"
            alt="Mynx"
            width={32}
            height={32}
            style={{ borderRadius: 8 }}
            onError={(e) => {
              // Fallback: inline SVG from ref
              const img = e.currentTarget;
              img.style.display = "none";
              const fallback = document.createElement("div");
              fallback.innerHTML = `<svg width="32" height="32" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><rect width="1024" height="1024" rx="180" fill="#E8EFF8"/><path d="M141.64 405.64A23.27 23.27 0 0 0 160.81 442.18h350.49a23.27 23.27 0 0 0 18.46-37.47L364.68 190.16a46.55 46.55 0 0 0-75.17 1.89l-147.87 213.6z" fill="#69CB91"/><path d="M337.45 849.45a174.55 174.55 0 1 0 0-349.09 174.55 174.55 0 0 0 0 349.09z" fill="#247ADE"/><path d="M907.64 186.18a23.27 23.27 0 0 0-23.27-23.27h-209.45a23.27 23.27 0 0 0-23.27 23.27v674.91a23.27 23.27 0 0 0 23.27 23.27h209.45a23.27 23.27 0 0 0 23.27-23.27V186.18z" fill="#A0BFF7"/></svg>`;
              img.parentNode?.insertBefore(fallback.firstElementChild!, img);
            }}
          />
        </div>
      </div>

      <div className="sidebar-nav">
        {navItems.map((item) => {
          const active = location.pathname === item.path;
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              className={`sidebar-nav-item ${active ? "sidebar-nav-item--active" : ""}`}
              onClick={() => navigate(item.path)}
              title={item.label}
            >
              <span className="sidebar-nav-icon">
                <Icon size={18} strokeWidth={1.8} />
              </span>
              <span className="sidebar-nav-label">{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="sidebar-bottom">
        <button className="sidebar-bottom-btn" title="Website">
          <Globe size={16} strokeWidth={1.8} />
        </button>
        <button className="sidebar-bottom-btn" title="Theme" onClick={toggleTheme}>
          {theme === "dark" ? <Sun size={16} strokeWidth={1.8} /> : <Moon size={16} strokeWidth={1.8} />}
        </button>
        <button className="sidebar-bottom-btn" title="About" onClick={() => setShowAbout(true)}>
          <Info size={16} strokeWidth={1.8} />
        </button>
      </div>

      <Modal open={showAbout} onClose={() => setShowAbout(false)}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, minWidth: 220 }}>
          <img
            src="/ref/icon.svg"
            alt="Mynx"
            width={52}
            height={52}
            style={{ borderRadius: 12 }}
            onError={(e) => {
              const img = e.currentTarget;
              img.style.display = "none";
              const fallback = document.createElement("div");
              fallback.innerHTML = `<svg width="52" height="52" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><rect width="1024" height="1024" rx="180" fill="#E8EFF8"/><path d="M141.64 405.64A23.27 23.27 0 0 0 160.81 442.18h350.49a23.27 23.27 0 0 0 18.46-37.47L364.68 190.16a46.55 46.55 0 0 0-75.17 1.89l-147.87 213.6z" fill="#69CB91"/><path d="M337.45 849.45a174.55 174.55 0 1 0 0-349.09 174.55 174.55 0 0 0 0 349.09z" fill="#247ADE"/><path d="M907.64 186.18a23.27 23.27 0 0 0-23.27-23.27h-209.45a23.27 23.27 0 0 0-23.27 23.27v674.91a23.27 23.27 0 0 0 23.27 23.27h209.45a23.27 23.27 0 0 0 23.27-23.27V186.18z" fill="#A0BFF7"/></svg>`;
              img.parentNode?.insertBefore(fallback.firstElementChild!, img);
            }}
          />
          <div style={{ fontSize: 16, fontWeight: "bold" }}>Mynx</div>
          <div style={{ fontSize: 13, opacity: 0.6 }}>v1.0.0</div>
          <div style={{ fontSize: 13, opacity: 0.6 }}>效率工具集</div>
          <div style={{ fontSize: 13, opacity: 0.6 }}>作者: Fang Guanghan</div>
          <button className="btn btn-accent" style={{ marginTop: 8, width: "100%" }} onClick={() => showToast("当前已是最新版本", "success")}>
            检查更新
          </button>
        </div>
      </Modal>
    </div>
  );
}
