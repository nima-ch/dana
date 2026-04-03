import { useEffect, useMemo } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

const tabMap = {
  providers: { label: "Providers & Models", description: "Connect providers and manage unified model access." },
  prompts: { label: "System Prompts", description: "Edit prompt templates and defaults." },
  agents: { label: "Agents & Tools", description: "Assign tools and override agent behavior." },
  pipeline: { label: "Pipeline", description: "Configure global analysis defaults and topic overrides." },
} as const

type TabKey = keyof typeof tabMap

const STORAGE_KEY = "dana.settings.activeTab"

function readStoredTab(): TabKey {
  if (typeof window === "undefined") return "providers"
  const value = window.localStorage.getItem(STORAGE_KEY)
  return value && value in tabMap ? (value as TabKey) : "providers"
}

function resolveTab(tab?: string): TabKey {
  if (tab && tab in tabMap) return tab as TabKey
  return readStoredTab()
}

export function SettingsPage() {
  const { tab } = useParams()
  const navigate = useNavigate()
  const activeTab = useMemo(() => resolveTab(tab), [tab])

  useEffect(() => {
    if (tab && !(tab in tabMap)) {
      navigate("/settings", { replace: true })
      return
    }
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, activeTab)
  }, [activeTab, navigate, tab])

  const setTab = (value: string) => {
    const next = value as TabKey
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, next)
    navigate(next === "providers" ? "/settings" : `/settings/${next}`)
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Settings</h1>
          <Badge variant="secondary">Workspace</Badge>
        </div>
        <p className="text-sm text-muted-foreground">Configure providers, prompts, agents, and pipeline settings.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setTab} className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-1 gap-2 p-1 sm:grid-cols-2 xl:grid-cols-4">
          {Object.entries(tabMap).map(([value, meta]) => (
            <TabsTrigger key={value} value={value} className="h-full min-h-12 flex-col items-start justify-start gap-1 px-4 py-3 text-left data-[state=active]:bg-background sm:flex-row sm:items-center sm:justify-center sm:text-center">
              <span>{meta.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {Object.entries(tabMap).map(([value, meta]) => (
          <TabsContent key={value} value={value} className="mt-0">
            <SettingsPanel title={meta.label} description={meta.description} active={activeTab === value} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

function SettingsPanel({ title, description, active }: { title: string; description: string; active: boolean }) {
  return (
    <Card className={cn("border-border/70 bg-card/80", active && "ring-1 ring-primary/30")}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">
          Placeholder content for this settings area.
        </div>
        <Separator />
        <div className="grid gap-3 md:grid-cols-3">
          <ShellCard title="Persisted state" body="Tab changes update the URL and local storage." />
          <ShellCard title="Deep links" body="Direct routes open the matching tab immediately." />
          <ShellCard title="Navigation" body="Sidebar Settings link lands on the default shell." />
        </div>
      </CardContent>
    </Card>
  )
}

function ShellCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background p-4">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{body}</div>
    </div>
  )
}
