import { useEffect, useState } from "react";
import { Logo } from "../components/Logo";
import { api } from "../lib/ipc";
import type { InstallResult } from "../lib/ipc";
import type { UnlistenFn } from "@tauri-apps/api/event";

interface Props {
  path: string;
  options: { desktop: boolean; startMenu: boolean };
  onDone: (r: InstallResult) => void;
}

export const Installing: React.FC<Props> = ({ path, options, onDone }) => {
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("准备安装…");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let unlisten: UnlistenFn | undefined;

    void (async () => {
      try {
        const stopListening = await api.onProgress("install-progress", (progress) => {
          if (!active) return;
          setPct(progress.percent);
          setMsg(progress.message);
        });
        if (!active) {
          stopListening();
          return;
        }
        unlisten = stopListening;

        const result = await api.install({
          install_path: path,
          create_desktop_icon: options.desktop,
          create_start_menu: options.startMenu,
        });
        if (active) onDone(result);
      } catch (error: unknown) {
        if (active) setErr(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, [path, options, onDone]);

  if (err) {
    return (
      <div className="progress">
        <div className="progress__error-title">
          安装失败
        </div>
        <div className="progress__error-msg">{err}</div>
        <div style={{ marginTop: 24 }}>
          <button className="btn btn--primary" onClick={() => window.close()}>关闭</button>
        </div>
      </div>
    );
  }

  return (
    <div className="progress">
      <div className="progress__icon">
        <Logo size={64} />
      </div>
      <div className="progress__title" id="install-progress-title">正在安装 Mynx</div>
      <div className="progress__message">{msg}</div>
      <div className="progress__bar" role="progressbar" aria-labelledby="install-progress-title" aria-valuenow={pct}>
        <div className="progress__bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress__percent">{pct}%</div>
    </div>
  );
};
