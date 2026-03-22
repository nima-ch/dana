import { useState, useEffect, useRef } from "react"

const ANALYSIS_STAGES = [
  { key: "weight", label: "Weight Calculation", icon: "\u2696" },
  { key: "forum", label: "Forum Debate", icon: "\uD83D\uDDE3" },
  { key: "expert_council", label: "Expert Council", icon: "\uD83C\uDFDB" },
  { key: "verdict", label: "Verdict Synthesis", icon: "\u2696" },
]

interface Props {
  liveStage: string | null
  completedStages: Set<string>
  progressMsg: string
  error?: string | null
  forumTurns: Record<string, unknown>[]
  expertAssessments: { expert: string; domain: string; summary: string }[]
  verdictContent: { headline: string; scenarios: { title: string; probability: number }[] } | null
  weightResults: { name: string; weight: number }[] | null
}

export function AnalysisProgressView({
  liveStage, completedStages, progressMsg, error,
  forumTurns, expertAssessments, verdictContent, weightResults,
}: Props) {
  const [messageLog, setMessageLog] = useState<{ stage: string; msg: string; time: string }[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (progressMsg && liveStage) {
      const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      setMessageLog(prev => {
        const last = prev[prev.length - 1]
        if (last?.msg === progressMsg) return prev
        return [...prev.slice(-80), { stage: liveStage, msg: progressMsg, time }]
      })
    }
  }, [progressMsg, liveStage])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [forumTurns.length, expertAssessments.length, verdictContent, messageLog.length])

  const allDone = ANALYSIS_STAGES.every(s => completedStages.has(s.key))

  function getStageStatus(key: string): "pending" | "active" | "done" | "error" {
    if (completedStages.has(key)) return "done"
    if (liveStage === key) return "active"
    if (error && liveStage === key) return "error"
    return "pending"
  }

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-120px)]">
      {/* Stage progress bar */}
      <div className="flex gap-1 mb-4 px-1">
        {ANALYSIS_STAGES.map((s, idx) => {
          const status = getStageStatus(s.key)
          return (
            <div key={s.key} className="flex-1 flex items-center gap-2">
              <div className={[
                "flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium flex-1 transition-all",
                status === "done" ? "bg-green-100 text-green-800" :
                status === "active" ? "bg-blue-100 text-blue-800 ring-1 ring-blue-300" :
                status === "error" ? "bg-red-100 text-red-800" :
                "bg-gray-100 text-gray-400",
              ].join(" ")}>
                {status === "done" && <span className="text-green-600">&#10003;</span>}
                {status === "active" && <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />}
                <span className="truncate">{s.label}</span>
              </div>
              {idx < ANALYSIS_STAGES.length - 1 && (
                <span className="text-gray-300 shrink-0">&#8594;</span>
              )}
            </div>
          )
        })}
      </div>

      {/* Live content stream */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pr-1">
        {/* Weight results */}
        {weightResults && (
          <ContentCard title="Party Weights Assigned" stage="weight">
            <div className="space-y-1.5">
              {weightResults.sort((a, b) => b.weight - a.weight).map(p => {
                const maxW = weightResults[0]?.weight || 100
                return (
                  <div key={p.name} className="flex items-center gap-2">
                    <span className="text-xs text-gray-600 w-48 truncate shrink-0" title={p.name}>{p.name}</span>
                    <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${(p.weight / maxW) * 100}%`,
                          backgroundColor: p.weight > 70 ? "#3b82f6" : p.weight > 40 ? "#8b5cf6" : "#9ca3af",
                        }}
                      />
                    </div>
                    <span className="text-xs font-mono font-bold text-gray-800 w-8 text-right">{p.weight}</span>
                  </div>
                )
              })}
            </div>
          </ContentCard>
        )}

        {/* Forum turns */}
        {forumTurns.map((turn, i) => {
          const t = turn as any
          // Parse structured fields - may be on the turn object or inside a JSON statement
          let position = t.position || ""
          let evidence: any[] = t.evidence || []
          let challenges: any[] = t.challenges || []
          let concessions: any[] = t.concessions || []
          let scenario_endorsement = t.scenario_endorsement || ""
          let rawStatement = t.statement || t.content || ""

          // If statement is a JSON string, try parsing it to extract structured fields
          if (typeof rawStatement === "string" && (!position || !evidence.length)) {
            try {
              const jsonMatch = rawStatement.match(/\{[\s\S]+\}/)
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0])
                position = position || parsed.position || ""
                evidence = evidence.length ? evidence : parsed.evidence || []
                challenges = challenges.length ? challenges : parsed.challenges || []
                concessions = concessions.length ? concessions : parsed.concessions || []
                scenario_endorsement = scenario_endorsement || parsed.scenario_endorsement || ""
                rawStatement = parsed.statement || ""
              }
            } catch { /* not JSON, use as-is */ }
          }

          // Clean up statement - strip JSON artifacts
          if (typeof rawStatement === "string" && rawStatement.trim().startsWith("{")) rawStatement = ""

          const hasStructured = !!(position || evidence.length || challenges.length)
          const personaTitle = t.persona_title || t.party_name || t.party_id || "Representative"
          const roundLabel = `Round ${t.round || t.round_number || "?"} ${t.type ? `(${t.type.replace(/_/g, " ")})` : ""}`
          const clueCount = (t.clues_cited || []).length

          return (
            <ContentCard
              key={i}
              title={personaTitle}
              subtitle={`${roundLabel} \u00b7 ${t.word_count || 0}w${clueCount > 0 ? ` \u00b7 ${clueCount} clues` : ""}`}
              stage="forum"
            >
              {position && (
                <div className="text-sm text-gray-800 mb-3 leading-relaxed">{position}</div>
              )}
              {evidence.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs font-semibold text-blue-700 mb-1">Evidence ({evidence.length})</div>
                  <div className="space-y-2">
                    {evidence.map((e: any, j: number) => (
                      <div key={j} className="bg-blue-50 rounded px-2.5 py-1.5">
                        <div className="text-xs font-medium text-gray-800">{typeof e === "string" ? e : e.claim || e.point || ""}</div>
                        {e.interpretation && <div className="text-xs text-gray-600 mt-0.5">{e.interpretation}</div>}
                        {e.clue_id && <span className="text-[10px] text-blue-500 font-mono">[{e.clue_id.replace(/^clue-0*/, "")}]</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {challenges.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs font-semibold text-red-700 mb-1">Challenges ({challenges.length})</div>
                  <div className="space-y-2">
                    {challenges.map((c: any, j: number) => (
                      <div key={j} className="bg-red-50 rounded px-2.5 py-1.5">
                        {c.target_party && <div className="text-[10px] text-red-500 font-medium mb-0.5">To: {c.target_party}</div>}
                        <div className="text-xs text-gray-800">{typeof c === "string" ? c : c.challenge || c.point || ""}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {concessions.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs font-semibold text-amber-700 mb-1">Concessions</div>
                  <div className="space-y-1">
                    {concessions.map((c: any, j: number) => (
                      <div key={j} className="bg-amber-50 rounded px-2.5 py-1.5 text-xs text-gray-700">
                        {typeof c === "string" ? c : c.point || JSON.stringify(c)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {scenario_endorsement && (
                <div className="text-xs bg-purple-50 rounded px-2.5 py-1.5 text-purple-800">
                  <span className="font-medium">Endorses: </span>{scenario_endorsement}
                </div>
              )}
              {!hasStructured && rawStatement && (
                <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{rawStatement}</div>
              )}
            </ContentCard>
          )
        })}

        {/* Active forum indicator */}
        {liveStage === "forum" && !completedStages.has("forum") && (
          <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 rounded-lg border border-blue-100">
            <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-blue-700">{progressMsg}</span>
          </div>
        )}

        {/* Expert assessments */}
        {expertAssessments.map((ea, i) => (
          <ContentCard key={i} title={ea.expert} subtitle={ea.domain} stage="expert_council" status="done">
            <div className="text-xs text-gray-600">{ea.summary}...</div>
          </ContentCard>
        ))}

        {/* Active expert indicator */}
        {liveStage === "expert_council" && !completedStages.has("expert_council") && (
          <div className="flex items-center gap-2 px-4 py-3 bg-purple-50 rounded-lg border border-purple-100">
            <div className="w-3 h-3 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-purple-700">{progressMsg}</span>
          </div>
        )}

        {/* Verdict */}
        {verdictContent && (
          <ContentCard title="Final Verdict" stage="verdict" status="done">
            {verdictContent.headline && (
              <div className="text-sm font-medium text-gray-800 mb-3">{verdictContent.headline}</div>
            )}
            <div className="space-y-2">
              {verdictContent.scenarios.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="text-xs font-medium text-gray-700">{s.title}</div>
                    <div className="mt-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.round(s.probability * 100)}%`,
                          backgroundColor: i === 0 ? "#3b82f6" : i === 1 ? "#8b5cf6" : i === 2 ? "#f59e0b" : "#6b7280",
                        }}
                      />
                    </div>
                  </div>
                  <span className="text-sm font-bold text-gray-900 tabular-nums w-12 text-right">
                    {Math.round(s.probability * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </ContentCard>
        )}

        {/* Active verdict indicator */}
        {liveStage === "verdict" && !verdictContent && (
          <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 rounded-lg border border-amber-100">
            <div className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-amber-700">{progressMsg}</span>
          </div>
        )}

        {/* Active weight indicator */}
        {liveStage === "weight" && !weightResults && (
          <div className="flex items-center gap-2 px-4 py-3 bg-indigo-50 rounded-lg border border-indigo-100">
            <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-indigo-700">{progressMsg}</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <div className="text-sm font-medium text-red-800">Analysis failed</div>
            <div className="text-xs text-red-600 mt-1">{error}</div>
          </div>
        )}

        {/* All done */}
        {allDone && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-center">
            <div className="text-sm font-medium text-green-800">Analysis Complete</div>
            <div className="text-xs text-green-600 mt-1">Click Forum, Expert Council, or Verdict in the sidebar to explore the full results.</div>
          </div>
        )}
      </div>
    </div>
  )
}

function ContentCard({ title, subtitle, stage, children }: {
  title: string
  subtitle?: string
  stage: string
  status?: string
  children: React.ReactNode
}) {
  const borderColor =
    stage === "forum" ? "border-l-blue-400" :
    stage === "expert_council" ? "border-l-purple-400" :
    stage === "verdict" ? "border-l-amber-500" :
    stage === "weight" ? "border-l-indigo-400" :
    "border-l-gray-300"

  return (
    <div className={`bg-white rounded-lg border border-gray-200 border-l-4 ${borderColor} px-4 py-3`}>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-sm font-semibold text-gray-800">{title}</span>
        {subtitle && <span className="text-xs text-gray-400">{subtitle}</span>}
      </div>
      {children}
    </div>
  )
}
