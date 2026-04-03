import { Navigate, useParams } from "react-router-dom"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const tabs = ["providers", "prompts", "agents", "pipeline"] as const

export function SettingsPage() {
  const { tab } = useParams()
  const active = tabs.includes(tab as typeof tabs[number]) ? tab! : "providers"
  if (tab && !tabs.includes(tab as typeof tabs[number])) return <Navigate to="/settings" replace />

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Configure providers, prompts, agents, and pipeline settings.</p>
      </div>
      <Tabs value={active} className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="providers">Providers & Models</TabsTrigger>
          <TabsTrigger value="prompts">System Prompts</TabsTrigger>
          <TabsTrigger value="agents">Agents & Tools</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
        </TabsList>
        <TabsContent value="providers"><Panel title="Providers & Models" description="Provider cards and unified model picker live here." /></TabsContent>
        <TabsContent value="prompts"><Panel title="System Prompts" description="Prompt editor content will appear here." /></TabsContent>
        <TabsContent value="agents"><Panel title="Agents & Tools" description="Agent configuration and tool registry will appear here." /></TabsContent>
        <TabsContent value="pipeline"><Panel title="Pipeline" description="Global pipeline defaults and topic overrides will appear here." /></TabsContent>
      </Tabs>
    </div>
  )
}

function Panel({ title, description }: { title: string; description: string }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent>Empty workspace shell.</CardContent></Card>
}
