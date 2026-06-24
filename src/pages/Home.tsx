import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import AppMark from "@/components/AppMark";
import { tools } from "@/lib/tools";

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="home-shell">
      <div className="home-brand">
        <AppMark size={40} />
        <div>
          <div className="home-title">Mynx</div>
          <div className="home-subtitle">好用的工具，都在这里</div>
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

      <div className="home-footer">
        <span className="home-footer-line">© 2026 Han</span>
      </div>
    </div>
  );
}
