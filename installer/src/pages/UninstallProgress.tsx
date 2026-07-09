import { useEffect, useState } from "react";
import { Logo } from "../components/Logo";
import { api, InstallProgress } from "../lib/ipc";
import { UnlistenFn } from "@tauri-apps/api/event";

interface Props {
  onDone: () => void;
}

export const UninstallProgress: React.FC<Props> = ({ onDone }) => {
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("准备卸载…");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<InstallProgress>("uninstall-progress", (e) => {
        setPct(e.payload.percent);
        setMsg(e.payload.message);
      });

      try {
        await api.uninstall();
        onDone();
      } catch (e: any) {
        setErr(String(e));
      }
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, [onDone]);

  if (err) {
    return (
      <>
        <div className="progress">
          <div className="progress__error-title">卸载失败</div>
          <div className="progress__error-msg">{err}</div>
        </div>
        <div className="actions">
          <button className="btn btn--primary" onClick={() => window.close()}>关闭</button>
        </div>
      </>
    );
  }

  return (
    <div className="progress">
      <div className="progress__icon">
        <Logo size={72} withShadow={false} />
      </div>
      <div className="progress__title">正在卸载 Mynx</div>
      <div className="progress__message">{msg}</div>
      <div className="progress__bar">
        <div className="progress__bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress__percent">{pct}%</div>
    </div>
  );
};