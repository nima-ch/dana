import { useEffect, useState } from "react"
import { api } from "../../api/client"

interface RankedScenario {
  scenario_id: string
  title: string
  probability: number
  confidence: "high" | "medium" | "low"
  key_drivers: string[]
  watch_indicators: string[]
  near_future_trajectories: {
    "90_days": string
    "6_months": string
    "1_year": string
  }
}

interface WeightChallengeDecision {
  party_id: string
  dimension: string
  original_score: number
  applied_score: number
  status: "accepted" | "rejected"
  reason: string
}

interface FinalVerdict {
  synthesized_at: string
  scenarios_ranked: RankedScenario[]
  final_assessment: string
  confidence_note: string
  weight_challenge_decisions: WeightChallengeDecision[]
}

const CONFIDENCE_COLORS = {
  high: "bg-green-100 text-green-700",
  medium: "bg-yellow-100 text-yellow-700",
  low: "bg-red-100 text-red-700",
}

export function VerdictPanel({ topicId, version }: { topicId: string; version?: number }) {
  const [verdict, setVerdict] = useState<FinalVerdict | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedScenario, setExpandedScenario] = useState<string | null>(null)
  const [showChallenges, setShowChallenges] = useState(false)

  useEffect(() => {
    setLoading(true)
    const fetcher = version
      ? api.verdict.getVersion(topicId, version)
      : api.verdict.get(topicId)
    fetcher
      .then(setVerdict)
      .catch(() => setVerdict(null))
      .finally(() => setLoading(false))
  }, [topicId, version])

  if (loading) return <div className="text-gray-400 text-sm text-center py-12">Loading verdict...</div>
  if (!verdict) return <div className="text-gray-400 text-sm text-center py-12">No verdict available yet.</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Final Verdict</h2>
        <span className="text-[10px] text-gray-400">
          Synthesized {new Date(verdict.synthesized_at).toLocaleString()}
        </span>
      </div>

      {/* Scenario cards */}
      <div className="space-y-3">
        {verdict.scenarios_ranked.map((sc, idx) => {
          const isExpanded = expandedScenario === sc.scenario_id
          return (
            <div key={sc.scenario_id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div
                className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setExpandedScenario(isExpanded ? null : sc.scenario_id)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-gray-300 w-6">#{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-gray-900 truncate">{sc.title || sc.scenario_id}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${CONFIDENCE_COLORS[sc.confidence]}`}>
                        {sc.confidence} confidence
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-gray-900">{Math.round(sc.probability * 100)}%</div>
                  </div>
                </div>

                {/* Probability bar */}
                <div className="mt-2 bg-gray-100 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all"
                    style={{ width: `${sc.probability * 100}%` }}
                  />
                </div>

                {/* Key drivers */}
                {sc.key_drivers?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {sc.key_drivers.map((d, i) => (
                      <span key={i} className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{d}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div className="border-t border-gray-100 p-4 space-y-3">
                  {/* Watch indicators */}
                  {sc.watch_indicators?.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-medium text-gray-500 uppercase mb-1">Watch Indicators</h4>
                      <ul className="space-y-1">
                        {sc.watch_indicators.map((ind, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <input type="checkbox" className="mt-0.5 rounded border-gray-300" />
                            <span className="text-xs text-gray-600">{ind}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Timeline trajectories */}
                  {sc.near_future_trajectories && (
                    <div>
                      <h4 className="text-[10px] font-medium text-gray-500 uppercase mb-1">Timeline Trajectories</h4>
                      <div className="space-y-2">
                        {(["90_days", "6_months", "1_year"] as const).map(period => {
                          const labels = { "90_days": "90 Days", "6_months": "6 Months", "1_year": "1 Year" }
                          const value = sc.near_future_trajectories[period]
                          if (!value) return null
                          return (
                            <div key={period} className="bg-gray-50 rounded p-2">
                              <span className="text-[10px] font-medium text-gray-500">{labels[period]}</span>
                              <p className="text-xs text-gray-600 mt-0.5">{value}</p>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Final assessment */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-xs font-medium text-gray-500 uppercase mb-2">Final Assessment</h3>
        <p className="text-sm text-gray-700 whitespace-pre-line">{verdict.final_assessment}</p>
      </div>

      {/* Confidence note */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <h3 className="text-xs font-medium text-amber-700 mb-1">Confidence Note</h3>
        <p className="text-xs text-amber-600">{verdict.confidence_note}</p>
      </div>

      {/* Weight challenge decisions */}
      {verdict.weight_challenge_decisions?.length > 0 && (
        <div>
          <button
            onClick={() => setShowChallenges(!showChallenges)}
            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            <span>{showChallenges ? "Hide" : "Show"} weight challenge decisions ({verdict.weight_challenge_decisions.length})</span>
          </button>
          {showChallenges && (
            <div className="mt-2 bg-white border border-gray-200 rounded-lg p-3 space-y-2">
              {verdict.weight_challenge_decisions.map((d, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className={`px-1.5 py-0.5 rounded ${d.status === "accepted" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                    {d.status}
                  </span>
                  <span className="text-gray-600">
                    {d.party_id} / {d.dimension}: {d.original_score} → {d.applied_score}
                  </span>
                  <span className="text-gray-400 truncate flex-1" title={d.reason}>{d.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
