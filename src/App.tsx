import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import TitleBar from "@/components/TitleBar";
import Sidebar from "@/components/Sidebar";
import Home from "@/pages/Home";
import ToastContainer from "@/components/Toast";
import TiffPage from "@/pages/tiff/TiffPage";
import QpcrPage from "@/pages/qpcr/QpcrPage";

const pageTitles: Record<string, string> = {
  "/": "Mynx",
  "/qpcr": "qPCR 分析",
  "/tiff": "TIFF 转 JPG",
};

function Layout() {
  const location = useLocation();
  const title = pageTitles[location.pathname] ?? "Mynx";

  return (
    <div className="app-layout">
      <TitleBar title={title} />
      <div className="app-body">
        <Sidebar />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/qpcr" element={<QpcrPage />} />
            <Route path="/tiff" element={<TiffPage />} />
          </Routes>
        </main>
      </div>
      <ToastContainer />
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  );
}

export default App;
