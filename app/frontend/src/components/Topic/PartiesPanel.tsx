import { useEffect, useState, useCallback } from "react"
import { api } from "../../api/client"
import { ConfirmationBanner } from "./ConfirmationBanner"

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

function WeightBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-36 shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
        <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-6 text-right">{value}</span>
    </div>
  )
}

function PartyCard({
  party, onDelete, onUpdate, reviewMode, selected, onToggleSelect,
}: {
  party: Party
  onDelete: (id: string) => void
  onUpdate: (id: string, data: Partial<Party>) => void
  reviewMode: boolean
  selected: boolean
  onToggleSelect: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ name: party.name, description: party.description, agenda: party.agenda, type: party.type })

  const weightColor = party.weight >= 70 ? "bg-red-100 text-red-700"
    : party.weight >= 40 ? "bg-yellow-100 text-yellow-700"
    : "bg-gray-100 text-gray-600"

  const handleSave = () => {
    onUpdate(party.id, draft)
    setEditing(false)
  }

  return (
    <div className={`bg-white border rounded-lg p-4 space-y-2 ${selected ? "border-amber-400 ring-1 ring-amber-200" : "border-gray-200"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          {reviewMode && (
            <input
              type="checkbox"
              className="mt-1 shrink-0"
              checked={selected}
              onChange={() => onToggleSelect(party.id)}
            />
          )}
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-2">
                <input
                  className="w-full text-sm font-medium border border-gray-300 rounded px-2 py-1"
                  value={draft.name}
                  onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                />
                <select
                  className="text-xs border border-gray-300 rounded px-2 py-1"
                  value={draft.type}
                  onChange={e => setDraft(d => ({ ...d, type: e.target.value }))}
                >
                  <option value="state">State</option>
                  <option value="non_state">Non-State</option>
                  <option value="institution">Institution</option>
                  <option value="coalition">Coalition</option>
                  <option value="individual">Individual</option>
                </select>
                <textarea
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1 h-16"
                  value={draft.description}
                  onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                />
                <textarea
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1 h-12"
                  placeholder="Agenda"
                  value={draft.agenda}
                  onChange={e => setDraft(d => ({ ...d, agenda: e.target.value }))}
                />
                <div className="flex gap-2">
                  <button className="text-xs px-2 py-1 bg-blue-600 text-white rounded" onClick={handleSave}>Save</button>
                  <button className="text-xs text-gray-400" onClick={() => setEditing(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-gray-900">{party.name}</span>
                  <span className="text-xs text-gray-400">{party.type.replace("_", " ")}</span>
                  {party.user_verified && <span className="text-xs bg-green-50 text-green-600 px-1.5 rounded">verified</span>}
                </div>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{party.description}</p>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            title="Weight breakdown"
            className={`text-xs px-2 py-0.5 rounded font-medium cursor-pointer ${weightColor}`}
            onClick={() => setExpanded(e => !e)}
          >
            {party.weight}
          </button>
          {!editing && (
            <button className="text-xs text-blue-400 hover:text-blue-600" onClick={() => setEditing(true)}>edit</button>
          )}
          <button className="text-xs text-red-400 hover:text-red-600" onClick={() => onDelete(party.id)}>✕</button>
        </div>
      </div>

      {!editing && (
        <>
          <p className="text-xs text-gray-600"><span className="font-medium">Agenda:</span> {party.agenda}</p>

          {party.means.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {party.means.map(m => (
                <span key={m} className="text-xs bg-blue-50 text-blue-700 px-1.5 rounded">{m}</span>
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

          {expanded && (
            <div className="border-t border-gray-100 pt-2 space-y-1">
              <WeightBar label="Military capacity" value={party.weight_factors?.military_capacity ?? 0} />
              <WeightBar label="Economic control" value={party.weight_factors?.economic_control ?? 0} />
              <WeightBar label="Information control" value={party.weight_factors?.information_control ?? 0} />
              <WeightBar label="International support" value={party.weight_factors?.international_support ?? 0} />
              <WeightBar label="Internal legitimacy" value={party.weight_factors?.internal_legitimacy ?? 0} />
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
  parties, onMerge, onCancel,
}: { parties: Party[]; onMerge: (name: string, desc: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(parties.map(p => p.name).join(" / "))
  const [desc, setDesc] = useState(parties.map(p => p.description).join(" "))

  return (
    <div className="bg-white border border-amber-300 rounded-lg p-4 space-y-3">
      <p className="text-sm font-medium text-gray-800">Merge {parties.length} parties</p>
      <p className="text-xs text-gray-500">
        Merging: {parties.map(p => p.name).join(", ")}
      </p>
      <input
        className="w-full text-sm border border-gray-300 rounded px-2 py-1"
        placeholder="Merged party name"
        value={name}
        onChange={e => setName(e.target.value)}
      />
      <textarea
        className="w-full text-xs border border-gray-300 rounded px-2 py-1 h-20"
        placeholder="Description for merged party"
        value={desc}
        onChange={e => setDesc(e.target.value)}
      />
      <div className="flex gap-2">
        <button className="text-xs px-3 py-1 bg-amber-600 text-white rounded hover:bg-amber-700" onClick={() => onMerge(name, desc)}>Merge</button>
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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [merging, setMerging] = useState(false)

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

  const handleAdd = async () => {
    if (!newName.trim()) return
    const party = await api.parties.add(topicId, { name: newName.trim() })
    setParties(ps => [...ps, party])
    setNewName("")
    setShowAdd(false)
  }

  const handleToggleSelect = (id: string) => {
    setSelected(s => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const handleMerge = async (name: string, desc: string) => {
    const sourceIds = [...selected]
    await api.parties.merge(topicId, sourceIds, { name, description: desc })
    setSelected(new Set())
    setMerging(false)
    load()
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
            <button
              className="text-xs px-3 py-1 bg-amber-600 text-white rounded hover:bg-amber-700"
              onClick={() => setMerging(true)}
            >
              Merge Selected ({selected.size})
            </button>
          )}
          <button
            className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={() => setShowAdd(s => !s)}
          >
            + Add Party
          </button>
        </div>
      </div>

      {merging && selectedParties.length >= 2 && (
        <MergeDialog
          parties={selectedParties}
          onMerge={handleMerge}
          onCancel={() => setMerging(false)}
        />
      )}

      {showAdd && (
        <div className="flex gap-2">
          <input
            className="flex-1 text-xs border border-gray-300 rounded px-2 py-1"
            placeholder="Party name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAdd()}
            autoFocus
          />
          <button className="text-xs px-3 py-1 bg-blue-600 text-white rounded" onClick={handleAdd}>Add</button>
          <button className="text-xs text-gray-400" onClick={() => setShowAdd(false)}>Cancel</button>
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
              onDelete={handleDelete}
              onUpdate={handleUpdate}
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
