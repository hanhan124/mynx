import { useEffect, useState } from "react";
import { Logo } from "../components/Logo";
import { api } from "../lib/ipc";
import type { UnlistenFn } from "@tauri-apps/api/event";

interface Props {
  onDone: () => void;
}

export const UninstallProgress: React.FC<Props> = ({ onDone }) => {
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("准备卸载…");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let unlisten: UnlistenFn | undefined;

    void (async () => {
      try {
        const stopListening = await api.onProgress("uninstall-progress", (progress) => {
          if (!active) return;
          setPct(progress.percent);
          setMsg(progress.message);
        });
        if (!active) {
          stopListening();
          return;
        }
        unlisten = stopListening;

        await api.uninstall();
        if (active) onDone();
      } catch (error: unknown) {
        if (active) setErr(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      active = false;
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
        <Logo size={72} />
      </div>
      <div className="progress__title" id="uninstall-progress-title">正在卸载 Mynx</div>
      <div className="progress__message">{msg}</div>
      <div className="progress__bar" role="progressbar" aria-labelledby="uninstall-progress-title" aria-valuenow={pct}>
        <div className="progress__bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress__percent">{pct}%</div>
    </div>
  );
};
