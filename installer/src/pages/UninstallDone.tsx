interface Props {
  onClose: () => void;
}

export const UninstallDone: React.FC<Props> = ({ onClose }) => (
  <>
    <div className="done">
      <div className="done__icon">
        <svg width="72" height="72" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">
          <circle className="done__success-bg" cx="36" cy="36" r="34" />
          <circle className="done__success-outline" cx="36" cy="36" r="34" />
          <path
            d="M22 36 L33 47 L52 26"
            className="done__success-mark"
            fill="none"
          />
        </svg>
      </div>
      <div className="done__title">卸载清理已安排</div>
      <div className="done__msg">
        清理已安排；关闭此窗口后，Mynx 文件和卸载入口将完成移除。
      </div>
    </div>
    <div className="actions">
      <button className="btn btn--primary" onClick={onClose}>
        关闭
      </button>
    </div>
  </>
);
