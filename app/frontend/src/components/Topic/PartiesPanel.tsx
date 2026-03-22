import { useEffect, useState } from "react"

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

function PartyCard({ party, onDelete }: { party: Party; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)

  const weightColor = party.weight >= 70 ? "bg-red-100 text-red-700"
    : party.weight >= 40 ? "bg-yellow-100 text-yellow-700"
    : "bg-gray-100 text-gray-600"

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-gray-900">{party.name}</span>
            <span className="text-xs text-gray-400">{party.type.replace("_", " ")}</span>
            {party.user_verified && <span className="text-xs bg-green-50 text-green-600 px-1.5 rounded">verified</span>}
          </div>
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{party.description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            title="Weight breakdown"
            className={`text-xs px-2 py-0.5 rounded font-medium cursor-pointer ${weightColor}`}
            onClick={() => setExpanded(e => !e)}
          >
            {party.weight}
          </button>
          <button className="text-xs text-red-400 hover:text-red-600" onClick={() => onDelete(party.id)}>✕</button>
        </div>
      </div>

      <p className="text-xs text-gray-600"><span className="font-medium">Agenda:</span> {party.agenda}</p>

      {party.means.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {party.means.map(m => (
            <span key={m} className="text-xs bg-blue-50 text-blue-700 px-1.5 rounded">{m}</span>
          ))}
        </div>
      )}

      {/* Circle */}
      {(party.circle.visible.length > 0 || party.circle.shadow.length > 0) && (
        <div className="text-xs space-y-1">
          {party.circle.visible.length > 0 && (
            <div><span className="text-gray-400">Visible: </span>{party.circle.visible.join(", ")}</div>
          )}
          {party.circle.shadow.length > 0 && (
            <div><span className="text-gray-400">Shadow: </span>
              <span className="italic">{party.circle.shadow.join(", ")}</span>
            </div>
          )}
        </div>
      )}

      {/* Weight breakdown (on expand) */}
      {expanded && (
        <div className="border-t border-gray-100 pt-2 space-y-1">
          <WeightBar label="Military capacity" value={party.weight_factors.military_capacity} />
          <WeightBar label="Economic control" value={party.weight_factors.economic_control} />
          <WeightBar label="Information control" value={party.weight_factors.information_control} />
          <WeightBar label="International support" value={party.weight_factors.international_support} />
          <WeightBar label="Internal legitimacy" value={party.weight_factors.internal_legitimacy} />
        </div>
      )}

      {party.vulnerabilities.length > 0 && (
        <div className="text-xs text-gray-500">
          <span className="font-medium">Vulnerabilities:</span> {party.vulnerabilities.join("; ")}
        </div>
      )}
    </div>
  )
}

export function PartiesPanel({ topicId }: { topicId: string }) {
  const [parties, setParties] = useState<Party[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState("")

  const load = () => {
    fetch(`/api/topics/${topicId}/parties`)
      .then(r => r.json())
      .then(d => { setParties(d); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(load, [topicId])

  const handleDelete = async (id: string) => {
    await fetch(`/api/topics/${topicId}/parties/${id}`, { method: "DELETE" })
    setParties(ps => ps.filter(p => p.id !== id))
  }

  const handleAdd = async () => {
    if (!newName.trim()) return
    const res = await fetch(`/api/topics/${topicId}/parties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    })
    const party = await res.json()
    setParties(ps => [...ps, party])
    setNewName("")
    setShowAdd(false)
  }

  if (loading) return <div className="text-gray-400 text-sm text-center py-8">Loading parties…</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Parties ({parties.length})</h2>
        <button
          className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
          onClick={() => setShowAdd(s => !s)}
        >
          + Add Party
        </button>
      </div>

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
            <PartyCard key={party.id} party={party} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  )
}
