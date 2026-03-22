import { useEffect, useState } from "react"
import { api } from "../../api/client"

interface ScenarioAssessment {
  scenario_id: string
  assessment: string
  historic_analogues: string[]
  weak_points_identified: string[]
  probability_contribution: number
}

interface ExpertDeliberation {
  expert_id: string
  expert_name: string
  domain: string
  scenario_assessments: ScenarioAssessment[]
  weight_challenges: { party_id: string; dimension: string; original_score: number; suggested_score: number; reasoning: string }[]
  cross_deliberation_response?: string
}

interface ExpertCouncil {
  version: number
  experts: { id: string; name: string; domain: string; auto_generated: boolean }[]
  deliberations: ExpertDeliberation[]
  final_verdict?: any
}

const DOMAIN_COLORS: Record<string, string> = {
  geopolitics: "bg-blue-100 text-blue-700",
  history: "bg-amber-100 text-amber-700",
  psychology: "bg-purple-100 text-purple-700",
  economics: "bg-green-100 text-green-700",
  military: "bg-red-100 text-red-700",
  sociology: "bg-pink-100 text-pink-700",
  legal: "bg-gray-100 text-gray-700",
  media: "bg-cyan-100 text-cyan-700",
}

export function ExpertCouncilPanel({ topicId }: { topicId: string }) {
  const [council, setCouncil] = useState<ExpertCouncil | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<string | null>(null)

  useEffect(() => {
    api.expertCouncil.get(topicId)
      .then(data => {
        setCouncil(data)
        if (data?.deliberations?.length) setActiveTab(data.deliberations[0].expert_id)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [topicId])

  if (loading) return <div className="text-gray-400 text-sm text-center py-12">Loading expert council...</div>
  if (!council || !council.deliberations?.length) {
    return <div className="text-gray-400 text-sm text-center py-12">No expert council data available yet.</div>
  }

  const activeExpert = council.deliberations.find(d => d.expert_id === activeTab)

  // Aggregate probabilities per scenario
  const scenarioProbs = new Map<string, { total: number; count: number }>()
  for (const d of council.deliberations) {
    for (const sa of d.scenario_assessments) {
      if (!scenarioProbs.has(sa.scenario_id)) scenarioProbs.set(sa.scenario_id, { total: 0, count: 0 })
      const entry = scenarioProbs.get(sa.scenario_id)!
      entry.total += sa.probability_contribution
      entry.count++
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-gray-900">Expert Council</h2>

      {/* Expert tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {council.deliberations.map(d => (
          <button
            key={d.expert_id}
            onClick={() => setActiveTab(d.expert_id)}
            className={[
              "px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5",
              activeTab === d.expert_id
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200",
            ].join(" ")}
          >
            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${DOMAIN_COLORS[d.domain] || "bg-gray-100 text-gray-600"}`}>
              {d.domain}
            </span>
            {d.expert_name}
          </button>
        ))}
      </div>

      {/* Probability bar chart */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-xs font-medium text-gray-500 mb-3">Aggregated Scenario Probabilities</h3>
        <div className="space-y-2">
          {[...scenarioProbs.entries()]
            .sort((a, b) => (b[1].total / b[1].count) - (a[1].total / a[1].count))
            .map(([id, data]) => {
              const avg = Math.round((data.total / data.count) * 100)
              return (
                <div key={id} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-32 truncate" title={id}>{id}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-3">
                    <div
                      className="bg-blue-500 h-3 rounded-full transition-all"
                      style={{ width: `${avg}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-gray-700 w-12 text-right">{avg}%</span>
                </div>
              )
            })}
        </div>
      </div>

      {/* Active expert's assessments */}
      {activeExpert && (
        <div className="space-y-3">
          {activeExpert.scenario_assessments.map(sa => (
            <div key={sa.scenario_id} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-900">{sa.scenario_id}</h3>
                <span className="text-xs font-semibold text-blue-600">
                  {Math.round(sa.probability_contribution * 100)}%
                </span>
              </div>
              <p className="text-xs text-gray-600 mb-3">{sa.assessment}</p>

              {sa.historic_analogues.length > 0 && (
                <div className="mb-2">
                  <span className="text-[10px] font-medium text-gray-500 uppercase">Historic Analogues</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {sa.historic_analogues.map((a, i) => (
                      <span key={i} className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">{a}</span>
                    ))}
                  </div>
                </div>
              )}

              {sa.weak_points_identified.length > 0 && (
                <div>
                  <span className="text-[10px] font-medium text-gray-500 uppercase">Weak Points</span>
                  <ul className="mt-1 space-y-0.5">
                    {sa.weak_points_identified.map((wp, i) => (
                      <li key={i} className="text-[10px] text-red-600">- {wp}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}

          {/* Weight challenges */}
          {activeExpert.weight_challenges.length > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <h3 className="text-xs font-medium text-orange-700 mb-2">Weight Challenges</h3>
              {activeExpert.weight_challenges.map((wc, i) => (
                <div key={i} className="text-xs text-orange-600 mb-1">
                  {wc.party_id} / {wc.dimension}: {wc.original_score} → {wc.suggested_score} — {wc.reasoning}
                </div>
              ))}
            </div>
          )}

          {/* Cross-deliberation */}
          {activeExpert.cross_deliberation_response && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h3 className="text-xs font-medium text-gray-500 mb-2">Cross-Expert Deliberation</h3>
              <p className="text-xs text-gray-600 whitespace-pre-line">{activeExpert.cross_deliberation_response}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
