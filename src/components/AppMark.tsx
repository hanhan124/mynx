interface AppMarkProps {
  size?: number;
  className?: string;
}

export default function AppMark({ size = 40, className }: AppMarkProps) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      width={size}
      height={size}
      className={className}
      style={{ display: "block", borderRadius: size * 0.15 }}
      aria-label="Mynx"
    >
      {/* 盒子轮廓 */}
      <path
        d="M512 0L32 208v608l480 208 480-208V208L512 0zM129.6 222.4L512 56l388.8 169.6L512 393.6 129.6 222.4z m812.8 558.4l-404.8 176V440l404.8-176v516.8z"
        fill="#8a8a8a"
      />
      {/* 正面 — 蓝色 */}
      <path
        d="M486.4 955.2L81.6 780.8V257.6l404.8 182.4z"
        fill="#2F75EC"
      />
      {/* 装饰线 — 跟随主题 */}
      <path
        d="M353.6 542.4l-174.4-76.8c-12.8-6.4-19.2-20.8-12.8-33.6 6.4-12.8 20.8-19.2 33.6-12.8L374.4 496c12.8 6.4 19.2 20.8 12.8 33.6-6.4 12.8-20.8 19.2-33.6 12.8z"
        fill="currentColor"
      />
    </svg>
  );
}
