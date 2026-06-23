import { useNavigate } from "react-router-dom";
import { FlaskConical, Image, ArrowRight } from "lucide-react";
import AppMark from "@/components/AppMark";

interface ToolCard {
  title: string;
  description: string;
  path: string;
  accent: string;
  icon: typeof FlaskConical;
}

const tools: ToolCard[] = [
  {
    title: "qPCR 分析",
    description: "数据转换 · 相对定量计算 · 结果可视化",
    path: "/qpcr",
    accent: "#007aff",
    icon: FlaskConical,
  },
  {
    title: "TIFF 转 JPG",
    description: "批量转换 TIFF 图片为 JPG 格式",
    path: "/tiff",
    accent: "#34c759",
    icon: Image,
  },
];

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="home-shell">
      <div className="home-brand">
        <AppMark size={40} />
        <div>
          <div className="home-title">Mynx</div>
          <div className="home-subtitle">桌面效率工具集</div>
        </div>
      </div>

      <div className="tool-grid">
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.path}
              className="tool-card"
              onClick={() => navigate(tool.path)}
            >
              <div className="tool-card-icon" style={{ background: tool.accent }}>
                <Icon size={18} color="white" strokeWidth={1.8} />
              </div>
              <div className="tool-card-body">
                <span className="tool-card-title">{tool.title}</span>
                <span className="tool-card-desc">{tool.description}</span>
              </div>
              <ArrowRight size={14} strokeWidth={2} className="tool-card-arrow" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
