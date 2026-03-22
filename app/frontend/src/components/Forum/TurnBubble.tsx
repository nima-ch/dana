interface Turn {
  id: string
  representative_id: string
  party_name: string
  party_color?: string
  statement: string
  clues_cited: string[]
  timestamp: string
  round: number
  type: string
  word_count: number
  // delta fields
  prior_position_summary?: string
  position_delta?: string
}

interface Props {
  turn: Turn
  topicId: string
  isDelta?: boolean
  onClueClick?: (clueId: string) => void
}

// Assign a consistent color per party name
function partyColor(name: string): string {
  const colors = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

// Render statement with clue IDs as clickable chips
function StatementWithCitations({ text, onClueClick }: { text: string; onClueClick?: (id: string) => void }) {
  const parts = text.split(/(\[clue-\d+(?:@v\d+)?\])/g)
  return (
    <span>
      {parts.map((part, i) => {
        const match = part.match(/^\[(\w+-\d+(?:@v\d+)?)\]$/)
        if (match) {
          return (
            <button
              key={i}
              className="inline-block mx-0.5 px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 font-mono"
              onClick={() => onClueClick?.(match[1].split("@")[0])}
            >
              {match[1]}
            </button>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </span>
  )
}

export function TurnBubble({ turn, isDelta, onClueClick }: Props) {
  const color = turn.party_color ?? partyColor(turn.party_name)
  const time = new Date(turn.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

  return (
    <div className="flex flex-col gap-1">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="text-xs font-semibold text-gray-800">{turn.party_name}</span>
        <span className="text-xs text-gray-400">{time} · Round {turn.round}/3</span>
        {isDelta && (
          <span className="text-xs bg-orange-100 text-orange-700 px-1.5 rounded font-medium">Δ update</span>
        )}
      </div>

      {/* Delta: prior position struck through */}
      {isDelta && turn.prior_position_summary && (
        <div className="ml-5 text-xs text-gray-400 line-through italic border-l-2 border-gray-200 pl-2">
          {turn.prior_position_summary}
        </div>
      )}

      {/* Statement bubble */}
      <div
        className="ml-5 border rounded-lg p-3 text-sm text-gray-800 leading-relaxed"
        style={{ borderColor: `${color}40`, backgroundColor: `${color}08` }}
      >
        <StatementWithCitations text={turn.statement} onClueClick={onClueClick} />
      </div>

      {/* Cited clues row */}
      {turn.clues_cited.length > 0 && (
        <div className="ml-5 flex gap-1 flex-wrap">
          {turn.clues_cited.map(id => (
            <button
              key={id}
              className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded hover:bg-blue-100 hover:text-blue-700 font-mono"
              onClick={() => onClueClick?.(id)}
            >
              {id}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
