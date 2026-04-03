import { ChevronLeft, ChevronRight, Settings } from "lucide-react"
import { Link, NavLink, Outlet, useLocation, useParams } from "react-router-dom"
import { ThemeToggle } from "./theme-toggle"
import { useTopicsStore } from "../stores/topicsStore"
import { useUIStore } from "../stores/uiStore"

function breadcrumbLabel(pathname: string, topicTitle?: string) {
  if (pathname.startsWith("/settings")) return "Settings"
  if (pathname.startsWith("/topic/") && topicTitle) return topicTitle
  return "Dashboard"
}

export function AppShell() {
  const { topics } = useTopicsStore()
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const location = useLocation()
  const params = useParams()
  const topic = topics.find(t => t.id === params.id)
  const activeLabel = breadcrumbLabel(location.pathname, topic?.title)

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className={`flex flex-col border-r border-border/70 bg-card/70 backdrop-blur transition-all duration-200 ${sidebarCollapsed ? "w-20" : "w-72"}`}>
        <div className="flex items-center justify-between border-b border-border/70 p-4">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-semibold">D</div>
            {!sidebarCollapsed && <div><div className="font-semibold">Dana</div><div className="text-xs text-muted-foreground">App shell</div></div>}
          </Link>
          <button type="button" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} className="rounded-md border border-border p-2">
            {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        <nav className="flex-1 space-y-2 overflow-auto p-3">
          <div className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Topics</div>
          {topics.map(topic => (
            <NavLink key={topic.id} to={`/topic/${topic.id}`} className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${topic.status === "complete" ? "bg-green-500" : topic.status === "draft" ? "bg-muted-foreground" : "bg-blue-400"}`} />
              {!sidebarCollapsed && <span className="truncate">{topic.title}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-border/70 p-3 space-y-3">
          <Link to="/settings" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-accent/60">
            <Settings size={16} />
            {!sidebarCollapsed && <span>Settings</span>}
          </Link>
          <div className="flex items-center justify-between px-3">
            {!sidebarCollapsed && <span className="text-sm">Theme</span>}
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center border-b border-border/70 px-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/" className="hover:text-foreground">Dashboard</Link>
            <span>/</span>
            {location.pathname.startsWith("/topic/") ? <span className="text-foreground">{activeLabel}</span> : <span className="text-foreground">{activeLabel}</span>}
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-auto"><Outlet /></main>
      </div>
    </div>
  )
}
