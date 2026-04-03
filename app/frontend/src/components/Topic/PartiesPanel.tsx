import { useEffect, useState, useCallback } from "react"
import { api } from "../../api/client"
import { ConfirmationBanner } from "./ConfirmationBanner"
import { RadarChart } from "../Common/RadarChart"
import { partyColor } from "../../utils/partyColor"

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

const PARTY_TYPES = ["state", "state_military", "non_state", "individual", "media", "economic", "alliance"]
const STANCES = ["active", "passive", "covert", "overt", "defensive_active"]
const WEIGHT_FACTORS: { key: keyof WeightFactors; label: string }[] = [
  { key: "military_capacity", label: "Military" },
  { key: "economic_control", label: "Economic" },
  { key: "information_control", label: "Information" },
  { key: "international_support", label: "Intl Support" },
  { key: "internal_legitimacy", label: "Legitimacy" },
]

function WeightBar({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-28 shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
        <div
          className="h-1.5 rounded-full transition-all duration-500"
          style={{ width: `${value}%`, backgroundColor: color ?? "#3b82f6", opacity: 0.75 }}
        />
      </div>
      <span className="text-xs text-gray-500 w-6 text-right tabular-nums">{value}</span>
    </div>
  )
}

// Editable tag list
function TagListEditor({ label, tags, onChange }: { label: string; tags: string[]; onChange: (t: string[]) => void }) {
  const [input, setInput] = useState("")
  const add = () => {
    if (input.trim() && !tags.includes(input.trim())) {
      onChange([...tags, input.trim()])
      setInput("")
    }
  }
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      <div className="flex flex-wrap gap-1 mb-1">
        {tags.map((t, i) => (
          <span key={i} className="text-xs bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded flex items-center gap-1">
            {t}
            <button className="text-red-400 hover:text-red-600" onClick={() => onChange(tags.filter((_, j) => j !== i))}>x</button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input className="flex-1 text-xs border border-gray-300 rounded px-2 py-0.5"
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder={`Add ${label.toLowerCase()}...`} />
        <button className="text-xs text-blue-500" onClick={add}>+</button>
      </div>
    </div>
  )
}

function PartyCard({
  party, topicId, onDelete, onUpdate, onReload, selected, onToggleSelect,
}: {
  party: Party
  topicId: string
  onDelete: (id: string) => void
  onUpdate: (id: string, data: Partial<Party>) => void
  onReload: () => void
  reviewMode?: boolean
  selected: boolean
  onToggleSelect: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [smartEditing, setSmartEditing] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [feedback, setFeedback] = useState("")
  const [splitNames, setSplitNames] = useState(["", ""])
  const [busy, setBusy] = useState("")
  const [draft, setDraft] = useState<Party>({ ...party })

  // Reset draft when party changes
  useEffect(() => { setDraft({ ...party }) }, [party])

  const weightColor = party.weight >= 70 ? "bg-red-100 text-red-700"
    : party.weight >= 40 ? "bg-yellow-100 text-yellow-700"
    : "bg-gray-100 text-gray-600"

  const handleSave = () => {
    const { id: _id, auto_discovered: _auto_discovered, user_verified: _user_verified, ...fields } = draft
    onUpdate(party.id, fields)
    setEditing(false)
  }

  const handleSmartEdit = async () => {
    if (!feedback.trim()) return
    setBusy("Researching...")
    try {
      await api.parties.smartEdit(topicId, party.id, feedback)
      setFeedback("")
      setSmartEditing(false)
      onReload()
    } catch (e) {
      alert(`Smart edit failed: ${e}`)
    }
    setBusy("")
  }

  const handleSplit = async () => {
    const names = splitNames.filter(n => n.trim())
    if (names.length < 2) return
    setBusy("Splitting...")
    try {
      await api.parties.split(topicId, party.id, names.map(n => ({ name: n })))
      setSplitting(false)
      onReload()
    } catch (e) {
      alert(`Split failed: ${e}`)
    }
    setBusy("")
  }

  const color = partyColor(party.name)

  return (
    <div
      className={`bg-white border rounded-xl p-4 space-y-2 transition-shadow hover:shadow-sm ${selected ? "border-amber-400 ring-1 ring-amber-200" : "border-gray-200"}`}
      style={{ borderLeftWidth: 3, borderLeftColor: color }}
    >
      {busy && (
        <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 rounded px-3 py-1.5">
          <div className="animate-spin w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full" />
          {busy}
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <input type="checkbox" className="mt-1 shrink-0" checked={selected}
            onChange={() => onToggleSelect(party.id)} />
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-3">
                {/* Name + Type */}
                <div className="flex gap-2">
                  <input className="flex-1 text-sm font-medium border border-gray-300 rounded px-2 py-1"
                    value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
                  <select className="text-xs border border-gray-300 rounded px-2 py-1"
                    value={draft.type} onChange={e => setDraft(d => ({ ...d, type: e.target.value }))}>
                    {PARTY_TYPES.map(t => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
                  </select>
                </div>
                {/* Description */}
                <div>
                  <label className="text-xs text-gray-500 block mb-0.5">Description</label>
                  <textarea className="w-full text-xs border border-gray-300 rounded px-2 py-1 h-20"
                    value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} />
                </div>
                {/* Agenda */}
                <div>
                  <label className="text-xs text-gray-500 block mb-0.5">Agenda</label>
                  <textarea className="w-full text-xs border border-gray-300 rounded px-2 py-1 h-12"
                    value={draft.agenda} onChange={e => setDraft(d => ({ ...d, agenda: e.target.value }))} />
                </div>
                {/* Stance */}
                <div>
                  <label className="text-xs text-gray-500 block mb-0.5">Stance</label>
                  <select className="text-xs border border-gray-300 rounded px-2 py-1"
                    value={draft.stance} onChange={e => setDraft(d => ({ ...d, stance: e.target.value }))}>
                    {STANCES.map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                  </select>
                </div>
                {/* Weight + Weight Factors */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Overall Weight: {draft.weight}</label>
                  <input type="range" min={0} max={100} value={draft.weight}
                    className="w-full h-1.5 accent-blue-600"
                    onChange={e => setDraft(d => ({ ...d, weight: parseInt(e.target.value) }))} />
                </div>
                <div className="space-y-1">
                  {WEIGHT_FACTORS.map(wf => (
                    <div key={wf.key} className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-24 shrink-0">{wf.label}: {draft.weight_factors[wf.key]}</span>
                      <input type="range" min={0} max={100} value={draft.weight_factors[wf.key]}
                        className="flex-1 h-1 accent-blue-600"
                        onChange={e => setDraft(d => ({
                          ...d,
                          weight_factors: { ...d.weight_factors, [wf.key]: parseInt(e.target.value) },
                        }))} />
                    </div>
                  ))}
                </div>
                {/* Means */}
                <TagListEditor label="Means" tags={draft.means}
                  onChange={means => setDraft(d => ({ ...d, means }))} />
                {/* Circle */}
                <TagListEditor label="Circle: Visible" tags={draft.circle?.visible ?? []}
                  onChange={visible => setDraft(d => ({ ...d, circle: { ...d.circle, visible } }))} />
                <TagListEditor label="Circle: Shadow" tags={draft.circle?.shadow ?? []}
                  onChange={shadow => setDraft(d => ({ ...d, circle: { ...d.circle, shadow } }))} />
                {/* Vulnerabilities */}
                <TagListEditor label="Vulnerabilities" tags={draft.vulnerabilities}
                  onChange={vulnerabilities => setDraft(d => ({ ...d, vulnerabilities }))} />
                {/* Save/Cancel */}
                <div className="flex gap-2 pt-1">
                  <button className="text-xs px-3 py-1 bg-blue-600 text-white rounded" onClick={handleSave}>Save</button>
                  <button className="text-xs text-gray-400" onClick={() => { setEditing(false); setDraft({ ...party }) }}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="font-semibold text-sm text-gray-900">{party.name}</span>
                  <span className="text-xs text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{party.type.replace(/_/g, " ")}</span>
                  {party.user_verified && <span className="text-xs bg-green-50 text-green-600 px-1.5 py-0.5 rounded">✓ verified</span>}
                </div>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{party.description}</p>
              </>
            )}
          </div>
        </div>
        {!editing && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button title="Weight breakdown"
              className={`text-xs px-2 py-0.5 rounded font-medium cursor-pointer ${weightColor}`}
              onClick={() => setExpanded(e => !e)}>
              {party.weight}
            </button>
            <button className="text-xs text-blue-400 hover:text-blue-600" onClick={() => setEditing(true)}>edit</button>
            <button className="text-xs text-purple-400 hover:text-purple-600" onClick={() => setSmartEditing(s => !s)}
              title="AI-assisted edit with feedback">smart</button>
            <button className="text-xs text-amber-400 hover:text-amber-600" onClick={() => setSplitting(s => !s)}
              title="Split into sub-parties">split</button>
            <button className="text-xs text-red-400 hover:text-red-600" onClick={() => onDelete(party.id)}>✕</button>
          </div>
        )}
      </div>

      {/* Smart edit feedback area */}
      {smartEditing && !editing && (
        <div className="border-t border-gray-100 pt-2 space-y-2">
          <p className="text-xs text-gray-500">Describe what needs to change. The system will research and update automatically.</p>
          <textarea className="w-full text-xs border border-gray-300 rounded px-2 py-1 h-16"
            placeholder="e.g. 'Their military capacity increased significantly after the 2026 arms deal with Russia...'"
            value={feedback} onChange={e => setFeedback(e.target.value)} />
          <div className="flex gap-2">
            <button className="text-xs px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
              onClick={handleSmartEdit} disabled={!!busy || !feedback.trim()}>
              {busy ? "Researching..." : "Research & Update"}
            </button>
            <button className="text-xs text-gray-400" onClick={() => { setSmartEditing(false); setFeedback("") }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Split dialog */}
      {splitting && !editing && (
        <div className="border-t border-gray-100 pt-2 space-y-2">
          <p className="text-xs text-gray-500">Split "{party.name}" into separate parties. Enter names for each sub-party.</p>
          {splitNames.map((name, i) => (
            <div key={i} className="flex gap-1">
              <input className="flex-1 text-xs border border-gray-300 rounded px-2 py-1"
                placeholder={`Sub-party ${i + 1} name`}
                value={name} onChange={e => setSplitNames(ns => ns.map((n, j) => j === i ? e.target.value : n))} />
              {splitNames.length > 2 && (
                <button className="text-xs text-red-400" onClick={() => setSplitNames(ns => ns.filter((_, j) => j !== i))}>✕</button>
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <button className="text-xs text-blue-500" onClick={() => setSplitNames(ns => [...ns, ""])}>+ Add</button>
            <button className="text-xs px-3 py-1 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
              onClick={handleSplit} disabled={!!busy || splitNames.filter(n => n.trim()).length < 2}>
              {busy ? "Splitting..." : "Split"}
            </button>
            <button className="text-xs text-gray-400" onClick={() => setSplitting(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Read-only details */}
      {!editing && !smartEditing && !splitting && (
        <>
          <p className="text-xs text-gray-600"><span className="font-medium">Agenda:</span> {party.agenda}</p>
          <p className="text-xs text-gray-600"><span className="font-medium">Stance:</span> {party.stance?.replace(/_/g, " ")}</p>

          {party.means?.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {party.means.map((m, i) => (
                <span key={i} className="text-xs bg-blue-50 text-blue-700 px-1.5 rounded">{m}</span>
              ))}
            </div>
          )}

          {(party.circle?.visible?.length > 0 || party.circle?.shadow?.length > 0) && (
            <div className="text-xs space-y-1">
              {party.circle.visible?.length > 0 && (
                <div><span className="text-gray-400">Visible: </span>{party.circle.visible.join(", ")}</div>
              )}
              {party.circle.shadow?.length > 0 && (
                <div><span className="text-gray-400">Shadow: </span>
                  <span className="italic">{party.circle.shadow.join(", ")}</span>
                </div>
              )}
            </div>
          )}

          {expanded && party.weight_factors && (
            <div className="border-t border-gray-100 pt-3 flex items-start gap-4">
              <RadarChart
                data={party.weight_factors as unknown as Record<string, number>}
                size={88}
                color={partyColor(party.name)}
              />
              <div className="flex-1 space-y-1.5">
                {WEIGHT_FACTORS.map(wf => (
                  <WeightBar key={wf.key} label={wf.label} value={party.weight_factors[wf.key] ?? 0} color={partyColor(party.name)} />
                ))}
              </div>
            </div>
          )}

          {party.vulnerabilities?.length > 0 && (
            <div className="text-xs text-gray-500">
              <span className="font-medium">Vulnerabilities:</span> {party.vulnerabilities.join("; ")}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Merge dialog
function MergeDialog({
  parties, onMerge, onCancel, loading,
}: { parties: Party[]; onMerge: (name: string) => void; onCancel: () => void; loading: boolean }) {
  const [name, setName] = useState(parties.map(p => p.name).join(" / "))

  return (
    <div className="bg-white border border-amber-300 rounded-lg p-4 space-y-3">
      <p className="text-sm font-medium text-gray-800">Smart Merge {parties.length} parties</p>
      <p className="text-xs text-gray-500">
        Merging: {parties.map(p => p.name).join(", ")}
      </p>
      <p className="text-xs text-gray-400">
        The system will use AI to synthesize descriptions, agendas, means, and weight factors into a coherent merged profile.
      </p>
      <input className="w-full text-sm border border-gray-300 rounded px-2 py-1"
        placeholder="Merged party name" value={name} onChange={e => setName(e.target.value)} />
      <div className="flex gap-2">
        <button className="text-xs px-3 py-1 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
          onClick={() => onMerge(name)} disabled={loading || !name.trim()}>
          {loading ? "Merging..." : "Merge"}
        </button>
        <button className="text-xs text-gray-400" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
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
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState("")
  const [addBusy, setAddBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [merging, setMerging] = useState(false)
  const [mergeBusy, setMergeBusy] = useState(false)

  const reviewMode = status === "review_parties"

  const load = useCallback(() => {
    api.parties.list(topicId)
      .then(d => { setParties(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [topicId])

  useEffect(load, [load])

  const handleDelete = async (id: string) => {
    await api.parties.delete(topicId, id)
    setParties(ps => ps.filter(p => p.id !== id))
    setSelected(s => { const n = new Set(s); n.delete(id); return n })
  }

  const handleUpdate = async (id: string, data: Partial<Party>) => {
    const updated = await api.parties.update(topicId, id, data)
    setParties(ps => ps.map(p => p.id === id ? { ...p, ...updated } : p))
  }

  // Smart add: just a name → LLM researches and populates
  const handleSmartAdd = async () => {
    if (!newName.trim()) return
    setAddBusy(true)
    try {
      const party = await api.parties.smartAdd(topicId, newName.trim())
      setParties(ps => [...ps, party])
      setNewName("")
      setShowAdd(false)
    } catch (e) {
      alert(`Smart add failed: ${e}`)
    }
    setAddBusy(false)
  }

  const handleToggleSelect = (id: string) => {
    setSelected(s => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const handleMerge = async (name: string) => {
    const sourceIds = [...selected]
    setMergeBusy(true)
    try {
      await api.parties.merge(topicId, sourceIds, { name })
      setSelected(new Set())
      setMerging(false)
      load()
    } catch (e) {
      alert(`Merge failed: ${e}`)
    }
    setMergeBusy(false)
  }

  const selectedParties = parties.filter(p => selected.has(p.id))

  if (loading) return <div className="text-gray-400 text-sm text-center py-8">Loading parties...</div>

  return (
    <div className="space-y-4">
      {reviewMode && onApprove && (
        <ConfirmationBanner
          message={`Discovery found ${parties.length} parties. Review, merge, or edit before enrichment.`}
          detail="Merge duplicates, edit descriptions, remove irrelevant parties, or add missing ones."
          actionLabel="Approve & Continue to Enrichment"
          onConfirm={onApprove}
          loading={approveLoading}
        />
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Parties ({parties.length})</h2>
        <div className="flex gap-2">
          {selected.size >= 2 && (
            <button className="text-xs px-3 py-1 bg-amber-600 text-white rounded hover:bg-amber-700"
              onClick={() => setMerging(true)}>
              Merge Selected ({selected.size})
            </button>
          )}
          <button className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={() => setShowAdd(s => !s)}>
            + Add Party
          </button>
        </div>
      </div>

      {merging && selectedParties.length >= 2 && (
        <MergeDialog parties={selectedParties} onMerge={handleMerge}
          onCancel={() => setMerging(false)} loading={mergeBusy} />
      )}

      {showAdd && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
          <p className="text-xs text-gray-500">Enter a party name. The system will research and auto-populate all fields.</p>
          <div className="flex gap-2">
            <input className="flex-1 text-xs border border-gray-300 rounded px-2 py-1"
              placeholder="e.g. Hezbollah, European Union, Reza Pahlavi..."
              value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSmartAdd()}
              autoFocus disabled={addBusy} />
            <button className="text-xs px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
              onClick={handleSmartAdd} disabled={addBusy || !newName.trim()}>
              {addBusy ? "Researching..." : "Add"}
            </button>
            <button className="text-xs text-gray-400" onClick={() => { setShowAdd(false); setNewName("") }}>Cancel</button>
          </div>
          {addBusy && (
            <div className="flex items-center gap-2 text-xs text-blue-600">
              <div className="animate-spin w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full" />
              Searching and analyzing "{newName}"...
            </div>
          )}
        </div>
      )}

      {parties.length === 0 ? (
        <div className="text-gray-400 text-sm text-center py-8">No parties discovered yet.</div>
      ) : (
        <div className="space-y-3">
          {[...parties].sort((a, b) => b.weight - a.weight).map(party => (
            <PartyCard
              key={party.id}
              party={party}
              topicId={topicId}
              onDelete={handleDelete}
              onUpdate={handleUpdate}
              onReload={load}
              reviewMode={reviewMode}
              selected={selected.has(party.id)}
              onToggleSelect={handleToggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}
