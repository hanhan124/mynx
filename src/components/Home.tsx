import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FlaskConical, Image } from "lucide-react";

const FALLBACK_SVG = (
  <svg width="100%" height="100%" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
    <rect width="1024" height="1024" rx="180" fill="#E8EFF8"/>
    <path d="M141.64 405.64A23.27 23.27 0 0 0 160.81 442.18h350.49a23.27 23.27 0 0 0 18.46-37.47L364.68 190.16a46.55 46.55 0 0 0-75.17 1.89l-147.87 213.6z" fill="#69CB91"/>
    <path d="M337.45 849.45a174.55 174.55 0 1 0 0-349.09 174.55 174.55 0 0 0 0 349.09z" fill="#247ADE"/>
    <path d="M907.64 186.18a23.27 23.27 0 0 0-23.27-23.27h-209.45a23.27 23.27 0 0 0-23.27 23.27v674.91a23.27 23.27 0 0 0 23.27 23.27h209.45a23.27 23.27 0 0 0 23.27-23.27V186.18z" fill="#A0BFF7"/>
  </svg>
);

interface ToolCard {
  title: string;
  description: string;
  path: string;
  gradient: string;
  icon: typeof FlaskConical;
}

const tools: ToolCard[] = [
  {
    title: "qPCR Tools",
    description: "实时荧光定量 PCR 数据分析",
    path: "/qpcr",
    gradient: "linear-gradient(135deg, #8AB4F8, #81C995)",
    icon: FlaskConical,
  },
  {
    title: "TIFF 转 JPG",
    description: "批量图片格式转换",
    path: "/tiff",
    gradient: "linear-gradient(135deg, #F28B82, #FDD663)",
    icon: Image,
  },
];

function LogoImg() {
  const [error, setError] = useState(false);
  if (error) {
    return <div style={{ width: 52, height: 52, borderRadius: 12, overflow: "hidden" }}>{FALLBACK_SVG}</div>;
  }
  return (
    <img
      src="/ref/icon.svg"
      alt="Mynx"
      width={52}
      height={52}
      style={{ borderRadius: 12 }}
      onError={() => setError(true)}
    />
  );
}

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="home">
      <div className="home-header">
        <div className="home-logo">
          <LogoImg />
        </div>
        <h1 className="home-title">Mynx</h1>
        <p className="home-subtitle">效率工具集</p>
      </div>

      <div className="home-cards">
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.path}
              className="tool-card"
              onClick={() => navigate(tool.path)}
            >
              <div
                className="tool-card-icon"
                style={{ background: tool.gradient }}
              >
                <Icon size={20} color="white" strokeWidth={1.8} />
              </div>
              <div className="tool-card-text">
                <span className="tool-card-title">{tool.title}</span>
                <span className="tool-card-desc">{tool.description}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
