import { useEffect, useRef, useState, useCallback } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/**
 * Hook for window-level file/folder drag-and-drop with a specific drop zone.
 *
 * Tauri's native drag-drop events are window-level; this hook checks
 * whether the drop position falls within the target element's bounds.
 */
export function useDropZone(onDrop: (paths: string[]) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleDrop = useCallback(onDrop, [onDrop]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    async function setup() {
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        const { payload } = event;

        if (payload.type === "enter" || payload.type === "over") {
          const el = ref.current;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          const cx = payload.position.x / dpr;
          const cy = payload.position.y / dpr;
          setIsDragOver(
            cx >= rect.left &&
              cx <= rect.right &&
              cy >= rect.top &&
              cy <= rect.bottom,
          );
        } else if (payload.type === "drop") {
          const el = ref.current;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          const cx = payload.position.x / dpr;
          const cy = payload.position.y / dpr;
          if (
            cx >= rect.left &&
            cx <= rect.right &&
            cy >= rect.top &&
            cy <= rect.bottom
          ) {
            handleDrop(payload.paths);
          }
          setIsDragOver(false);
        } else if (payload.type === "leave") {
          setIsDragOver(false);
        }
      });
    }

    setup();
    return () => {
      unlisten?.();
    };
  }, [handleDrop]);

  return { dropRef: ref, isDragOver };
}
