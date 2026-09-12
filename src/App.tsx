import { Suspense } from "react";
import { HashRouter, Routes, Route, useLocation } from "react-router-dom";
import TitleBar from "@/components/TitleBar";
import Sidebar from "@/components/Sidebar";
import Home from "@/pages/Home";
import ToastContainer from "@/components/Toast";
import UpdateNotification from "@/components/UpdateNotification";
import { tools, getPageTitle } from "@/lib/tools";
import SearchWindow from "@/pages/SearchWindow";
import { LanguageProvider, getToolTranslationKey, useLanguage } from "@/lib/i18n";

function Layout() {
  const location = useLocation();
  const { t } = useLanguage();
  const title =
    location.pathname === "/"
      ? "Mynx"
      : t(getToolTranslationKey(location.pathname, "title")) ||
        getPageTitle(location.pathname);

  if (location.pathname === "/search-window") return <SearchWindow />;

  return (
    <div className="app-layout">
      <TitleBar title={title} />
      <div className="app-body">
        <Sidebar />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search-window" element={<SearchWindow />} />
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
    <HashRouter>
      <LanguageProvider>
        <Layout />
      </LanguageProvider>
    </HashRouter>
  );
}

export default App;
