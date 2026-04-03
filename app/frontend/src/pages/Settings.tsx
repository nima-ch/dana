import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { api } from "@/api/client"
import { ExternalLink, Plug, Unplug } from "lucide-react"

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

const STORAGE_KEY = "dana.settings.activeTab"
const PROVIDERS: Array<Omit<ProviderState, "status" | "account" | "oauthUrl" | "message" | "models">> = [
  { provider: "claude", label: "Claude / Anthropic", description: "Claude models for analysis and reasoning.", icon: Plug },
  { provider: "openai", label: "OpenAI / Codex", description: "OpenAI and Codex-compatible models.", icon: ExternalLink },
  { provider: "gemini", label: "Google Gemini", description: "Gemini models for general-purpose reasoning.", icon: ExternalLink },
]

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
  const [providers, setProviders] = useState<ProviderState[]>(PROVIDERS.map(provider => ({ ...provider, status: "disconnected", models: [] })))
  const [login, setLogin] = useState<{ provider: ProviderId; oauthUrl: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadProviders = async () => {
    const [connections, modelGroups] = await Promise.all([api.providers.list(), api.providers.models()])
    setProviders(PROVIDERS.map(provider => {
      const connected = connections.providers.find(item => item.provider === provider.provider)
      const grouped = modelGroups.providers.find(item => item.provider === provider.provider)
      return {
        ...provider,
        status: connected ? "connected" : "disconnected",
        account: connected?.account ?? null,
        models: grouped?.models ?? [],
      }
    }))
  }

  useEffect(() => { void loadProviders() }, [])

  useEffect(() => {
    const timer = setInterval(async () => {
      const states = await api.providers.statuses()
      setProviders(current => current.map(provider => {
        const status = states.providers.find(item => item.provider === provider.provider)
        return status?.connected ? { ...provider, status: "connected", account: status.account ?? provider.account, message: null } : provider
      }))
    }, 3000)
    return () => clearInterval(timer)
  }, [])

  const connect = async (provider: ProviderId) => {
    setError(null)
    const response = await api.providers.login(provider)
    const oauthUrl = response.oauth_url ?? null
    setLogin({ provider, oauthUrl })
    if (oauthUrl) window.open(oauthUrl, "_blank", "noopener,noreferrer")
    setProviders(current => current.map(item => item.provider === provider ? { ...item, status: "connecting", oauthUrl, message: null } : item))
    const poll = setInterval(async () => {
      const status = await api.providers.loginStatus(provider)
      if (status.connected) {
        clearInterval(poll)
        setLogin(null)
        await loadProviders()
      } else if (status.timeout) {
        clearInterval(poll)
        setLogin(null)
        setError(`OAuth login for ${provider} timed out after 60 seconds.`)
        setProviders(current => current.map(item => item.provider === provider ? { ...item, status: "disconnected", oauthUrl: null, message: "Login timed out. Please try again." } : item))
      } else if (status.error) {
        clearInterval(poll)
        setLogin(null)
        setError(status.error)
        setProviders(current => current.map(item => item.provider === provider ? { ...item, status: "error", message: status.error ?? "Login failed." } : item))
      }
    }, 2000)
  }

  const disconnect = async (provider: ProviderId) => {
    await api.providers.disconnect(provider)
    await loadProviders()
  }

  return (
    <Card className={cn("border-border/70 bg-card/80", active && "ring-1 ring-primary/30")}>
      <CardHeader>
        <CardTitle>Providers & Models</CardTitle>
        <CardDescription>Connect Claude, OpenAI/Codex, or Google Gemini to unlock model access.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        {!providers.some(provider => provider.status === "connected") && (
          <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">Connect a provider to see available models and start using the workspace.</div>
        )}
        <div className="grid gap-4 xl:grid-cols-3">
          {providers.map(provider => (
            <ProviderCard key={provider.provider} provider={provider} onConnect={() => void connect(provider.provider)} onDisconnect={() => void disconnect(provider.provider)} />
          ))}
        </div>
        <Separator />
        <div className="grid gap-3 md:grid-cols-3">
          <ShellCard title="Persisted state" body="Connection state survives reloads through backend credentials." />
          <ShellCard title="Auto model fetch" body="After connection, available models refresh automatically." />
          <ShellCard title="Guidance" body="When all providers are disconnected, the page guides first-time users to connect." />
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

function ProviderCard({ provider, onConnect, onDisconnect }: { provider: ProviderState; onConnect: () => void; onDisconnect: () => void }) {
  const Icon = provider.icon
  const connected = provider.status === "connected"
  return (
    <Card className="border-border/70 bg-background/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Icon className="size-4" />{provider.label}</CardTitle>
        <CardDescription>{provider.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Badge variant={connected ? "default" : provider.status === "error" ? "destructive" : "outline"}>{connected ? "Connected" : provider.status === "connecting" ? "Connecting" : provider.status === "error" ? "Error" : "Disconnected"}</Badge>
          {connected && <span className="text-sm text-muted-foreground">{provider.account || "Connected account"}</span>}
        </div>
        {provider.message && <div className="rounded-md border border-border/70 bg-muted/40 p-3 text-sm text-muted-foreground">{provider.message}</div>}
        {provider.models.length > 0 ? (
          <ScrollArea className="h-28 rounded-md border border-border/70 p-3">
            <div className="space-y-1 text-sm">
              {provider.models.map(model => <div key={model}>{model}</div>)}
            </div>
          </ScrollArea>
        ) : (
          <div className="text-sm text-muted-foreground">No models loaded yet.</div>
        )}
        <div className="flex gap-2">
          {connected ? <Button variant="outline" onClick={onDisconnect}><Unplug className="mr-2 size-4" />Disconnect</Button> : <Button onClick={onConnect}><Plug className="mr-2 size-4" />Connect</Button>}
        </div>
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
