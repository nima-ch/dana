import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { Dashboard } from "./pages/Dashboard"
import { TopicView } from "./pages/TopicView"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/topic/:id" element={<TopicView />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
)
