import { useState } from "react"

interface Scenario {
  id: string
  title: string
  description: string
  proposed_by: string
  supported_by: string[]
  contested_by: string[]
  clues_cited: string[]
  required_conditions: string[]
  falsification_conditions: string[]
}

export function ScenarioCard({ scenario, onClueClick }: { scenario: Scenario; onClueClick?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-purple-100 bg-purple-50 rounded-lg p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-purple-900">{scenario.title}</h4>
          <p className="text-xs text-purple-700 mt-0.5">Proposed by {scenario.proposed_by}</p>
        </div>
        <button
          className="text-xs text-purple-500 hover:text-purple-700 shrink-0"
          onClick={() => setExpanded(e => !e)}
        >
          {expanded ? "less" : "details"}
        </button>
      </div>

      {scenario.clues_cited.length > 0 && (
        <div className="mt-2 flex gap-1 flex-wrap">
          {scenario.clues_cited.map(id => (
            <button
              key={id}
              className="text-xs font-mono px-1.5 py-0.5 bg-white border border-purple-200 text-purple-700 rounded hover:bg-purple-100"
              onClick={() => onClueClick?.(id)}
            >
              {id}
            </button>
          ))}
        </div>
      )}

      {expanded && (
        <div className="mt-3 space-y-2">
          {scenario.description && <p className="text-xs text-gray-700">{scenario.description}</p>}
          {scenario.required_conditions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-600">Required conditions:</p>
              <ul className="text-xs text-gray-600 list-disc list-inside">
                {scenario.required_conditions.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
          {scenario.falsification_conditions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-600">Falsification conditions:</p>
              <ul className="text-xs text-gray-600 list-disc list-inside">
                {scenario.falsification_conditions.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
