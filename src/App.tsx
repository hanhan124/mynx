import { Suspense } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import TitleBar from "@/components/TitleBar";
import Sidebar from "@/components/Sidebar";
import Home from "@/pages/Home";
import ToastContainer from "@/components/Toast";
import UpdateNotification from "@/components/UpdateNotification";
import { tools, getpageTitle } from "@/lib/tools";

function Layout() {
  const location = useLocation();
  const title = getpageTitle(location.pathname);

  return (
    <div className="app-layout">
      <TitleBar title={title} />
      <div className="app-body">
        <Sidebar />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Home />} />
            {tools.map((tool) => (
              <Route
                key={tool.path}
                path={tool.path}
                element={
                  <Suspense fallback={null}>
                    <tool.component />
                  </Suspense>
                }
              />
            ))}
          </Routes>
        </main>
      </div>
      <ToastContainer />
      <UpdateNotification />
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
