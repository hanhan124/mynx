import { Logo } from "../components/Logo";
import { InstallResult } from "../lib/ipc";

interface Props {
  result: InstallResult;
  onLaunch: () => void;
  onClose: () => void;
}

export const Done: React.FC<Props> = ({ result, onLaunch, onClose }) => (
  <div className="done">
    <div className="done__icon">
      <svg width="88" height="88" viewBox="0 0 88 88" xmlns="http://www.w3.org/2000/svg">
        <circle className="done__success-bg" cx="44" cy="44" r="40" />
        <circle className="done__success-outline" cx="44" cy="44" r="40" />
        <path
          d="M26 44 L40 58 L62 32"
          className="done__success-mark"
          fill="none"
        />
      </svg>
    </div>
    <div className="done__title">安装完成</div>
    <div className="done__msg">
      Mynx 已成功安装到您的电脑,立即开始体验吧。
      <br />
      <span className="done__path">{result.install_path}</span>
    </div>
    <div className="done__actions">
      <button className="btn btn--ghost" onClick={onClose}>
        稍后启动
      </button>
      <button className="btn btn--primary" onClick={onLaunch}>
        立即启动
      </button>
    </div>
  </div>
);
