import { useEffect, useMemo, useState } from "react"
import { Search, AlertTriangle, ExternalLink, Plug } from "lucide-react"
import { useNavigate, useParams } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { api } from "@/api/client"

const tabMap = {
  providers: { label: "Providers & Models", description: "Connect providers and manage unified model access." },
  prompts: { label: "System Prompts", description: "Edit prompt templates and defaults." },
  agents: { label: "Agents & Tools", description: "Assign tools and override agent behavior." },
  pipeline: { label: "Pipeline", description: "Configure global analysis defaults and topic overrides." },
} as const

type TabKey = keyof typeof tabMap

type ProviderId = "claude" | "openai" | "gemini"

type ProviderState = {
  provider: ProviderId
  label: string
  description: string
  icon: typeof Plug
  status: "disconnected" | "connecting" | "connected" | "error"
  account?: string | null
  oauthUrl?: string | null
  message?: string | null
  models: string[]
}

type ModelOption = {
  id: string
  provider: string
}

const STORAGE_KEY = "dana.settings.activeTab"
const TASK_CATEGORIES: Array<{ key: string; label: string; description: string }> = [
  { key: "data_gathering", label: "Data Gathering", description: "Web search, HTTP fetch, source collection." },
  { key: "extraction", label: "Extraction", description: "Clue and content extraction pipelines." },
  { key: "enrichment", label: "Enrichment", description: "Discovery, enrichment, and weighting." },
  { key: "delta_updates", label: "Delta Updates", description: "Incremental refresh and delta analysis." },
  { key: "forum_reasoning", label: "Forum Reasoning", description: "Forum debate and representative reasoning." },
  { key: "expert_council", label: "Expert Council", description: "Expert analysis and synthesis." },
  { key: "verdict", label: "Verdict", description: "Final scoring and verdict synthesis." },
]

const DEFAULT_MODELS: Record<string, string> = {
  data_gathering: "claude-haiku-4-5-20251001",
  extraction: "claude-haiku-4-5-20251001",
  enrichment: "claude-sonnet-4-6",
  delta_updates: "claude-sonnet-4-6",
  forum_reasoning: "claude-opus-4-6",
  expert_council: "claude-opus-4-6",
  verdict: "claude-opus-4-6",
}

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
            {value === "providers" ? <ProvidersPanel active={activeTab === value} /> : <SettingsPanel title={meta.label} description={meta.description} active={activeTab === value} />}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

function ProvidersPanel({ active }: { active: boolean }) {
  const [providers, setProviders] = useState<ProviderState[]>([{ provider: "claude", label: "Claude / Anthropic", description: "Claude models for analysis and reasoning.", icon: Plug, status: "disconnected", models: [] }, { provider: "openai", label: "OpenAI / Codex", description: "OpenAI and Codex-compatible models.", icon: ExternalLink, status: "disconnected", models: [] }, { provider: "gemini", label: "Google Gemini", description: "Gemini models for general-purpose reasoning.", icon: ExternalLink, status: "disconnected", models: [] }])
  const [login, setLogin] = useState<{ provider: ProviderId; oauthUrl: string | null } | null>(null)
  const [settings, setSettings] = useState<Record<string, string>>(DEFAULT_MODELS)
  const [search, setSearch] = useState("")
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const loadProviders = async () => {
    const [connections, modelGroups, appSettings] = await Promise.all([api.providers.list(), api.providers.models(), api.settings.get()])
    setProviders(current => current.map(provider => {
      const connected = connections.providers.find(item => item.provider === provider.provider)
      const grouped = modelGroups.providers.find(item => item.provider === provider.provider)
      return {
        ...provider,
        status: connected ? "connected" : "disconnected",
        account: connected?.account ?? null,
        models: grouped?.models ?? [],
      }
    }))
    setSettings({ ...DEFAULT_MODELS, ...appSettings.default_models })
  }

  useEffect(() => { void loadProviders() }, [])

  const allModels = useMemo(() => providers.flatMap(provider => provider.models.map(model => ({ id: model, provider: provider.label }))), [providers])
  const filteredModels = useMemo(() => allModels.filter(model => model.id.toLowerCase().includes(search.toLowerCase()) || model.provider.toLowerCase().includes(search.toLowerCase())), [allModels, search])

  const groupedModels = useMemo(() => {
    const map = new Map<string, ModelOption[]>()
    for (const model of filteredModels) {
      if (!map.has(model.provider)) map.set(model.provider, [])
      map.get(model.provider)!.push(model)
    }
    return Array.from(map.entries())
  }, [filteredModels])

  const connectedModelIds = useMemo(() => new Set(allModels.map(model => model.id)), [allModels])

  const saveModel = async (category: string, model: string) => {
    setSavingKey(category)
    try {
      const next = { ...settings, [category]: model }
      setSettings(next)
      await api.settings.update({ default_models: { [category]: model } })
    } finally {
      setSavingKey(null)
    }
  }

  const resetDefaults = async () => {
    setSavingKey("reset")
    try {
      setSettings(DEFAULT_MODELS)
      await api.settings.update({ default_models: DEFAULT_MODELS })
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <Card className={cn("border-border/70 bg-card/80", active && "ring-1 ring-primary/30")}>
      <CardHeader>
        <CardTitle>Providers & Models</CardTitle>
        <CardDescription>Connect Claude, OpenAI/Codex, or Google Gemini to unlock model access.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
                <div className="rounded-lg border border-border/70 bg-background/40 p-4 space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-medium">Unified model picker</div>
              <div className="text-sm text-muted-foreground">Browse models across all connected providers and assign defaults per task category.</div>
            </div>
            <Button variant="outline" onClick={resetDefaults} disabled={savingKey === "reset"}>{savingKey === "reset" ? "Resetting..." : "Reset to Defaults"}</Button>
          </div>
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search models or providers" className="pl-9" />
          </div>
          <div className="space-y-3">
            <Label>Available models</Label>
            <ScrollArea className="h-64 rounded-md border border-border/70 bg-background p-2">
              {groupedModels.length === 0 ? <div className="p-4 text-sm text-muted-foreground">No connected provider models found.</div> : groupedModels.map(([provider, models]) => (
                <div key={provider} className="mb-3 last:mb-0">
                  <div className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{provider}</div>
                  <div className="space-y-1">
                    {models.map(model => (
                      <div key={model.id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent/50">
                        <span>{model.id}</span>
                        {!connectedModelIds.has(model.id) && <Badge variant="outline">Unavailable</Badge>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </ScrollArea>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {TASK_CATEGORIES.map(category => {
            const current = settings[category.key] ?? DEFAULT_MODELS[category.key]
            const unavailable = current && !connectedModelIds.has(current)
            return (
              <Card key={category.key} className="border-border/70 bg-background/70">
                <CardHeader className="space-y-2">
                  <CardTitle className="text-base">{category.label}</CardTitle>
                  <CardDescription>{category.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {unavailable && <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700"><AlertTriangle className="size-4" /> Selected model is from a disconnected provider and is currently unavailable.</div>}
                  <Select value={current} onValueChange={value => void saveModel(category.key, value)}>
                    <SelectTrigger><SelectValue placeholder="Select model" /></SelectTrigger>
                    <SelectContent>
                      {groupedModels.flatMap(([provider, models]) => [<SelectItem key={provider} value={`${provider}__group`} disabled>{provider}</SelectItem>, ...models.map(model => <SelectItem key={model.id} value={model.id}>{model.id}</SelectItem>)])}
                    </SelectContent>
                  </Select>
                  <div className="text-xs text-muted-foreground">Current default: {current}</div>
                </CardContent>
              </Card>
            )
          })}
        </div>
        <Separator />
        <div className="grid gap-3 md:grid-cols-3">
          <ShellCard title="Persisted state" body="Connection state survives reloads through backend credentials." />
          <ShellCard title="Global defaults" body="Changes save through PUT /api/settings and apply to new topics." />
          <ShellCard title="Per-topic overrides" body="Existing topic overrides remain unchanged when defaults are reset." />
        </div>
        {login?.oauthUrl && (
          <Dialog open onOpenChange={() => setLogin(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Complete OAuth login</DialogTitle>
                <DialogDescription>Open the provider authorization page and finish login. We will poll for completion automatically.</DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <div className="rounded-md border border-border/70 bg-muted/40 p-3 break-all">{login.oauthUrl}</div>
                <Button onClick={() => window.open(login.oauthUrl!, "_blank", "noopener,noreferrer")}>Open authorization page</Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </CardContent>
    </Card>
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
        <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">Placeholder content for this settings area.</div>
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
