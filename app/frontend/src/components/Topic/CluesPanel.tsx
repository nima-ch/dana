"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowRight, ChevronDown, ChevronRight, MessageSquarePlus, PencilLine, RefreshCw, Search, Trash2 } from "lucide-react"
import { api } from "@/api/client"
import { CredibilityRing } from "../Common/CredibilityRing"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { usePipelineStore } from "@/stores/pipelineStore"

type Clue = any

const BIAS_OPTIONS = ["state_media", "propaganda", "selective_reporting", "unverified_source", "editorial_bias", "conflict_of_interest", "single_source", "outdated"]

function getCurrent(clue: Clue) {
  if (clue?.versions?.length) return clue.versions.find((v: any) => v.v === clue.current) ?? clue.versions[0]
  return clue
}

function getParties(clues: Clue[]) {
  return Array.from(new Set(clues.flatMap((clue) => getCurrent(clue)?.party_relevance ?? clue.party_relevance ?? []))).sort()
}

function getDomains(clues: Clue[]) {
  return Array.from(new Set(clues.flatMap((clue) => getCurrent(clue)?.domain_tags ?? clue.domain_tags ?? []))).sort()
}

function getTypes(clues: Clue[]) {
  return Array.from(new Set(clues.map((clue) => String(getCurrent(clue)?.clue_type ?? clue.clue_type ?? "UNKNOWN")))).sort()
}

function matchesQuery(clue: Clue, query: string) {
  if (!query) return true
  const current = getCurrent(clue)
  const haystack = [current?.title, current?.bias_corrected_summary, current?.summary, clue?.id].filter(Boolean).join(" ").toLowerCase()
  return haystack.includes(query.toLowerCase())
}

function clueMatchesFilters(clue: Clue, filters: { party: string; domain: string; type: string }) {
  const current = getCurrent(clue)
  const parties = current?.party_relevance ?? clue.party_relevance ?? []
  const domains = current?.domain_tags ?? clue.domain_tags ?? []
  const type = String(current?.clue_type ?? clue.clue_type ?? "")
  return (!filters.party || parties.includes(filters.party)) && (!filters.domain || domains.includes(filters.domain)) && (!filters.type || type === filters.type)
}

function safeText(value: unknown) {
  if (typeof value === "string") return value
  if (value == null) return ""
  return String(value)
}

function labelBias(flag: string) {
  return flag.replace(/_/g, " ")
}

function ClueCard({ clue, expanded, onToggleExpanded, onEdit, onSmartEdit, onDelete }: {
  clue: Clue
  expanded: boolean
  onToggleExpanded: () => void
  onEdit: () => void
  onSmartEdit: () => void
  onDelete: () => void
}) {
  const current = getCurrent(clue)
  const credibility = Number(current.source_credibility?.score ?? 0)
  const relevance = Math.round(current.relevance_score ?? 0)
  const sourceOutlet = current.source_credibility?.origin_source?.outlet
  const sourceUrl = current.source_url || current.source_credibility?.origin_source?.url
  const biasNotes = current.source_credibility?.notes
  const biasFlags = current.source_credibility?.bias_flags ?? []
  const keyPoints = current.key_points ?? []
  const timelineDate = safeText(current.timeline_date)

  return (
    <div className="rounded-lg border border-border bg-card transition-colors">
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={onToggleExpanded}>
        {expanded ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CredibilityRing score={credibility} size={20} />
            <span className="truncate text-sm font-medium">{current.title}</span>
            <Badge variant="secondary">{current.clue_type ?? "UNKNOWN"}</Badge>
            <Badge variant="outline">Rel {relevance}</Badge>
          </div>
          {!expanded && (current.bias_corrected_summary || current.summary) && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{current.bias_corrected_summary || current.summary}</p>
          )}
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border/60 px-4 pb-4 pt-4">
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{current.bias_corrected_summary || current.summary || "No summary provided."}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="mb-1 text-xs text-muted-foreground">Credibility</div>
              <div className="flex items-center gap-2">
                <CredibilityRing score={credibility} size={32} />
                <span className="text-sm font-medium">{credibility}/100</span>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="mb-1 text-xs text-muted-foreground">Relevance</div>
              <div className="h-2 rounded-full bg-muted">
                <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, relevance))}%` }} />
              </div>
              <div className="mt-1 text-xs tabular-nums text-muted-foreground">{relevance}/100</div>
            </div>
          </div>

          {keyPoints.length > 0 && (
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="mb-1 text-xs text-muted-foreground">Key points</div>
              <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">{keyPoints.map((point: string, i: number) => <li key={i}>{point}</li>)}</ul>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {(current.party_relevance ?? []).map((item: string) => <Badge key={item} variant="secondary">{item}</Badge>)}
            {(current.domain_tags ?? []).map((item: string) => <Badge key={item} variant="outline">{item}</Badge>)}
            {biasFlags.length > 0 && biasFlags.map((flag: string) => <Badge key={flag} variant="destructive" className="text-[10px]">{labelBias(flag)}</Badge>)}
          </div>

          {(sourceOutlet || sourceUrl || biasNotes || timelineDate) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {sourceOutlet && <div className="rounded-lg border border-border bg-background p-3"><div className="text-xs text-muted-foreground">Source</div><div className="mt-1 text-sm">{sourceOutlet}</div></div>}
              {sourceUrl && <div className="rounded-lg border border-border bg-background p-3"><div className="text-xs text-muted-foreground">URL</div><a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block truncate text-sm text-primary underline">{sourceUrl}</a></div>}
              {biasNotes && <div className="rounded-lg border border-border bg-background p-3"><div className="text-xs text-muted-foreground">Bias notes</div><div className="mt-1 text-sm text-muted-foreground">{biasNotes}</div></div>}
              {timelineDate && <div className="rounded-lg border border-border bg-background p-3"><div className="text-xs text-muted-foreground">Date</div><div className="mt-1 text-sm">{timelineDate}</div></div>}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onEdit}><PencilLine className="size-4" /> Edit</Button>
            <Button variant="outline" size="sm" onClick={onSmartEdit}><ArrowRight className="size-4" /> Smart edit</Button>
            <Button variant="destructive" size="sm" onClick={onDelete}><Trash2 className="size-4" /> Delete</Button>
          </div>
        </div>
      )}
    </div>
  )
}



function EditClueCard({ clue, onSave, onCancel }: { clue: Clue; onSave: (patch: Record<string, unknown>) => void; onCancel: () => void }) {
  const current = getCurrent(clue)
  const [draft, setDraft] = useState({ summary: current.bias_corrected_summary ?? current.summary ?? "", credibility: Number(current.source_credibility?.score ?? 0), relevance: Number(current.relevance_score ?? 0), bias_flags: [...(current.source_credibility?.bias_flags ?? [])] })

  useEffect(() => {
    setDraft({ summary: current.bias_corrected_summary ?? current.summary ?? "", credibility: Number(current.source_credibility?.score ?? 0), relevance: Number(current.relevance_score ?? 0), bias_flags: [...(current.source_credibility?.bias_flags ?? [])] })
  }, [current.bias_corrected_summary, current.relevance_score, current.source_credibility?.bias_flags, current.source_credibility?.score, current.summary])

  const toggleBias = (flag: string) => setDraft((prev) => ({ ...prev, bias_flags: prev.bias_flags.includes(flag) ? prev.bias_flags.filter((item) => item !== flag) : [...prev.bias_flags, flag] }))

  return <Card className="border-border bg-card">
    <CardHeader><CardTitle className="text-base">Edit clue</CardTitle><CardDescription>Update summary, credibility, relevance, and bias flags.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <div className="space-y-2"><div className="flex items-center justify-between text-sm"><span>Credibility</span><span>{draft.credibility}</span></div><Slider value={[draft.credibility]} min={0} max={100} onValueChange={([value]) => setDraft((prev) => ({ ...prev, credibility: value ?? prev.credibility }))} /></div>
      <div className="space-y-2"><div className="flex items-center justify-between text-sm"><span>Relevance</span><span>{draft.relevance}</span></div><Slider value={[draft.relevance]} min={0} max={100} onValueChange={([value]) => setDraft((prev) => ({ ...prev, relevance: value ?? prev.relevance }))} /></div>
      <div className="space-y-2"><div className="text-sm">Bias flags</div><div className="flex flex-wrap gap-2">{BIAS_OPTIONS.map((flag) => <Button key={flag} type="button" variant={draft.bias_flags.includes(flag) ? "default" : "outline"} size="sm" onClick={() => toggleBias(flag)}>{labelBias(flag)}</Button>)}</div></div>
      <div className="space-y-2"><div className="text-sm">Summary</div><Textarea value={draft.summary} onChange={(e) => setDraft((prev) => ({ ...prev, summary: e.target.value }))} className="min-h-28" /></div>
      <div className="flex gap-2"><Button onClick={() => onSave({ bias_corrected_summary: draft.summary, credibility_score: draft.credibility, relevance_score: draft.relevance, bias_flags: draft.bias_flags })}>Save</Button><Button variant="outline" onClick={onCancel}>Cancel</Button></div>
    </CardContent>
  </Card>
}

function BulkImportDialog({ topicId, open, onOpenChange, onImported }: { topicId: string; open: boolean; onOpenChange: (open: boolean) => void; onImported: () => void }) {
  const [content, setContent] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Bulk import clues</DialogTitle><DialogDescription>Paste research notes or mixed text to extract multiple clues.</DialogDescription></DialogHeader><Textarea value={content} onChange={(e) => setContent(e.target.value)} className="min-h-64" placeholder="Paste text here..." />{error && <p className="text-sm text-destructive">{error}</p>}<DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={busy || !content.trim()} onClick={async () => { setBusy(true); setError(null); try { await api.clues.bulkImportStart(topicId, content); onImported(); onOpenChange(false); } catch (err) { setError(err instanceof Error ? err.message : "Bulk import failed") } finally { setBusy(false) } }}>{busy ? "Importing..." : "Import"}</Button></DialogFooter></DialogContent></Dialog>
}

interface CluesPanelProps { topicId: string }

export function CluesPanel({ topicId }: CluesPanelProps) {
  const [clues, setClues] = useState<Clue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [filters, setFilters] = useState({ party: "all", domain: "all", type: "all" })
  const [editingClue, setEditingClue] = useState<Clue | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [researchError] = useState<string | null>(null)
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Clue | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [smartEditClue, setSmartEditClue] = useState<Clue | null>(null)
  const [smartEditFeedback, setSmartEditFeedback] = useState("")
  const [smartEditBusy, setSmartEditBusy] = useState(false)
  const startOp = usePipelineStore((s) => s.startOperation)
  const finishOp = usePipelineStore((s) => s.finishOperation)


  const load = useCallback(async () => { setLoading(true); setError(null); try { setClues(await api.clues.list(topicId)) } catch (err) { setError(err instanceof Error ? err.message : "Failed to load clues") } finally { setLoading(false) } }, [topicId])
  useEffect(() => { void load() }, [load])

  const options = useMemo(() => ({ parties: getParties(clues), domains: getDomains(clues), types: getTypes(clues) }), [clues])
  const filtered = useMemo(() => clues.filter((clue) => clueMatchesFilters(clue, { party: filters.party === "all" ? "" : filters.party, domain: filters.domain === "all" ? "" : filters.domain, type: filters.type === "all" ? "" : filters.type }) && matchesQuery(clue, search.trim())), [clues, filters, search])
  const clueCount = clues.length

  const saveClue = async (patch: Record<string, unknown>) => {
    if (!editingClue) return
    try { const updated = await api.clues.update(topicId, editingClue.id, patch); setClues((prev) => prev.map((item) => item.id === editingClue.id ? updated : item)); setEditingClue(null) } catch (err) { setError(err instanceof Error ? err.message : "Failed to save clue") }
  }

  const handleSmartEdit = async () => {
    if (!smartEditClue || !smartEditFeedback.trim()) return
    setSmartEditBusy(true)
    setSmartEditClue(null)
    startOp(topicId, "smart-edit", `Smart edit: ${getCurrent(smartEditClue).title}`)
    try {
      const updated = await api.clues.smartEdit(topicId, smartEditClue.id, smartEditFeedback.trim())
      setClues((prev) => prev.map((item) => item.id === smartEditClue.id ? updated : item))
      setSmartEditFeedback("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Smart-edit failed")
    } finally {
      finishOp()
      setSmartEditBusy(false)
    }
  }

  const cleanup = async () => {
    setCleanupBusy(true); setError(null)
    try { await api.clues.cleanupStart(topicId); await load() } catch (err) { setError(err instanceof Error ? err.message : "Cleanup failed") } finally { setCleanupBusy(false) }
  }

  return <div className="space-y-4 text-foreground">
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm lg:flex-row lg:items-end lg:justify-between">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Evidence</h2>
          <Badge variant="secondary">{clueCount}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">Search, filter, inspect, and refine clues.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setBulkOpen(true)}><MessageSquarePlus className="size-4" /> Bulk import</Button>
        <Button variant="outline" onClick={cleanup} disabled={cleanupBusy}><RefreshCw className={cn("size-4", cleanupBusy && "animate-spin")} /> Cleanup</Button>
      </div>
    </div>

    <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-5">
      <div className="relative xl:col-span-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search evidence" className="pl-9" />
      </div>
      <Select value={filters.party} onValueChange={(value) => setFilters((prev) => ({ ...prev, party: value }))}><SelectTrigger><SelectValue placeholder="Party" /></SelectTrigger><SelectContent><SelectItem value="all">All parties</SelectItem>{options.parties.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
      <Select value={filters.domain} onValueChange={(value) => setFilters((prev) => ({ ...prev, domain: value }))}><SelectTrigger><SelectValue placeholder="Domain" /></SelectTrigger><SelectContent><SelectItem value="all">All domains</SelectItem>{options.domains.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
      <Select value={filters.type} onValueChange={(value) => setFilters((prev) => ({ ...prev, type: value }))}><SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem>{options.types.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
    </div>

    {researchError && <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{researchError}</div>}
    {error && <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

    {loading ? (
      <div className="py-10 text-center text-sm text-muted-foreground">Loading clues...</div>
    ) : filtered.length === 0 ? (
      <Card className="border-dashed"><CardContent className="py-10 text-center text-sm text-muted-foreground">{clues.length === 0 ? "No clues yet. Use Bulk import or Research to add evidence." : "No clues match the current filters."}</CardContent></Card>
    ) : (
      <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-4">
        {filtered.map((clue) => <ClueCard key={clue.id} clue={clue} expanded={expandedId === clue.id} onToggleExpanded={() => setExpandedId(expandedId === clue.id ? null : clue.id)} onEdit={() => setEditingClue(clue)} onSmartEdit={() => { setSmartEditClue(clue); setSmartEditFeedback("") }} onDelete={() => setDeleteTarget(clue)} />)}
      </div>
    )}

    <Dialog open={Boolean(smartEditClue)} onOpenChange={(open) => !open && setSmartEditClue(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Smart edit</DialogTitle>
          <DialogDescription>Give feedback for {smartEditClue ? getCurrent(smartEditClue).title : ""}.</DialogDescription>
        </DialogHeader>
        <Textarea value={smartEditFeedback} onChange={(e) => setSmartEditFeedback(e.target.value)} placeholder="What should change?" className="min-h-28" />
        <DialogFooter>
          <Button variant="outline" onClick={() => setSmartEditClue(null)}>Cancel</Button>
          <Button onClick={() => void handleSmartEdit()} disabled={!smartEditFeedback.trim() || smartEditBusy}>{smartEditBusy ? "Applying..." : "Apply"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {editingClue && <Dialog open={!!editingClue} onOpenChange={(open) => !open && setEditingClue(null)}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Edit clue</DialogTitle><DialogDescription>Update summary, credibility, relevance, and bias flags.</DialogDescription></DialogHeader><EditClueCard clue={editingClue} onSave={saveClue} onCancel={() => setEditingClue(null)} /></DialogContent></Dialog>}
    {deleteTarget && <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}><DialogContent><DialogHeader><DialogTitle>Delete clue?</DialogTitle><DialogDescription>This action cannot be undone.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button><Button variant="destructive" onClick={async () => { if (!deleteTarget) return; try { await api.clues.delete(topicId, deleteTarget.id); setClues((prev) => prev.filter((item) => item.id !== deleteTarget.id)); setDeleteTarget(null) } catch (err) { setError(err instanceof Error ? err.message : "Failed to delete clue") } }}>Delete</Button></DialogFooter></DialogContent></Dialog>}
    <BulkImportDialog topicId={topicId} open={bulkOpen} onOpenChange={setBulkOpen} onImported={load} />
  </div>
}
