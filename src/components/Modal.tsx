import { useEffect, type ReactNode } from "react";
import { IconX } from "@tabler/icons-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  wide?: boolean;
  children: ReactNode;
}

export default function Modal({ open, onClose, title, wide, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal-box${wide ? " modal-box--wide" : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        {title && (
          <div className="modal-header">
            <h3>{title}</h3>
            <button className="modal-close-btn" onClick={onClose} aria-label="Close">
              <IconX size={15} stroke={1.7} />
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
