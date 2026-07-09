import { useEffect, useState } from "react";
import { Logo } from "../components/Logo";
import { api, InstallProgress, InstallResult } from "../lib/ipc";
import { UnlistenFn } from "@tauri-apps/api/event";

interface Props {
  path: string;
  options: { desktop: boolean; startMenu: boolean; launchAfter: boolean };
  onDone: (r: InstallResult) => void;
}

export const Installing: React.FC<Props> = ({ path, options, onDone }) => {
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("准备安装…");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<InstallProgress>("install-progress", (e) => {
        setPct(e.payload.percent);
        setMsg(e.payload.message);
      });

      try {
        const result = await api.install({
          install_path: path,
          create_desktop_icon: options.desktop,
          create_start_menu: options.startMenu,
          launch_after: options.launchAfter,
        });
        onDone(result);
      } catch (e: any) {
        setErr(String(e));
      }
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, [path, options, onDone]);

  if (err) {
    return (
      <div className="progress">
        <div style={{ color: "#E81123", fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
          安装失败
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{err}</div>
        <div style={{ marginTop: 24 }}>
          <button className="btn btn--primary" onClick={() => window.close()}>关闭</button>
        </div>
      </div>
    );
  }

  return (
    <div className="progress">
      <div className="progress__icon">
        <Logo size={80} withShadow={false} />
      </div>
      <div className="progress__title">正在安装 Mynx</div>
      <div className="progress__message">{msg}</div>
      <div className="progress__bar">
        <div className="progress__bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress__percent">{pct}%</div>
    </div>
  );
};