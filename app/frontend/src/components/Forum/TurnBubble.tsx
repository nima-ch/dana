import { useState, useMemo } from "react"
import { partyColor } from "../../utils/partyColor"

// Parse structured fields from a raw JSON statement (handles markdown fences + truncation)
function parseStructuredFromStatement(turn: Turn): Turn {
  const hasStructured = turn.position || (turn.evidence && turn.evidence.length > 0)
  if (hasStructured) return turn

  const raw = turn.statement
  if (!raw || typeof raw !== "string") return turn
  if (!raw.includes('"position"') && !raw.includes('"evidence"')) return turn

  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "")
  let position: string | undefined
  let evidence: EvidenceItem[] | undefined
  let challenges: ChallengeItem[] | undefined
  let concessions: string[] | undefined
  let scenario_endorsement: string | undefined
  let statement = ""

  try {
    const jsonMatch = cleaned.match(/\{[\s\S]+\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      position = parsed.position
      evidence = parsed.evidence
      challenges = parsed.challenges
      concessions = parsed.concessions
      scenario_endorsement = parsed.scenario_endorsement
      statement = parsed.statement || ""
    }
  } catch {
    // Truncated JSON — extract fields individually
    try {
      const posMatch = cleaned.match(/"position"\s*:\s*"((?:[^"\\]|\\.)*)"/s)
      if (posMatch) position = posMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n")

      const evMatch = cleaned.match(/"evidence"\s*:\s*(\[[\s\S]*?\])\s*(?:,\s*"challenges)/s)
      if (evMatch) try { evidence = JSON.parse(evMatch[1]) } catch {}

      const chMatch = cleaned.match(/"challenges"\s*:\s*(\[[\s\S]*?\])\s*(?:,\s*"concessions)/s)
      if (chMatch) try { challenges = JSON.parse(chMatch[1]) } catch {}

      const coMatch = cleaned.match(/"concessions"\s*:\s*(\[[\s\S]*?\])\s*(?:,\s*"(?:statement|scenario))/s)
      if (coMatch) try { concessions = JSON.parse(coMatch[1]) } catch {}

      const seMatch = cleaned.match(/"scenario_endorsement"\s*:\s*"((?:[^"\\]|\\.)*)"/s)
      if (seMatch) scenario_endorsement = seMatch[1].replace(/\\"/g, '"')

      const stmtMatch = cleaned.match(/"statement"\s*:\s*"((?:[^"\\]|\\.)*)/)
      if (stmtMatch) statement = stmtMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n")
    } catch { return turn }
  }

  if (!position && !evidence?.length) return turn

  return {
    ...turn,
    position,
    evidence,
    challenges,
    concessions,
    scenario_endorsement,
    statement: statement || turn.statement,
  }
}

interface EvidenceItem {
  claim: string
  clue_id: string
  interpretation: string
}

interface ChallengeItem {
  target_party: string
  challenge: string
  clue_id?: string
}

interface Turn {
  id: string
  representative_id: string
  party_name: string
  persona_title?: string
  party_color?: string
  statement: string
  position?: string
  evidence?: EvidenceItem[]
  challenges?: ChallengeItem[]
  concessions?: string[]
  scenario_endorsement?: string
  clues_cited: string[]
  timestamp: string
  round: number
  type: string
  word_count: number
  prior_position_summary?: string
  position_delta?: string
}

interface Props {
  turn: Turn
  topicId: string
  isDelta?: boolean
  onClueClick?: (clueId: string) => void
}



function ClueChip({ clueId, onClick }: { clueId: string; onClick?: (id: string) => void }) {
  return (
    <button
      className="inline-flex items-center px-1.5 py-0.5 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100 font-mono border border-blue-200"
      onClick={() => onClick?.(clueId.split("@")[0])}
    >
      {clueId.replace(/^clue-0*/, "")}
    </button>
  )
}

// Render statement with inline clue references as clickable chips
function InlineStatement({ text, onClueClick }: { text: string; onClueClick?: (id: string) => void }) {
  const parts = text.split(/(\[clue-\d+(?:@v\d+)?\])/g)
  return (
    <span>
      {parts.map((part, i) => {
        const match = part.match(/^\[(\w+-\d+(?:@v\d+)?)\]$/)
        if (match) {
          return <ClueChip key={i} clueId={match[1]} onClick={onClueClick} />
        }
        return <span key={i}>{part}</span>
      })}
    </span>
  )
}

// Structured turn view — shows position, evidence, challenges, concessions as distinct sections
function StructuredView({ turn, onClueClick }: { turn: Turn; onClueClick?: (id: string) => void }) {
  const color = turn.party_color ?? partyColor(turn.party_name)

  return (
    <div className="space-y-3">
      {/* Position — the core argument */}
      {turn.position && (
        <div className="font-medium text-sm text-gray-900 leading-relaxed" style={{ borderLeftColor: color, borderLeftWidth: 3, paddingLeft: 12 }}>
          <InlineStatement text={turn.position} onClueClick={onClueClick} />
        </div>
      )}

      {/* Evidence cards */}
      {turn.evidence && turn.evidence.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Evidence</p>
          {turn.evidence.map((e, i) => (
            <div key={i} className="flex gap-2 items-start bg-gray-50 rounded px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-800">{e.claim}</p>
                {e.interpretation && (
                  <p className="text-xs text-gray-500 mt-0.5 italic">{e.interpretation}</p>
                )}
              </div>
              {e.clue_id && (
                <ClueChip clueId={e.clue_id} onClick={onClueClick} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Challenges */}
      {turn.challenges && turn.challenges.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-red-500 uppercase tracking-wide">Challenges</p>
          {turn.challenges.map((c, i) => (
            <div key={i} className="flex gap-2 items-start bg-red-50/50 rounded px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-800">
                  <span className="font-medium text-red-700">vs {c.target_party}:</span>{" "}
                  {c.challenge}
                </p>
              </div>
              {c.clue_id && (
                <ClueChip clueId={c.clue_id} onClick={onClueClick} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Concessions */}
      {turn.concessions && turn.concessions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">Concessions</p>
          {turn.concessions.map((c, i) => (
            <p key={i} className="text-xs text-gray-600 italic pl-3 border-l-2 border-amber-200">
              {c}
            </p>
          ))}
        </div>
      )}

      {/* Scenario endorsement (round 3) */}
      {turn.scenario_endorsement && (
        <div>
          <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide">Scenario Endorsement</p>
          <p className="text-xs text-gray-700 pl-3 border-l-2 border-purple-200 mt-1">
            <InlineStatement text={turn.scenario_endorsement} onClueClick={onClueClick} />
          </p>
        </div>
      )}
    </div>
  )
}

const ROUND_LABELS: Record<string, string> = {
  opening_statements: "Opening",
  rebuttals: "Rebuttal",
  closings_and_scenarios: "Closing",
  position_update: "Update",
}

export function TurnBubble({ turn: rawTurn, isDelta, onClueClick }: Props) {
  const turn = useMemo(() => parseStructuredFromStatement(rawTurn), [rawTurn])
  const color = turn.party_color ?? partyColor(turn.party_name)
  const time = new Date(turn.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  const hasStructured = turn.position || (turn.evidence && turn.evidence.length > 0)
  const [showRaw, setShowRaw] = useState(false)
  const roundLabel = ROUND_LABELS[turn.type] ?? `R${turn.round}`

  return (
    <div className="flex flex-col gap-1.5 group">
      {/* Header row */}
      <div className="flex items-center gap-2 pl-1">
        <div className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-white text-[9px] font-bold" style={{ backgroundColor: color }}>
          {turn.party_name.slice(0, 1).toUpperCase()}
        </div>
        <span className="text-xs font-semibold text-gray-800">{turn.party_name}</span>
        {turn.persona_title && (
          <span className="text-[10px] text-gray-400 italic hidden sm:inline truncate max-w-[180px]">{turn.persona_title}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {isDelta && <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium">Δ delta</span>}
          <span className="text-[10px] text-gray-400 tabular-nums">{roundLabel} · {turn.word_count}w · {time}</span>
        </div>
      </div>

      {/* Delta: prior position */}
      {isDelta && turn.prior_position_summary && (
        <div className="ml-7 text-xs text-gray-400 line-through italic border-l-2 border-gray-100 pl-2">
          {turn.prior_position_summary}
        </div>
      )}

      {/* Bubble */}
      <div
        className="ml-7 rounded-xl border shadow-sm overflow-hidden"
        style={{ borderColor: `${color}25`, backgroundColor: `${color}05` }}
      >
        <div className="p-3.5">
          {hasStructured && !showRaw ? (
            <StructuredView turn={turn} onClueClick={onClueClick} />
          ) : (
            <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
              <InlineStatement text={turn.statement} onClueClick={onClueClick} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-3.5 py-1.5 border-t bg-white/40" style={{ borderColor: `${color}15` }}>
          {turn.clues_cited.length > 0 && (
            <div className="flex gap-1 flex-wrap flex-1">
              {turn.clues_cited.slice(0, 6).map(cid => (
                <ClueChip key={cid} clueId={cid} onClick={onClueClick} />
              ))}
              {turn.clues_cited.length > 6 && (
                <span className="text-[10px] text-gray-400">+{turn.clues_cited.length - 6} more</span>
              )}
            </div>
          )}
          {hasStructured && (
            <button
              className="text-[10px] text-gray-400 hover:text-gray-600 ml-auto shrink-0"
              onClick={() => setShowRaw(r => !r)}
            >
              {showRaw ? "structured view" : "full statement"}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
