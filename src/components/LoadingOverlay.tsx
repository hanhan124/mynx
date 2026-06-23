interface LoadingOverlayProps {
  visible: boolean;
  text?: string;
}

export default function LoadingOverlay({ visible, text = "处理中..." }: LoadingOverlayProps) {
  if (!visible) return null;

  return (
    <div className="loading-overlay">
      <div className="loading-box">
        <div className="spinner" />
        <div className="loading-text">{text}</div>
      </div>
    </div>
  );
}
