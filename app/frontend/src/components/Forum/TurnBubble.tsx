import { useState } from "react"

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

const PARTY_COLORS = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16", "#0ea5e9", "#d946ef"]

function partyColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return PARTY_COLORS[Math.abs(hash) % PARTY_COLORS.length]
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

export function TurnBubble({ turn, isDelta, onClueClick }: Props) {
  const color = turn.party_color ?? partyColor(turn.party_name)
  const time = new Date(turn.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  const hasStructured = turn.position || (turn.evidence && turn.evidence.length > 0)
  const [showRaw, setShowRaw] = useState(false)

  return (
    <div className="flex flex-col gap-1">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-gray-800">{turn.party_name}</span>
          {turn.persona_title && (
            <span className="text-xs text-gray-400 italic">{turn.persona_title}</span>
          )}
        </div>
        <span className="text-xs text-gray-400 ml-auto">{time} · R{turn.round} · {turn.word_count}w</span>
        {isDelta && (
          <span className="text-xs bg-orange-100 text-orange-700 px-1.5 rounded font-medium">delta</span>
        )}
      </div>

      {/* Delta: prior position struck through */}
      {isDelta && turn.prior_position_summary && (
        <div className="ml-5 text-xs text-gray-400 line-through italic border-l-2 border-gray-200 pl-2">
          {turn.prior_position_summary}
        </div>
      )}

      {/* Main content */}
      <div
        className="ml-5 border rounded-lg p-4 text-sm text-gray-800 leading-relaxed"
        style={{ borderColor: `${color}30`, backgroundColor: `${color}06` }}
      >
        {hasStructured && !showRaw ? (
          <StructuredView turn={turn} onClueClick={onClueClick} />
        ) : (
          <InlineStatement text={turn.statement} onClueClick={onClueClick} />
        )}

        {/* Toggle between structured and raw view */}
        {hasStructured && (
          <button
            className="text-xs text-gray-400 hover:text-gray-600 mt-2 block"
            onClick={() => setShowRaw(r => !r)}
          >
            {showRaw ? "Show structured view" : "Show full statement"}
          </button>
        )}
      </div>

      {/* Cited clues summary */}
      {turn.clues_cited.length > 0 && !hasStructured && (
        <div className="ml-5 flex gap-1 flex-wrap">
          {turn.clues_cited.map(id => (
            <ClueChip key={id} clueId={id} onClick={onClueClick} />
          ))}
        </div>
      )}
    </div>
  )
}
