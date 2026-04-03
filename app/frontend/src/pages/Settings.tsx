import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { ChevronDown, ChevronRight, Search, AlertTriangle, ExternalLink, Plug, RotateCcw, Plus, Trash2 } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
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

const PIPELINE_DEFAULTS = {
  forum_rounds: 3,
  expert_count: 6,
  clue_search_depth: 3,
  forum_max_turns: 50,
  language: "en",
  auto_refresh_clues: false,
  refresh_interval_hours: 24,
}

const LANGUAGE_OPTIONS = ["en", "fa", "ar", "he", "tr", "ru", "fr", "es"]

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
            {value === "providers" ? <ProvidersPanel active={activeTab === value} /> : value === "agents" ? <AgentsToolsPanel active={activeTab === value} /> : <SettingsPanel title={meta.label} description={meta.description} active={activeTab === value} />}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

type AgentItem = {
  name: string
  task_category: string
  model: string
  tools: string[]
}

type ToolItem = {
  name: string
  description: string
  schema?: string
  custom?: boolean
}

function AgentsToolsPanel({ active }: { active: boolean }) {
  const [agents, setAgents] = useState<AgentItem[]>([])
  const [tools, setTools] = useState<ToolItem[]>([])
  const [models, setModels] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ToolItem | null>(null)
  const [customTool, setCustomTool] = useState({ name: "", description: "", endpoint: "", input_schema: "{}" })

  useEffect(() => {
    void (async () => {
      const [agentList, toolList, modelList] = await Promise.all([api.agents.list(), api.tools.list(), api.models.list()])
      setAgents(agentList)
      setTools(toolList)
      setModels(modelList.map(model => model.id))
    })()
  }, [])

  const toggleTool = async (agent: AgentItem, tool: string) => {
    const nextTools = agent.tools.includes(tool) ? agent.tools.filter(item => item !== tool) : [...agent.tools, tool]
    await api.agents.updateTools(agent.name, nextTools)
    setAgents(current => current.map(item => item.name === agent.name ? { ...item, tools: nextTools } : item))
  }

  const updateModel = async (agent: AgentItem, model: string) => {
    await api.agents.updateModel(agent.name, model)
    setAgents(current => current.map(item => item.name === agent.name ? { ...item, model } : item))
  }

  const createTool = async () => {
    setAdding(true)
    try {
      const next = await api.tools.create(customTool)
      setTools(current => [...current, next])
      setCustomTool({ name: "", description: "", endpoint: "", input_schema: "{}" })
    } finally {
      setAdding(false)
    }
  }

  const removeTool = async () => {
    if (!deleteTarget) return
    await api.tools.remove(deleteTarget.name)
    setTools(current => current.filter(tool => tool.name !== deleteTarget.name))
    setDeleteTarget(null)
  }

  return (
    <Card className={cn("border-border/70 bg-card/80", active && "ring-1 ring-primary/30")}>
      <CardHeader>
        <CardTitle>Agents & Tools</CardTitle>
        <CardDescription>Toggle tool access per agent, override agent models, and manage the custom tool registry.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 xl:grid-cols-2">
          {agents.map(agent => (
            <Card key={agent.name} className="border-border/70 bg-background/70">
              <CardHeader className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{agent.name}</CardTitle>
                    <CardDescription>{agent.task_category}</CardDescription>
                  </div>
                  <Badge variant="outline">{agent.tools.length} tools</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Select value={agent.model} onValueChange={value => void updateModel(agent, value)}>
                  <SelectTrigger><SelectValue placeholder="Select model" /></SelectTrigger>
                  <SelectContent>
                    {models.map(model => <SelectItem key={model} value={model}>{model}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="flex flex-wrap gap-2">
                  {tools.map(tool => (
                    <button key={tool.name} type="button" onClick={() => void toggleTool(agent, tool.name)} className={cn("rounded-full border px-3 py-1 text-xs transition-colors", agent.tools.includes(tool.name) ? "border-primary bg-primary/10 text-primary" : "border-border/70 bg-background hover:bg-accent/40")}>
                      {tool.name}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Tool registry</div>
              <div className="text-sm text-muted-foreground">Custom tools are listed with delete confirmation and schema previews.</div>
            </div>
            <Dialog open={false}>
              <Button onClick={() => setAdding(true)}><Plus className="mr-2 size-4" />Add Custom Tool</Button>
            </Dialog>
          </div>
          <div className="overflow-hidden rounded-lg border border-border/70">
            <div className="grid grid-cols-12 gap-3 border-b border-border/70 bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <div className="col-span-3">Name</div>
              <div className="col-span-5">Description</div>
              <div className="col-span-3">Schema</div>
              <div className="col-span-1 text-right">Action</div>
            </div>
            {tools.map(tool => (
              <div key={tool.name} className="grid grid-cols-12 gap-3 border-b border-border/70 px-4 py-3 text-sm last:border-b-0">
                <div className="col-span-3 font-medium">{tool.name}{tool.custom ? <Badge className="ml-2" variant="secondary">Custom</Badge> : null}</div>
                <div className="col-span-5 text-muted-foreground">{tool.description}</div>
                <div className="col-span-3 truncate font-mono text-xs text-muted-foreground">{tool.schema ?? "—"}</div>
                <div className="col-span-1 text-right">
                  {tool.custom ? <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(tool)}><Trash2 className="size-4" /></Button> : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        {adding && (
          <Card className="border-border/70 bg-background/70">
            <CardHeader>
              <CardTitle className="text-base">Add Custom Tool</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <Input placeholder="Name" value={customTool.name} onChange={e => setCustomTool(current => ({ ...current, name: e.target.value }))} />
              <Input placeholder="Endpoint" value={customTool.endpoint} onChange={e => setCustomTool(current => ({ ...current, endpoint: e.target.value }))} />
              <Input className="md:col-span-2" placeholder="Description" value={customTool.description} onChange={e => setCustomTool(current => ({ ...current, description: e.target.value }))} />
              <Textarea className="md:col-span-2 font-mono text-xs" placeholder="Input schema JSON" value={customTool.input_schema} onChange={e => setCustomTool(current => ({ ...current, input_schema: e.target.value }))} />
              <div className="md:col-span-2 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
                <Button onClick={() => void createTool()} disabled={adding}>Save</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {deleteTarget && (
          <Dialog open onOpenChange={() => setDeleteTarget(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete custom tool?</DialogTitle>
                <DialogDescription>This removes {deleteTarget.name} from the registry. This action cannot be undone.</DialogDescription>
              </DialogHeader>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
                <Button variant="destructive" onClick={() => void removeTool()}>Delete</Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </CardContent>
    </Card>
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

  const connectProvider = async (providerId: string) => {
    setProviders(cur => cur.map(p => p.provider === providerId ? { ...p, status: "connecting" as const } : p))
    try {
      const res = await api.providers.login(providerId)
      if (res.oauth_url) {
        setLogin({ provider: providerId as ProviderId, oauthUrl: res.oauth_url })
      }
      const poll = setInterval(async () => {
        try {
          const status = await api.providers.loginStatus(providerId)
          if (status.oauth_url && !login?.oauthUrl) {
            setLogin({ provider: providerId as ProviderId, oauthUrl: status.oauth_url })
          }
          if (status.connected) {
            clearInterval(poll)
            setLogin(null)
            await loadProviders()
          }
          if (status.timeout) {
            clearInterval(poll)
            setLogin(null)
            setProviders(cur => cur.map(p => p.provider === providerId ? { ...p, status: "error" as const } : p))
          }
        } catch {
          clearInterval(poll)
          setLogin(null)
          setProviders(cur => cur.map(p => p.provider === providerId ? { ...p, status: "error" as const } : p))
        }
      }, 2000)
    } catch {
      setProviders(cur => cur.map(p => p.provider === providerId ? { ...p, status: "error" as const } : p))
    }
  }

  const disconnectProvider = async (providerId: string) => {
    await api.providers.disconnect(providerId)
    await loadProviders()
  }

  return (
    <Card className={cn("border-border/70 bg-card/80", active && "ring-1 ring-primary/30")}>
      <CardHeader>
        <CardTitle>Providers & Models</CardTitle>
        <CardDescription>Connect Claude, OpenAI/Codex, or Google Gemini to unlock model access.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          {providers.map(provider => (
            <Card key={provider.provider} className="border-border/70 bg-background/70">
              <CardHeader className="space-y-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{provider.label}</CardTitle>
                  <Badge variant={provider.status === "connected" ? "default" : "secondary"}>
                    {provider.status === "connected" ? "Connected" : provider.status === "connecting" ? "Connecting..." : provider.status === "error" ? "Error" : "Disconnected"}
                  </Badge>
                </div>
                <CardDescription>{provider.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {provider.status === "connected" && provider.account && (
                  <div className="text-sm text-muted-foreground">Account: {provider.account}</div>
                )}
                {provider.status === "connected" && (
                  <div className="text-sm text-muted-foreground">{provider.models.length} models available</div>
                )}
                {provider.status === "connected" ? (
                  <Button variant="outline" size="sm" className="w-full" onClick={() => void disconnectProvider(provider.provider)}>Disconnect</Button>
                ) : (
                  <Button size="sm" className="w-full" onClick={() => void connectProvider(provider.provider)} disabled={provider.status === "connecting"}>
                    {provider.status === "connecting" ? "Connecting..." : "Connect"}
                  </Button>
                )}
                {provider.status === "error" && (
                  <div className="text-sm text-destructive">Connection failed or timed out. Try again.</div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
        <Separator />
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
  if (title === "System Prompts") {
    return <PromptsPanel active={active} />
  }
  if (title === "Pipeline") {
    return <PipelinePanel active={active} />
  }
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

function PipelinePanel({ active }: { active: boolean }) {
  const [settings, setSettings] = useState(PIPELINE_DEFAULTS)
  const [savedSettings, setSavedSettings] = useState(PIPELINE_DEFAULTS)
  const [customTopics, setCustomTopics] = useState<Array<{ id: string; title: string; settings: Record<string, unknown> }>>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const [appSettings, topics] = await Promise.all([api.settings.get(), api.topics.list()])
      const next = { ...PIPELINE_DEFAULTS, ...(appSettings.pipeline_settings ?? {}) }
      setSettings(next)
      setSavedSettings(next)
      const custom = topics.filter(topic => topic.settings && Object.keys(topic.settings).length > 0)
      setCustomTopics(custom.map(topic => ({ id: topic.id, title: topic.title, settings: topic.settings })))
    })()
  }, [])

  const validate = (next = settings) => {
    const nextErrors: Record<string, string> = {}
    const check = (key: keyof typeof PIPELINE_DEFAULTS, min: number, max: number) => {
      const value = Number(next[key])
      if (!Number.isInteger(value) || value < min || value > max) nextErrors[key] = `Must be between ${min} and ${max}`
    }
    check("forum_rounds", 1, 5)
    check("expert_count", 2, 8)
    check("clue_search_depth", 1, 10)
    check("forum_max_turns", 10, 100)
    check("refresh_interval_hours", 1, 168)
    if (!String(next.language || "").trim()) nextErrors.language = "Language is required"
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const save = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      const updated = await api.settings.update({ pipeline_settings: settings })
      const next = { ...PIPELINE_DEFAULTS, ...(updated.pipeline_settings ?? settings) }
      setSettings(next)
      setSavedSettings(next)
      setMessage("Saved pipeline settings.")
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    setSettings(PIPELINE_DEFAULTS)
    setErrors({})
    setMessage("Reset to defaults.")
  }

  const updateNumber = (key: keyof typeof PIPELINE_DEFAULTS, value: string) => {
    const parsed = value === "" ? value : Number(value)
    const next = { ...settings, [key]: parsed }
    setSettings(next)
    validate(next)
  }

  const isDirty = JSON.stringify(settings) !== JSON.stringify(savedSettings)

  return (
    <Card className={cn("border-border/70 bg-card/80", active && "ring-1 ring-primary/30")}>
      <CardHeader>
        <CardTitle>Pipeline</CardTitle>
        <CardDescription>Configure global analysis defaults and review topic-specific overrides.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <SettingField label="Forum rounds" error={errors.forum_rounds}>
            <Input type="number" min={1} max={5} value={String(settings.forum_rounds)} onChange={e => updateNumber("forum_rounds", e.target.value)} />
          </SettingField>
          <SettingField label="Expert count" error={errors.expert_count}>
            <Input type="number" min={2} max={8} value={String(settings.expert_count)} onChange={e => updateNumber("expert_count", e.target.value)} />
          </SettingField>
          <SettingField label="Clue search depth" error={errors.clue_search_depth}>
            <Input type="number" min={1} max={10} value={String(settings.clue_search_depth)} onChange={e => updateNumber("clue_search_depth", e.target.value)} />
          </SettingField>
          <SettingField label="Forum max turns" error={errors.forum_max_turns}>
            <Input type="number" min={10} max={100} value={String(settings.forum_max_turns)} onChange={e => updateNumber("forum_max_turns", e.target.value)} />
          </SettingField>
          <SettingField label="Language" error={errors.language}>
            <Select value={settings.language} onValueChange={value => setSettings(current => ({ ...current, language: value }))}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LANGUAGE_OPTIONS.map(code => <SelectItem key={code} value={code}>{code}</SelectItem>)}
              </SelectContent>
            </Select>
          </SettingField>
          <SettingField label="Refresh interval (hours)" error={errors.refresh_interval_hours}>
            <Input type="number" min={1} max={168} value={String(settings.refresh_interval_hours)} onChange={e => updateNumber("refresh_interval_hours", e.target.value)} />
          </SettingField>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border/70 bg-background/50 p-4">
          <div>
            <div className="text-sm font-medium">Auto-refresh clues</div>
            <div className="text-sm text-muted-foreground">Automatically refresh clue data on the configured interval.</div>
          </div>
          <input type="checkbox" checked={settings.auto_refresh_clues} onChange={e => setSettings(current => ({ ...current, auto_refresh_clues: e.target.checked }))} className="h-4 w-4" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void save()} disabled={saving || !isDirty}>{saving ? "Saving..." : "Save"}</Button>
          <Button variant="outline" onClick={reset}><RotateCcw className="mr-2 size-4" />Reset to defaults</Button>
          {message && <span className="self-center text-sm text-muted-foreground">{message}</span>}
        </div>
        <Separator />
        <div className="space-y-3">
          <div className="text-sm font-medium">Per-topic overrides</div>
          {customTopics.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">No topics with custom pipeline settings yet.</div>
          ) : customTopics.map(topic => (
            <div key={topic.id} className="rounded-lg border border-border/70 bg-background/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{topic.title}</div>
                  <div className="text-xs text-muted-foreground">{topic.id}</div>
                </div>
                <Badge variant="outline">Override active</Badge>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2 xl:grid-cols-3">
                {Object.entries(topic.settings).map(([key, value]) => <div key={key}><span className="font-medium text-foreground">{key}:</span> {String(value)}</div>)}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function SettingField({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  )
}

type PromptItem = {
  name: string
  path: string
  content: string
  agent: string
  variables: string[]
  stage: string
}

function PromptsPanel({ active }: { active: boolean }) {
  const [prompts, setPrompts] = useState<PromptItem[]>([])
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({})
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const loadPrompts = async () => {
    setLoading(true)
    try {
      const data = await api.prompts.list()
      setPrompts(data)
      setExpandedStages(current => {
        const next = { ...current }
        for (const stage of Array.from(new Set(data.map(item => item.stage)))) {
          if (next[stage] === undefined) next[stage] = true
        }
        return next
      })
      setDrafts(current => {
        const next = { ...current }
        for (const prompt of data) {
          if (next[prompt.name] === undefined) next[prompt.name] = prompt.content
        }
        return next
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadPrompts() }, [])

  const stages = useMemo(() => {
    const grouped = new Map<string, PromptItem[]>()
    for (const prompt of prompts) {
      if (!grouped.has(prompt.stage)) grouped.set(prompt.stage, [])
      grouped.get(prompt.stage)!.push(prompt)
    }
    return Array.from(grouped.entries())
  }, [prompts])

  const selected = prompts.find(prompt => prompt.name === selectedPrompt) ?? null
  const draft = selected ? drafts[selected.name] ?? selected.content : ""
  const dirty = !!selected && draft !== selected.content

  const toggleStage = (stage: string) => setExpandedStages(current => ({ ...current, [stage]: !current[stage] }))

  const insertVariable = (variable: string) => {
    if (!selected) return
    setDrafts(current => {
      const nextValue = `${current[selected.name] ?? selected.content}${current[selected.name]?.endsWith(" ") ? "" : " "}{${variable}}`
      return { ...current, [selected.name]: nextValue }
    })
  }

  const savePrompt = async () => {
    if (!selected) return
    setSaving(selected.name)
    try {
      const updated = await api.prompts.update(selected.name, draft)
      setPrompts(current => current.map(prompt => prompt.name === updated.name ? updated : prompt))
      setDrafts(current => ({ ...current, [updated.name]: updated.content }))
      setMessage("Saved changes.")
    } finally {
      setSaving(null)
    }
  }

  const resetPrompt = async () => {
    if (!selected) return
    setSaving(`${selected.name}:reset`)
    try {
      const updated = await api.prompts.reset(selected.name)
      setPrompts(current => current.map(prompt => prompt.name === updated.name ? updated : prompt))
      setDrafts(current => ({ ...current, [updated.name]: updated.content }))
      setMessage("Restored default prompt.")
    } finally {
      setSaving(null)
    }
  }

  return (
    <Card className={cn("border-border/70 bg-card/80", active && "ring-1 ring-primary/30")}>
      <CardHeader>
        <CardTitle>System Prompts</CardTitle>
        <CardDescription>Edit stage-grouped prompt templates with inline preview and variable chips.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? <div className="text-sm text-muted-foreground">Loading prompts…</div> : null}
        {stages.map(([stage, items]) => (
          <div key={stage} className="rounded-lg border border-border/70 bg-background/50">
            <button type="button" onClick={() => toggleStage(stage)} className="flex w-full items-center justify-between px-4 py-3 text-left">
              <div>
                <div className="font-medium capitalize">{stage}</div>
                <div className="text-xs text-muted-foreground">{items.length} prompt{items.length === 1 ? "" : "s"}</div>
              </div>
              {expandedStages[stage] ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
            {expandedStages[stage] && (
              <div className="space-y-2 border-t border-border/70 p-3">
                {items.map(prompt => (
                  <button
                    key={prompt.name}
                    type="button"
                    onClick={() => setSelectedPrompt(prompt.name)}
                    className={cn("w-full rounded-md border px-3 py-2 text-left transition-colors", selectedPrompt === prompt.name ? "border-primary/50 bg-primary/5" : "border-border/70 hover:bg-accent/40")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">{prompt.name}</div>
                        <div className="text-xs text-muted-foreground">{prompt.agent}</div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1">
                        {prompt.variables.length === 0 ? <Badge variant="outline">No variables</Badge> : prompt.variables.map(variable => <Badge key={variable} variant="secondary">{`{${variable}}`}</Badge>)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {selected ? (
          <div className="rounded-lg border border-border/70 bg-background/60 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{selected.name}</div>
                <div className="text-xs text-muted-foreground">{selected.agent}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {selected.variables.map(variable => <Button key={variable} type="button" size="sm" variant="outline" onClick={() => insertVariable(variable)}>{`{${variable}}`}</Button>)}
              </div>
            </div>
            <Textarea value={draft} onChange={e => setDrafts(current => ({ ...current, [selected.name]: e.target.value }))} className="min-h-72 font-mono text-sm" placeholder="Select a prompt to edit it." />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={() => void savePrompt()} disabled={!dirty || saving === selected.name}>{saving === selected.name ? "Saving..." : "Save"}</Button>
              <Button type="button" variant="outline" onClick={() => void resetPrompt()} disabled={saving === `${selected.name}:reset`}>{saving === `${selected.name}:reset` ? "Resetting..." : "Reset to Default"}</Button>
              {message && <span className="text-sm text-muted-foreground">{message}</span>}
            </div>
            <div className="rounded-md border border-dashed border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
              Template variables are shown as chips and remain in the prompt text as `{` + "variable" + `}` tokens.
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">
            Select a prompt to open the inline editor.
          </div>
        )}
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
