import { useEffect, useState } from "react";
import { Logo } from "../components/Logo";
import { api, InstallContext } from "../lib/ipc";

interface Props {
  onConfirm: () => void;
  onCancel: () => void;
}

export const Uninstall: React.FC<Props> = ({ onConfirm, onCancel }) => {
  const [ctx, setCtx] = useState<InstallContext | null>(null);

  useEffect(() => {
    api.getContext().then(setCtx);
  }, []);

  return (
    <>
      <div className="hero">
        <Logo size={72} />
        <div className="hero__title">卸载 Mynx</div>
        <div className="hero__subtitle">从您的电脑移除此应用程序</div>
      </div>

      <p className="description">
        卸载程序将从您的电脑中移除 Mynx 及其所有组件。
        此操作不可撤销。
      </p>

      {/* 已安装信息面板 */}
      {ctx?.installed_path && (
        <div className="install-info">
          <div className="install-info__row">
            <span className="install-info__label">应用程序</span>
            <span className="install-info__value">{ctx.app_name}</span>
          </div>
          <div className="install-info__row">
            <span className="install-info__label">版本</span>
            <span className="install-info__value">{ctx.installed_version ?? "—"}</span>
          </div>
          <div className="install-info__row">
            <span className="install-info__label">发布者</span>
            <span className="install-info__value">{ctx.publisher}</span>
          </div>
          <div className="install-info__row">
            <span className="install-info__label">安装位置</span>
            <span className="install-info__value">{ctx.installed_path}</span>
          </div>
        </div>
      )}

      {/* 危险提示 */}
      <div className="uninstall-banner">
        <span className="uninstall-banner__icon">⚠</span>
        <div className="uninstall-banner__text">
          卸载将删除安装目录下的所有文件以及桌面 / 开始菜单快捷方式,
          并清除相关注册表项。已保存的个人数据(若有)不会被自动删除。
        </div>
      </div>

      <div className="actions">
        <button className="btn btn--ghost" onClick={onCancel}>
          取消
        </button>
        <button className="btn btn--danger" onClick={onConfirm}>
          卸载
        </button>
      </div>
    </>
  );
};