import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Route, Routes } from "react-router-dom"
import { AppShell } from "./components/AppShell"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { ThemeProvider } from "./components/theme-provider"
import { Dashboard } from "./pages/Dashboard"
import { SettingsPage } from "./pages/Settings"
import { TopicView } from "./pages/TopicView"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/topic/:id" element={<TopicView />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<div className="flex min-h-screen items-center justify-center bg-background p-6 text-center">404 — Page not found</div>} />
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
