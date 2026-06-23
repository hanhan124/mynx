import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { check } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { useTheme } from "@/hooks/useTheme";
import Modal from "@/components/Modal";
import ThemePicker from "@/components/ThemePicker";
import AppMark from "@/components/AppMark";
import { showToast } from "@/components/Toast";
import {
  Home,
  FlaskConical,
  Image,
  Globe,
  Palette,
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
      const update = await check();
      if (update) {
        showToast(`发现新版本: ${update.version}`, "info");
      } else {
        showToast("当前已是最新版本", "success");
      }
    } catch {
      showToast("检查更新失败（请配置更新端点）", "info");
    } finally {
      setCheckingUpdate(false);
    }
  };

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
          选择界面配色风格
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
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <AppMark size={48} />
        </div>
        <div className="about-info">
          <div className="about-row">
            <span>版本</span>
            <span>v{appVersion}</span>
          </div>
          <div className="about-row">
            <span>作者</span>
            <span>Fang Guanghan</span>
          </div>
        </div>
        <button
          className="btn btn-primary about-check"
          onClick={handleCheckUpdate}
          disabled={checkingUpdate}
        >
          {checkingUpdate ? "检查中..." : "检查更新"}
        </button>
      </Modal>
    </>
  );
}
