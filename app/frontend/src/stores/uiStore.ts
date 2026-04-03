import { create } from "zustand"

type ThemeMode = "light" | "dark" | "system"

interface UIStore {
  sidebarCollapsed: boolean
  theme: ThemeMode
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
  setTheme: (theme: ThemeMode) => void
}

const SIDEBAR_KEY = "dana.sidebarCollapsed"
const THEME_KEY = "dana.theme"

const readSidebar = () => localStorage.getItem(SIDEBAR_KEY) === "true"
const readTheme = () => (localStorage.getItem(THEME_KEY) as ThemeMode | null) ?? "dark"

export const useUIStore = create<UIStore>((set, get) => ({
  sidebarCollapsed: false,
  theme: "dark",
  setSidebarCollapsed: (collapsed) => {
    localStorage.setItem(SIDEBAR_KEY, String(collapsed))
    set({ sidebarCollapsed: collapsed })
  },
  toggleSidebar: () => {
    const collapsed = !get().sidebarCollapsed
    localStorage.setItem(SIDEBAR_KEY, String(collapsed))
    set({ sidebarCollapsed: collapsed })
  },
  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme)
    set({ theme })
  },
}))

if (typeof window !== "undefined") {
  useUIStore.setState({
    sidebarCollapsed: readSidebar(),
    theme: readTheme(),
  })
}
