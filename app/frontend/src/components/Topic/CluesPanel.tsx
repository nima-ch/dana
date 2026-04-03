"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowRight, BadgeInfo, MessageSquarePlus, PencilLine, RefreshCw, Search, Trash2 } from "lucide-react"
import { api } from "@/api/client"
import { CredibilityRing } from "../Common/CredibilityRing"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

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

function ClueDetailSheet({ clue, open, onOpenChange }: { clue: Clue | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const current = clue ? getCurrent(clue) : null
  if (!clue || !current) return null
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{current.title}</SheetTitle>
          <SheetDescription>{safeText(current.timeline_date) || "Evidence details"}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-4 overflow-y-auto">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{current.clue_type ?? "Unknown"}</Badge>
            <Badge variant="outline">Relevance {Math.round(current.relevance_score ?? 0)}</Badge>
            {current.source_credibility?.bias_flags?.includes("bias_corrected") && <Badge>bias_corrected</Badge>}
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
            <CredibilityRing score={Number(current.source_credibility?.score ?? 0)} size={42} />
            <div>
              <div className="text-sm font-medium text-foreground">Credibility</div>
              <div className="text-sm text-muted-foreground">Score {Number(current.source_credibility?.score ?? 0)}</div>
            </div>
          </div>
          <div>
            <div className="text-sm font-medium text-foreground">Summary</div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{current.bias_corrected_summary || current.summary || "No summary provided."}</p>
          </div>
          <Separator />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Parties" value={(current.party_relevance ?? []).join(", ") || "—"} />
            <Field label="Domains" value={(current.domain_tags ?? []).join(", ") || "—"} />
            <Field label="Source" value={current.source_credibility?.origin_source?.outlet || current.source_credibility?.origin_source?.url || "—"} />
            <Field label="Bias notes" value={current.source_credibility?.notes || "—"} />
          </div>
          {!!current.source_credibility?.bias_flags?.length && (
            <div className="flex flex-wrap gap-2">
              {current.source_credibility.bias_flags.map((flag: string) => <Badge key={flag} variant="destructive">{labelBias(flag)}</Badge>)}
            </div>
          )}
          {!!current.key_points?.length && (
            <div>
              <div className="text-sm font-medium">Key points</div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{current.key_points.map((point: string, i: number) => <li key={i}>{point}</li>)}</ul>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border bg-background p-3"><div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-sm text-foreground">{value}</div></div>
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

interface CluesPanelProps { topicId: string; status: string; onApprove?: () => void; onReanalyze?: () => void; approveLoading?: boolean }

export function CluesPanel({ topicId, status, onApprove, onReanalyze, approveLoading }: CluesPanelProps) {
  const [clues, setClues] = useState<Clue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [filters, setFilters] = useState({ party: "all", domain: "all", type: "all" })
  const [selectedClue, setSelectedClue] = useState<Clue | null>(null)
  const [editingClue, setEditingClue] = useState<Clue | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [researchQuery, setResearchQuery] = useState("")
  const [researchBusy, setResearchBusy] = useState(false)
  const [researchError, setResearchError] = useState<string | null>(null)
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Clue | null>(null)
  const reviewMode = status === "review_enrichment"

  const load = useCallback(async () => { setLoading(true); setError(null); try { setClues(await api.clues.list(topicId)) } catch (err) { setError(err instanceof Error ? err.message : "Failed to load clues") } finally { setLoading(false) } }, [topicId])
  useEffect(() => { void load() }, [load])

  const options = useMemo(() => ({ parties: getParties(clues), domains: getDomains(clues), types: getTypes(clues) }), [clues])
  const filtered = useMemo(() => clues.filter((clue) => clueMatchesFilters(clue, { party: filters.party === "all" ? "" : filters.party, domain: filters.domain === "all" ? "" : filters.domain, type: filters.type === "all" ? "" : filters.type }) && matchesQuery(clue, search.trim())), [clues, filters, search])
  const clueCount = clues.length

  const saveClue = async (patch: Record<string, unknown>) => {
    if (!editingClue) return
    try { const updated = await api.clues.update(topicId, editingClue.id, patch); setClues((prev) => prev.map((item) => item.id === editingClue.id ? updated : item)); setEditingClue(null) } catch (err) { setError(err instanceof Error ? err.message : "Failed to save clue") }
  }

  const smartEdit = async (clue: Clue) => {
    const feedback = window.prompt("Describe the edit you want applied:")
    if (!feedback?.trim()) return
    try { const updated = await api.clues.smartEdit(topicId, clue.id, feedback); setClues((prev) => prev.map((item) => item.id === clue.id ? updated : item)) } catch (err) { setError(err instanceof Error ? err.message : "Smart-edit failed") }
  }

  const research = async () => {
    if (!researchQuery.trim()) return
    setResearchBusy(true); setResearchError(null)
    try { await api.clues.research(topicId, researchQuery.trim()); await load(); setResearchQuery("") } catch (err) { setResearchError(err instanceof Error ? err.message : "Research failed") } finally { setResearchBusy(false) }
  }

  const cleanup = async () => {
    setCleanupBusy(true); setError(null)
    try { await api.clues.cleanupStart(topicId); await load() } catch (err) { setError(err instanceof Error ? err.message : "Cleanup failed") } finally { setCleanupBusy(false) }
  }

  const evidenceTabBadge = <Badge variant="secondary">{clueCount}</Badge>

  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Evidence</h2>
        <p className="text-sm text-muted-foreground">Search, filter, inspect, and refine clues.</p>
      </div>
      {evidenceTabBadge}
    </div>

    {reviewMode && <Card className="border-amber-500/30 bg-amber-500/10"><CardContent className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="flex items-center gap-2 text-amber-900"><BadgeInfo className="size-4" /><span className="font-medium">Review enrichment is active.</span></div><Button onClick={onApprove ?? onReanalyze} disabled={approveLoading}>Continue Analysis</Button></CardContent></Card>}

    <Card className="border-border bg-card">
      <CardContent className="space-y-4 pt-6">
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-5">
          <div className="xl:col-span-2"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search evidence by title or summary" /></div>
          <Select value={filters.party} onValueChange={(value) => setFilters((prev) => ({ ...prev, party: value }))}><SelectTrigger><SelectValue placeholder="Party" /></SelectTrigger><SelectContent><SelectItem value="all">All parties</SelectItem>{options.parties.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
          <Select value={filters.domain} onValueChange={(value) => setFilters((prev) => ({ ...prev, domain: value }))}><SelectTrigger><SelectValue placeholder="Domain" /></SelectTrigger><SelectContent><SelectItem value="all">All domains</SelectItem>{options.domains.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
          <Select value={filters.type} onValueChange={(value) => setFilters((prev) => ({ ...prev, type: value }))}><SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem>{options.types.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setBulkOpen(true)}><MessageSquarePlus className="size-4" /> Bulk import</Button>
          <Button variant="outline" onClick={research} disabled={researchBusy}><Search className="size-4" /> Research</Button>
          <Input value={researchQuery} onChange={(e) => setResearchQuery(e.target.value)} placeholder="Research query" className="max-w-md" />
          <Button variant="outline" onClick={cleanup} disabled={cleanupBusy}><RefreshCw className={cn("size-4", cleanupBusy && "animate-spin")} /> Cleanup</Button>
        </div>
        {researchError && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{researchError}</div>}
        {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        <Separator />
        {loading ? <div className="text-sm text-muted-foreground">Loading clues…</div> : filtered.length === 0 ? <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{clues.length === 0 ? "No clues yet." : "No clues match filters."}</div> : <div className="grid gap-3">{filtered.map((clue) => { const current = getCurrent(clue); return <Card key={clue.id} className="group border-border bg-card transition-colors hover:border-primary/40"><CardContent className="space-y-3 p-4"><button className="w-full text-left" onClick={() => setSelectedClue(clue)}><div className="flex items-start gap-3"><CredibilityRing score={Number(current.source_credibility?.score ?? 0)} size={40} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><CardTitle className="truncate text-base text-foreground">{current.title}</CardTitle><Badge variant="outline">Relevance {Math.round(current.relevance_score ?? 0)}</Badge><Badge variant="secondary">{current.clue_type ?? "UNKNOWN"}</Badge></div><CardDescription className="mt-2 line-clamp-2 text-left">{current.bias_corrected_summary || current.summary || "No summary provided."}</CardDescription><div className="mt-2 flex flex-wrap gap-2">{(current.party_relevance ?? []).map((item: string) => <Badge key={item} variant="secondary">{item}</Badge>)}{(current.domain_tags ?? []).map((item: string) => <Badge key={item} variant="outline">{item}</Badge>)}{current.source_credibility?.bias_flags?.includes("bias_corrected") && <Badge>bias_corrected</Badge>}</div></div></div></button><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => setEditingClue(clue)}><PencilLine className="size-4" /> Edit</Button><Button variant="outline" size="sm" onClick={() => smartEdit(clue)}><ArrowRight className="size-4" /> Smart edit</Button><Button variant="outline" size="sm" onClick={() => setDeleteTarget(clue)}><Trash2 className="size-4" /> Delete</Button></div></CardContent></Card>})}</div>}
      </CardContent>
    </Card>

    {selectedClue && <ClueDetailSheet clue={selectedClue} open={!!selectedClue} onOpenChange={(open) => !open && setSelectedClue(null)} />}
    {editingClue && <Dialog open={!!editingClue} onOpenChange={(open) => !open && setEditingClue(null)}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Edit clue</DialogTitle><DialogDescription>Update summary, credibility, relevance, and bias flags.</DialogDescription></DialogHeader><EditClueCard clue={editingClue} onSave={saveClue} onCancel={() => setEditingClue(null)} /></DialogContent></Dialog>}
    {deleteTarget && <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}><DialogContent><DialogHeader><DialogTitle>Delete clue?</DialogTitle><DialogDescription>This action cannot be undone.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button><Button variant="destructive" onClick={async () => { if (!deleteTarget) return; try { await api.clues.delete(topicId, deleteTarget.id); setClues((prev) => prev.filter((item) => item.id !== deleteTarget.id)); setDeleteTarget(null) } catch (err) { setError(err instanceof Error ? err.message : "Failed to delete clue") } }}>Delete</Button></DialogFooter></DialogContent></Dialog>}
    <BulkImportDialog topicId={topicId} open={bulkOpen} onOpenChange={setBulkOpen} onImported={load} />
  </div>
}
