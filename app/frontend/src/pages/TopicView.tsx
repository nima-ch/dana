import { useEffect, useState } from "react"
import { Navigate, useParams, useSearchParams } from "react-router-dom"
import { api, type Topic } from "@/api/client"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PipelineActivityFeed } from "@/components/Pipeline/PipelineActivityFeed"
import { OperationModal } from "@/components/Pipeline/OperationModal"
import { PartiesPanel } from "@/components/Topic/PartiesPanel"
import { CluesPanel } from "@/components/Topic/CluesPanel"
import { usePipelineStore } from "@/stores/pipelineStore"

const TAB_SLUGS = ["overview", "parties", "evidence", "forum"] as const

type TabSlug = typeof TAB_SLUGS[number]

const tabFromSlug = (slug?: string | null): TabSlug => TAB_SLUGS.includes(slug as TabSlug) ? slug as TabSlug : "overview"

export function TopicView() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const activeTab = tabFromSlug(params.get("tab"))
  const [topic, setTopic] = useState<Topic | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    setError(null)
    api.topics.get(id).then(setTopic).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [id])

  const startOp = usePipelineStore((s) => s.startOperation)
  const finishOp = usePipelineStore((s) => s.finishOperation)

  const refreshTopic = () => {
    if (!id) return
    api.topics.get(id).then(setTopic).catch(() => {})
  }

  async function handlePipelineAction(action: "discover" | "enrich" | "analyze" | "reanalyze") {
    if (!id) return
    const labels: Record<string, string> = { discover: "Discovery", enrich: "Enrichment", analyze: "Analysis", reanalyze: "Re-analysis" }
    startOp(id, action, labels[action] ?? action)
    try {
      if (action === "discover") {
        await api.pipeline.discover(id)
        setTopic(current => current ? { ...current, status: "discovery" } : current)
      } else if (action === "enrich") {
        await api.pipeline.enrich(id)
        setTopic(current => current ? { ...current, status: "enrichment" } : current)
      } else if (action === "analyze") {
        await api.pipeline.analyze(id)
        setTopic(current => current ? { ...current, status: "weight" } : current)
      } else if (action === "reanalyze") {
        await api.pipeline.reanalyze(id)
        setTopic(current => current ? { ...current, status: "weight" } : current)
      }
    } finally {
      finishOp()
      refreshTopic()
    }
  }

  if (error) return <div className="p-6 text-sm text-destructive">{error}</div>
  if (!id) return <Navigate to="/" replace />
  if (!topic) return <div className="p-6 text-sm text-muted-foreground">Loading topic…</div>

  const pipelineFeed = <PipelineActivityFeed topicId={id} status={topic.status} active={topic.status !== "draft" && topic.status !== "complete"} onAction={handlePipelineAction} />
  const content = {
    overview: <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border/70 bg-card/80 px-4 py-2.5 text-sm">
        <span className="text-muted-foreground">Status</span>
        <Badge variant="secondary" className="capitalize">{topic.status.replace(/_/g, " ")}</Badge>
        <span className="text-border">|</span>
        <span className="text-muted-foreground">Version</span>
        <span className="font-medium">v{topic.current_version}</span>
        <span className="text-border">|</span>
        <span className="truncate font-mono text-xs text-muted-foreground">{topic.id}</span>
      </div>
      {pipelineFeed}
    </div>,
    parties: <PartiesPanel topicId={id} status={topic.status} />,
    evidence: <CluesPanel topicId={id} />,
    forum: <TabEmpty title="Forum" description="No forum session loaded yet." />,
  }

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
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setParams(value === "overview" ? {} : { tab: value })}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="parties">Parties</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="forum">Forum</TabsTrigger>
        </TabsList>
        {TAB_SLUGS.map(slug => <TabsContent key={slug} value={slug} className="mt-4">{content[slug]}</TabsContent>)}
      </Tabs>

      <OperationModal />
    </div>
  )
}

function TabEmpty({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) {
  return <div className={cn("rounded-xl border border-dashed p-8 text-center", "bg-card")}> <div className="text-lg font-semibold">{title}</div><div className="mt-2 text-sm text-muted-foreground">{description}</div>{action && onAction && <Button className="mt-4" variant="secondary" onClick={onAction}>{action}</Button>}</div>
}


