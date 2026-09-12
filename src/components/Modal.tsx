import { type ReactNode } from "react";
import { Modal as AntModal } from "antd";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  wide?: boolean;
  children: ReactNode;
}

export default function Modal({ open, onClose, title, wide, children }: ModalProps) {
  return (
    <AntModal
      className={wide ? "mynx-ant-modal mynx-ant-modal--wide" : "mynx-ant-modal"}
      centered
      destroyOnHidden
      footer={null}
      open={open}
      onCancel={onClose}
      title={title}
      width={wide ? 760 : 420}
    >
      {children}
    </AntModal>
  );
}
