interface Props {
  onClose: () => void;
}

export const UninstallDone: React.FC<Props> = ({ onClose }) => (
  <>
    <div className="done">
      <div className="done__icon">
        <svg width="72" height="72" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">
          <circle cx="36" cy="36" r="34" fill="#34C759" />
          <path
            d="M22 36 L33 47 L52 26"
            stroke="#fff"
            strokeWidth="5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="done__title">卸载完成</div>
      <div className="done__msg">
        Mynx 已从您的电脑中移除。感谢您的使用。
      </div>
    </div>
    <div className="actions">
      <button className="btn btn--primary" onClick={onClose}>
        关闭
      </button>
    </div>
  </>
);