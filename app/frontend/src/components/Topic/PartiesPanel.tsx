import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, ChevronDown, ChevronUp, Pencil, Plus, RotateCcw, Trash2, Workflow } from "lucide-react"
import { api } from "@/api/client"
import { RadarChart } from "@/components/Common/RadarChart"
import { ConfirmationBanner } from "@/components/Topic/ConfirmationBanner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { partyColor } from "@/utils/partyColor"

interface WeightFactors {
  military_capacity: number
  economic_control: number
  information_control: number
  international_support: number
  internal_legitimacy: number
}

interface Party {
  id: string
  name: string
  type: string
  description: string
  weight: number
  weight_factors: WeightFactors
  agenda: string
  means: string[]
  circle: { visible: string[]; shadow: string[] }
  stance: string
  vulnerabilities: string[]
  auto_discovered: boolean
  user_verified: boolean
}

const WEIGHT_FACTORS: { key: keyof WeightFactors; label: string }[] = [
  { key: "military_capacity", label: "Military" },
  { key: "economic_control", label: "Economic" },
  { key: "information_control", label: "Information" },
  { key: "international_support", label: "Intl Support" },
  { key: "internal_legitimacy", label: "Legitimacy" },
]

type EditableFieldKey = "agenda" | "means" | "stance" | "vulnerabilities" | "circle"

function WeightBar({ label, value, color }: { label: string; value: number; color?: string }) {
  return <div className="flex items-center gap-2 text-xs"><span className="w-24 shrink-0 text-muted-foreground">{label}</span><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${value}%`, backgroundColor: color ?? "hsl(var(--primary))" }} /></div><span className="w-8 tabular-nums text-right text-muted-foreground">{value}</span></div>
}

function tagText(value: string[] | undefined) {
  return (value ?? []).join(", ")
}

function PartyCard({
  party, onDelete, onUpdate, selected, onToggleSelect, onSplit, onSmartEdit,
}: {
  party: Party
  onDelete: (id: string) => void
  onUpdate: (id: string, data: Partial<Party>) => void
  selected: boolean
  onToggleSelect: (id: string) => void
  onSplit: (party: Party) => void
  onSmartEdit: (party: Party) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editingField, setEditingField] = useState<EditableFieldKey | null>(null)
  const [draft, setDraft] = useState<Party>(party)
  useEffect(() => setDraft(party), [party])
  const color = partyColor(party.name)
  const save = async () => { await onUpdate(party.id, draft); setEditingField(null) }
  const cancel = () => { setDraft(party); setEditingField(null) }

  return (
    <Card className={cn("overflow-hidden border-border transition-shadow hover:shadow-md", selected && "ring-1 ring-primary/40")}>
      <CardHeader className="gap-3 border-b bg-card/40">
        <div className="flex items-start justify-between gap-3">
          <button className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => setExpanded(v => !v)}>
            <div className="mt-1 size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <div className="min-w-0">
              <CardTitle className="truncate text-base">{party.name}</CardTitle>
              <CardDescription className="mt-1">{party.description || "No description"}</CardDescription>
            </div>
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <input type="checkbox" checked={selected} onChange={() => onToggleSelect(party.id)} />
            <Badge variant="outline">{party.type.replace(/_/g, " ")}</Badge>
            <Badge>{party.weight}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setExpanded(v => !v)}>{expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}Details</Button>
          <Button variant="outline" size="sm" onClick={() => { setDraft(party); setEditingField("agenda") }}><Pencil className="size-4" />Edit</Button>
          <Button variant="outline" size="sm" onClick={() => onSmartEdit(party)}><Workflow className="size-4" />Smart edit</Button>
          <Button variant="outline" size="sm" onClick={() => onSplit(party)}><RotateCcw className="size-4" />Split</Button>
          <Button variant="destructive" size="sm" onClick={() => onDelete(party.id)}><Trash2 className="size-4" />Delete</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start gap-4">
          <RadarChart data={party.weight_factors as unknown as Record<string, number>} size={96} color={color} />
          <div className="flex-1 space-y-2">
            {WEIGHT_FACTORS.map((wf) => <WeightBar key={wf.key} label={wf.label} value={party.weight_factors[wf.key] ?? 0} color={color} />)}
          </div>
        </div>
        {expanded && (
          <div className="grid gap-3 md:grid-cols-2">
            {(["agenda", "means", "stance", "vulnerabilities", "circle"] as const).map((field) => (
              <FieldRow key={field} field={field} party={party} draft={draft} editingField={editingField} setEditingField={setEditingField} setDraft={setDraft} />
            ))}
          </div>
        )}
        {editingField && <div className="flex gap-2"><Button onClick={save} size="sm">Save</Button><Button variant="outline" onClick={cancel} size="sm">Cancel</Button></div>}
      </CardContent>
    </Card>
  )
}

function FieldRow({ field, party, draft, editingField, setEditingField, setDraft }: any) {
  const editing = editingField === field
  const value = editing ? draft[field] : party[field]
  return <Card className="gap-2 p-3"><div className="flex items-center justify-between gap-2"><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{field}</div><Button variant="ghost" size="sm" onClick={() => setEditingField(field)}><Pencil className="size-4" /></Button></div>{editing ? <Textarea value={typeof value === "string" ? value : JSON.stringify(value, null, 2)} onChange={(e) => setDraft((d: Party) => ({ ...d, [field]: e.target.value } as Party))} /> : <div className="text-sm text-foreground">{typeof value === "string" ? value : tagText((value as any)?.visible ?? value)}</div>}</Card>
}

interface PartiesPanelProps {
  topicId: string
  status: string
  onApprove?: () => void
  approveLoading?: boolean
}

export function PartiesPanel({ topicId, status, onApprove, approveLoading }: PartiesPanelProps) {
  const [parties, setParties] = useState<Party[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState("")
  const [addBusy, setAddBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [smartEditParty, setSmartEditParty] = useState<Party | null>(null)
  const [splitParty, setSplitParty] = useState<Party | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeBusy, setMergeBusy] = useState(false)
  const [smartFeedback, setSmartFeedback] = useState("")
  const [splitNames, setSplitNames] = useState(["", ""])

  const reviewMode = status === "review_parties"

  const load = useCallback(() => {
    setLoading(true)
    api.parties.list(topicId).then((d) => { setParties(d); setError(null) }).catch((e) => setError(e instanceof Error ? e.message : "Failed to load parties")).finally(() => setLoading(false))
  }, [topicId])

  useEffect(load, [load])

  const handleUpdate = async (id: string, data: Partial<Party>) => { await api.parties.update(topicId, id, data); setParties((current) => current.map((party) => party.id === id ? { ...party, ...data } : party)) }
  const handleDelete = async (id: string) => { await api.parties.delete(topicId, id); setParties((ps) => ps.filter((p) => p.id !== id)) }
  const handleSmartAdd = async () => {
    if (!newName.trim()) return
    setAddBusy(true)
    try { const party = await api.parties.smartAdd(topicId, newName.trim()); setParties((ps) => [...ps, party]); setShowAdd(false); setNewName("") } catch (e) { setError(e instanceof Error ? e.message : "Smart add failed") } finally { setAddBusy(false) }
  }
  const handleSmartEdit = async () => { if (!smartEditParty || !smartFeedback.trim()) return; await api.parties.smartEdit(topicId, smartEditParty.id, smartFeedback); setSmartEditParty(null); setSmartFeedback(""); load() }
  const handleSplit = async () => { if (!splitParty) return; await api.parties.split(topicId, splitParty.id, splitNames.filter((n) => n.trim()).map((name) => ({ name }))); setSplitParty(null); setSplitNames(["", ""]); load() }
  const handleMerge = async () => { const ids = [...selected]; if (ids.length < 2) return; setMergeBusy(true); try { await api.parties.merge(topicId, ids, { name: ids.map((id) => parties.find((p) => p.id === id)?.name).filter(Boolean).join(" / ") }); setSelected(new Set()); setMergeOpen(false); load() } finally { setMergeBusy(false) } }
  const selectedCount = selected.size
  const sortedParties = useMemo(() => [...parties].sort((a, b) => b.weight - a.weight), [parties])

  if (loading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading parties…</div>

  return (
    <div className="space-y-4">
      {reviewMode && onApprove && (
        <ConfirmationBanner message={`Review ${parties.length} parties before continuing analysis.`} detail="Merge duplicates, edit fields, or remove incorrect parties." actionLabel="Continue Analysis" onConfirm={onApprove} loading={approveLoading} />
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><h2 className="text-sm font-semibold">Parties</h2><Badge variant="secondary">{parties.length}</Badge></div>
        <div className="flex gap-2">
          {selectedCount >= 2 && <Button variant="secondary" onClick={() => setMergeOpen(true)}>Merge selected</Button>}
          <Button onClick={() => setShowAdd(true)}><Plus className="size-4" />Smart add</Button>
        </div>
      </div>
      {error && <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"><AlertCircle className="size-4" />{error}</div>}
      {sortedParties.length === 0 ? <Card className="border-dashed"><CardContent className="p-8 text-center text-sm text-muted-foreground">No parties found yet.</CardContent></Card> : <div className="max-h-[70vh] space-y-3 overflow-auto pr-2">{sortedParties.map((party) => <PartyCard key={party.id} party={party} onDelete={handleDelete} onUpdate={handleUpdate} selected={selected.has(party.id)} onToggleSelect={(id) => setSelected((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next })} onSplit={setSplitParty} onSmartEdit={setSmartEditParty} />)}</div>}

      <Dialog open={showAdd} onOpenChange={setShowAdd}><DialogContent><DialogHeader><DialogTitle>Smart add party</DialogTitle><DialogDescription>Enter a party name and let the backend generate a full profile.</DialogDescription></DialogHeader><div className="space-y-2"><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Party name" /></div><DialogFooter><Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleSmartAdd} disabled={addBusy}>{addBusy ? "Adding..." : "Add"}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={!!smartEditParty} onOpenChange={(open) => !open && setSmartEditParty(null)}><DialogContent><DialogHeader><DialogTitle>Smart edit</DialogTitle><DialogDescription>Provide feedback for {smartEditParty?.name}.</DialogDescription></DialogHeader><Textarea value={smartFeedback} onChange={(e) => setSmartFeedback(e.target.value)} placeholder="What should change?" /><DialogFooter><Button variant="outline" onClick={() => setSmartEditParty(null)}>Cancel</Button><Button onClick={handleSmartEdit}>Apply</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={!!splitParty} onOpenChange={(open) => !open && setSplitParty(null)}><DialogContent><DialogHeader><DialogTitle>Split party</DialogTitle><DialogDescription>Split {splitParty?.name} into multiple parties.</DialogDescription></DialogHeader><div className="space-y-2">{splitNames.map((name, idx) => <Input key={idx} value={name} onChange={(e) => setSplitNames((curr) => curr.map((v, i) => i === idx ? e.target.value : v))} placeholder={`Sub-party ${idx + 1}`} />)}</div><DialogFooter><Button variant="outline" onClick={() => setSplitParty(null)}>Cancel</Button><Button onClick={handleSplit}>Split</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}><DialogContent><DialogHeader><DialogTitle>Merge parties</DialogTitle><DialogDescription>Merge {selectedCount} selected parties.</DialogDescription></DialogHeader><div className="space-y-2">{[...selected].map((id) => <div key={id} className="rounded-md border p-2 text-sm">{parties.find((p) => p.id === id)?.name}</div>)}</div><DialogFooter><Button variant="outline" onClick={() => setMergeOpen(false)}>Cancel</Button><Button onClick={handleMerge} disabled={mergeBusy}>{mergeBusy ? "Merging..." : "Merge"}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  )
}
