import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { check } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { useTheme } from "@/hooks/useTheme";
import Modal from "@/components/Modal";
import ThemePicker from "@/components/ThemePicker";
import AppMark from "@/components/AppMark";
import { showToast } from "@/components/Toast";
import { Home, Globe, Palette, Info } from "lucide-react";
import { tools } from "@/lib/tools";

const navItems = [
  { icon: Home, label: "主页", path: "/" },
  ...tools
    .filter((t) => t.showInSidebar)
    .map((t) => ({ icon: t.icon, label: t.navLabel, path: t.path })),
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const [showAbout, setShowAbout] = useState(false);
  const [showThemes, setShowThemes] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [appVersion, setAppVersion] = useState("...");

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("?"));
  }, []);

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const portable = await invoke<boolean>("is_portable").catch(() => false);
      if (portable) {
        const resp = await fetch("https://github.com/hanhan124/mynx/releases/latest/download/latest.json");
        if (resp.ok) {
          const latest: { version: string } = await resp.json();
          const current = await getVersion();
          if (latest.version.replace(/^v/, "") !== current.replace(/^v/, "") && compareVersions(latest.version, current) > 0) {
            showToast(`发现新版本: v${latest.version}，请在右下角通知中更新`, "info");
          } else {
            showToast("当前已是最新版本", "success");
          }
        } else {
          showToast("检查更新失败", "info");
        }
      } else {
        const update = await check();
        if (update) {
          showToast(`发现新版本: ${update.version}`, "info");
        } else {
          showToast("当前已是最新版本", "success");
        }
      }
    } catch {
      showToast("检查更新失败", "info");
    } finally {
      setCheckingUpdate(false);
    }
  };

  function compareVersions(a: string, b: string): number {
    const aParts = a.replace(/^v/, '').split('.').map(Number);
    const bParts = b.replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aPart = aParts[i] || 0;
      const bPart = bParts[i] || 0;
      if (aPart > bPart) return 1;
      if (aPart < bPart) return -1;
    }
    return 0;
  }

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
                title={item.label}
              >
                <Icon size={16} strokeWidth={1.8} />
              </button>
            );
          })}
        </div>

        <div className="sidebar-footer">
          <button
            className="sidebar-btn"
            title="网站"
            onClick={() => {
              import("@tauri-apps/plugin-shell").then(({ open }) =>
                open("https://www.fanguanghan.homes")
              );
            }}
          >
            <Globe size={15} strokeWidth={1.6} />
          </button>
          <button
            className="sidebar-btn"
            title="主题"
            onClick={() => setShowThemes(true)}
          >
            <Palette size={15} strokeWidth={1.6} />
          </button>
          <button
            className="sidebar-btn"
            title="关于"
            onClick={() => setShowAbout(true)}
          >
            <Info size={15} strokeWidth={1.6} />
          </button>
        </div>
      </div>

      <Modal open={showThemes} onClose={() => setShowThemes(false)} title="主题设置">
        <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
          选择配色风格
        </div>
        <ThemePicker
          value={theme}
          onSelect={(next) => {
            setTheme(next);
            setShowThemes(false);
          }}
        />
      </Modal>

      <Modal open={showAbout} onClose={() => setShowAbout(false)} title="关于">
        <div className="about-header">
          <AppMark size={48} />
          <div className="about-header-text">
            <div className="about-app-name">Mynx</div>
            <div className="about-app-desc">让工作更简单</div>
          </div>
        </div>

        <div className="about-info">
          <div className="about-row">
            <span>版本</span>
            <span>v{appVersion}</span>
          </div>
          <div className="about-row">
            <span>作者</span>
            <span>Han</span>
          </div>
          <div className="about-row">
            <span>技术栈</span>
            <span>Tauri · React · Rust</span>
          </div>
        </div>

        <div className="about-links">
          <button
            className="btn btn-full"
            onClick={() => {
              import("@tauri-apps/plugin-shell").then(({ open }) =>
                open("https://github.com/hanhan124/mynx")
              );
            }}
          >
            <Globe size={14} strokeWidth={1.8} />
            GitHub
          </button>
        </div>

        <button
          className="btn btn-primary about-check"
          onClick={handleCheckUpdate}
          disabled={checkingUpdate}
        >
          {checkingUpdate ? "检查中..." : "检查更新"}
        </button>

        <div className="about-copyright">
          © 2026 Han · MIT License
        </div>
      </Modal>
    </>
  );
}
