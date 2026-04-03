import { useEffect, useMemo, useState } from "react"
import { Navigate, useParams, useSearchParams } from "react-router-dom"
import { api, type Topic } from "@/api/client"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const TAB_SLUGS = ["overview", "parties", "evidence", "forum", "analysis"] as const

type TabSlug = typeof TAB_SLUGS[number]

const tabFromSlug = (slug?: string | null): TabSlug => TAB_SLUGS.includes(slug as TabSlug) ? slug as TabSlug : "overview"

export function TopicView() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const activeTab = tabFromSlug(params.get("tab"))
  const [topic, setTopic] = useState<Topic | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [panel, setPanel] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    setError(null)
    api.topics.get(id).then(setTopic).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [id])

  const content = useMemo(() => {
    if (!topic) return null
    return {
      overview: <Card><CardHeader><CardTitle>Overview</CardTitle><CardDescription>{topic.description || "No description yet."}</CardDescription></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-3"><Meta label="Status" value={topic.status} /><Meta label="Version" value={`v${topic.current_version}`} /><Meta label="Topic ID" value={topic.id} /></div></CardContent></Card>,
      parties: <TabEmpty title="Parties" description="No party data loaded yet." action="Open party profile" onAction={() => setPanel("party")} />,
      evidence: <TabEmpty title="Evidence" description="No evidence loaded yet." action="Open clue detail" onAction={() => setPanel("clue")} />,
      forum: <TabEmpty title="Forum" description="No forum session loaded yet." />,
      analysis: <TabEmpty title="Analysis" description={topic.status === "draft" ? "Empty state for new topics." : "No analysis data available yet."} />,
    }
  }, [topic])

  if (error) return <div className="p-6 text-sm text-destructive">{error}</div>
  if (!id) return <Navigate to="/" replace />
  if (!topic) return <div className="p-6 text-sm text-muted-foreground">Loading topic…</div>

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{topic.title}</h1>
            <Badge variant="secondary" className="capitalize">{topic.status.replace(/_/g, " ")}</Badge>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">{topic.description || "No description yet."}</p>
        </div>
        <Button variant="outline" onClick={() => setPanel("party")}>Open detail panel</Button>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setParams(value === "overview" ? {} : { tab: value })}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="parties">Parties</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="forum">Forum</TabsTrigger>
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
        </TabsList>
        {TAB_SLUGS.map(slug => <TabsContent key={slug} value={slug} className="mt-4">{content?.[slug]}</TabsContent>)}
      </Tabs>

      <Sheet open={panel !== null} onOpenChange={(open) => !open && setPanel(null)}>
        <SheetContent side="right" className="w-[420px] sm:max-w-[420px]">
          <SheetHeader>
            <SheetTitle>{panel === "clue" ? "Clue detail" : "Party profile"}</SheetTitle>
            <SheetDescription>Contextual detail panel for the workspace.</SheetDescription>
          </SheetHeader>
          <div className="space-y-3 p-4 text-sm text-muted-foreground">
            {panel === "clue" ? <><div className="rounded-lg border bg-card p-3"><div className="font-medium text-foreground">clue-001</div><div>Placeholder clue details while data loads.</div></div></> : <><div className="rounded-lg border bg-card p-3"><div className="font-medium text-foreground">Sample Party</div><div>Placeholder party profile while data loads.</div></div></>}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function TabEmpty({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) {
  return <div className={cn("rounded-xl border border-dashed p-8 text-center", "bg-card")}> <div className="text-lg font-semibold">{title}</div><div className="mt-2 text-sm text-muted-foreground">{description}</div>{action && onAction && <Button className="mt-4" variant="secondary" onClick={onAction}>{action}</Button>}</div>
}

function Meta({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border bg-background p-3"><div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-sm font-medium">{value}</div></div> }
