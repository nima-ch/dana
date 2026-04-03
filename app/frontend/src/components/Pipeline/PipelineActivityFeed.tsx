import { useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, ChevronDown, ChevronRight, CircleDot, Clock3, Lightbulb, MessagesSquare, Search, Sparkles, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useSSE, type SSEEvent } from "@/hooks/useSSE"

export type PipelineStage = "discovery" | "enrichment" | "weight" | "forum" | "expert_council" | "verdict"

const STAGES: { key: PipelineStage; label: string }[] = [
  { key: "discovery", label: "Discovery" },
  { key: "enrichment", label: "Enrichment" },
  { key: "weight", label: "Weight" },
  { key: "forum", label: "Forum" },
  { key: "expert_council", label: "Expert Council" },
  { key: "verdict", label: "Verdict" },
]

export type PipelineAction = "discover" | "analyze" | "reanalyze" | "update"

export type PipelineStatus = "draft" | "review_parties" | "review_enrichment" | "forum" | "expert_council" | "complete" | "stale" | string

interface Props {
  topicId: string | null
  status: PipelineStatus
  active?: boolean
  onAction: (action: PipelineAction) => void | Promise<void>
}

type FeedItem =
  | { id: string; type: "think"; icon: string; label: string; detail?: string; ts: number }
  | { id: string; type: "progress"; stage: string; pct: number; msg: string; ts: number }
  | { id: string; type: "forum_turn"; turn: Record<string, unknown>; ts: number }
  | { id: string; type: "clue_discovered"; clue_id: string; title: string; source: string; relevance: number; ts: number }
  | { id: string; type: "stage_complete"; stage: string; ts: number }
  | { id: string; type: "error"; message: string; ts: number }
  | { id: string; type: "weight_result"; parties: { name: string; weight: number }[]; ts: number }
  | { id: string; type: "expert_assessment"; expert: string; domain: string; summary: string; ts: number }
  | { id: string; type: "verdict_content"; headline: string; scenarios?: { title: string; probability: number }[]; ts: number }

export function PipelineActivityFeed({ topicId, status, active = false, onAction }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [items, setItems] = useState<FeedItem[]>([])
  const [liveStages, setLiveStages] = useState<Record<string, number>>({})
  const topicRef = useRef(topicId)

  useEffect(() => {
    if (topicRef.current !== topicId) {
      topicRef.current = topicId
      setItems([])
      setLiveStages({})
      setCollapsed(false)
    }
  }, [topicId])

  useSSE(active && topicId ? topicId : null, (event) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    if (event.type === "ping") return
    setItems(prev => [...prev.slice(-99), normalizeEvent(id, event)])
    if (event.type === "progress") setLiveStages(prev => ({ ...prev, [event.stage]: event.pct }))
    if (event.type === "stage_complete") setLiveStages(prev => ({ ...prev, [event.stage]: 100 }))
  })

  const stageState = useMemo(() => STAGES.map(stage => ({
    ...stage,
    pct: liveStages[stage.key] ?? (status === "complete" ? 100 : 0),
  })), [liveStages, status])

  const idle = !active && items.length === 0
  const minimized = collapsed || idle

  const actions = buttonSet(status)

  return <Card className={cn("border-border/70 bg-card/80 shadow-none", minimized ? "sticky bottom-4 mx-4" : "mx-0")}> 
    <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 px-4 py-3">
      <div className="flex items-center gap-2">
        <CardTitle className="text-sm">Pipeline activity</CardTitle>
        <Badge variant={active ? "default" : "secondary"}>{active ? "Live" : "Idle"}</Badge>
      </div>
      <div className="flex items-center gap-2">
        {actions.map(action => <Button key={action.label} size="sm" variant={action.primary ? "default" : "outline"} onClick={() => onAction(action.key as PipelineAction)}>{action.label}</Button>)}
        <Button size="icon" variant="ghost" onClick={() => setCollapsed(v => !v)} aria-label={collapsed ? "Expand pipeline feed" : "Collapse pipeline feed"}>{collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}</Button>
      </div>
    </CardHeader>
    {!minimized && <CardContent className="space-y-4 px-4 pb-4 pt-0">
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {stageState.map(stage => <StageProgress key={stage.key} label={stage.label} pct={stage.pct} />)}
      </div>
      <div className="max-h-[28rem] space-y-2 overflow-y-auto rounded-xl border border-border/60 bg-background p-3">
        {items.length === 0 ? <div className="text-sm text-muted-foreground">{idle ? "Idle. Start discovery to see live events." : "Waiting for live SSE events…"}</div> : items.map(item => <FeedRow key={item.id} item={item} />)}
      </div>
    </CardContent>}
  </Card>
}

function buttonSet(status: PipelineStatus) {
  if (status === "draft") return [{ key: "discover", label: "Start Discovery", primary: true }]
  if (status === "review_parties" || status === "review_enrichment") return [{ key: "analyze", label: "Continue Analysis", primary: true }]
  if (status === "complete") return [{ key: "reanalyze", label: "Re-analyze", primary: true }]
  if (status === "stale") return [{ key: "update", label: "Update", primary: true }]
  return [{ key: "discover", label: "Start Discovery", primary: true }]
}

function StageProgress({ label, pct }: { label: string; pct: number }) {
  return <div className="rounded-lg border border-border/60 bg-background p-3"><div className="mb-2 flex items-center justify-between gap-2 text-xs"><span className="font-medium">{label}</span><span className="tabular-nums text-muted-foreground">{Math.round(pct)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div></div>
}

function FeedRow({ item }: { item: FeedItem }) {
  const meta = (() => {
    switch (item.type) {
      case "think": return { icon: <Sparkles size={14} />, title: item.label, detail: item.detail }
      case "progress": return { icon: <Clock3 size={14} />, title: `${item.stage} ${Math.round(item.pct)}%`, detail: item.msg }
      case "forum_turn": return { icon: <MessagesSquare size={14} />, title: "Forum turn", detail: stringifyTurn(item.turn) }
      case "clue_discovered": return { icon: <Lightbulb size={14} />, title: item.title, detail: `${item.source} · relevance ${Math.round(item.relevance)}` }
      case "stage_complete": return { icon: <CircleDot size={14} />, title: `Stage complete · ${item.stage}`, detail: undefined }
      case "error": return { icon: <TriangleAlert size={14} />, title: "Error", detail: item.message }
      case "weight_result": return { icon: <Search size={14} />, title: "Weight results", detail: item.parties.map(p => `${p.name} ${p.weight}`).join(" · ") }
      case "expert_assessment": return { icon: <Sparkles size={14} />, title: item.expert, detail: `${item.domain} · ${item.summary}` }
      case "verdict_content": return { icon: <AlertCircle size={14} />, title: "Verdict", detail: item.headline }
    }
  })()
  return <div className="flex gap-3 rounded-lg border border-border/60 bg-card px-3 py-2 text-sm"><div className="mt-0.5 text-muted-foreground">{meta.icon}</div><div className="min-w-0 flex-1"><div className="font-medium">{meta.title}</div>{meta.detail && <div className="truncate text-xs text-muted-foreground">{meta.detail}</div>}</div></div>
}

function stringifyTurn(turn: Record<string, unknown>) {
  return String(turn.statement ?? turn.content ?? turn.position ?? "Forum update")
}

function normalizeEvent(id: string, event: SSEEvent): FeedItem {
  const ts = Date.now()
  if (event.type === "think") return { id, ts, ...event }
  if (event.type === "progress") return { id, ts, ...event }
  if (event.type === "forum_turn") return { id, ts, ...event }
  if (event.type === "clue_discovered") return { id, ts, ...event }
  if (event.type === "stage_complete") return { id, ts, ...event }
  if (event.type === "error") return { id, ts, ...event }
  if (event.type === "weight_result") return { id, ts, ...event }
  if (event.type === "expert_assessment") return { id, ts, ...event }
  return { id, ts, type: "verdict_content", headline: "", scenarios: [] }
}
