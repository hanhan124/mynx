import { useState, useEffect } from "react";
import { Logo } from "../components/Logo";
import { api, InstallContext } from "../lib/ipc";

interface Props {
  onNext: (data: {
    path: string;
    options: { desktop: boolean; startMenu: boolean; launchAfter: boolean };
  }) => void;
  onCancel: () => void;
}

export const Welcome: React.FC<Props> = ({ onNext, onCancel }) => {
  const [ctx, setCtx] = useState<InstallContext | null>(null);
  const [path, setPath] = useState("");
  const [desktop, setDesktop] = useState(true);
  const [startMenu, setStartMenu] = useState(true);
  const [launchAfter, setLaunchAfter] = useState(false);

  useEffect(() => {
    api.getContext().then((c) => {
      setCtx(c);
      setPath(c.default_install_path);
    });
  }, []);

  const browseFolder = async () => {
    const chosen = await api.pickInstallDir();
    if (chosen) setPath(chosen);
  };

  const canInstall = path.trim().length > 0;

  return (
    <>
      {/* === 顶部图标 + 标题(居中) === */}
      <div className="hero">
        <Logo size={64} />
        <div className="hero__title">Mynx</div>
        <div className="hero__subtitle">
          版本 {ctx?.app_version ?? "..."} · {ctx?.publisher ?? ""}
        </div>
      </div>

      {/* === 安装位置 + 选项 === */}
      <div className="panel">
        <div className="field">
          <label className="field__label">安装位置</label>
          <div className="field__row">
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              spellCheck={false}
              placeholder="C:\Program Files\Mynx"
            />
            <button className="btn btn--ghost" onClick={browseFolder}>
              更改…
            </button>
          </div>
          <div className="field__hint">
            磁盘空间需求:约 {ctx?.payload_size_mb ?? 17} MB · 此操作需要管理员权限
          </div>
        </div>

        <div className="field">
          <label className="field__label">附加选项</label>
          <div className="option-group">
            <label className="option">
              <input
                type="checkbox"
                checked={desktop}
                onChange={(e) => setDesktop(e.target.checked)}
              />
              <span className="option__box" />
              <span className="option__text">
                在桌面创建快捷方式
                <span className="option__hint">安装后桌面会出现 Mynx 图标</span>
              </span>
            </label>
            <label className="option">
              <input
                type="checkbox"
                checked={startMenu}
                onChange={(e) => setStartMenu(e.target.checked)}
              />
              <span className="option__box" />
              <span className="option__text">
                添加到开始菜单
                <span className="option__hint">开始菜单里会出现 Mynx 文件夹(含卸载入口)</span>
              </span>
            </label>
            <label className="option">
              <input
                type="checkbox"
                checked={launchAfter}
                onChange={(e) => setLaunchAfter(e.target.checked)}
              />
              <span className="option__box" />
              <span className="option__text">
                安装完成后启动 Mynx
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* === 底部按钮 === */}
      <div className="actions">
        <button className="btn btn--ghost" onClick={onCancel}>
          取消
        </button>
        <button
          className="btn btn--primary"
          disabled={!canInstall}
          onClick={() =>
            onNext({
              path: path.trim(),
              options: { desktop, startMenu, launchAfter },
            })
          }
        >
          安装
        </button>
      </div>
    </>
  );
};