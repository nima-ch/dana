import { useState, useEffect, useRef } from "react"
import { useSSE } from "../../hooks/useSSE"
import { TurnBubble } from "./TurnBubble"
import { ScenarioCard } from "./ScenarioCard"
import { ClueDetailSidebar } from "./ClueDetailSidebar"

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
  prior_position_summary?: string
  position_delta?: string
}

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

interface ForumSession {
  session_id: string
  type: "full" | "delta"
  status: "running" | "complete" | "error"
  rounds: { round: number; type: string; turns: Turn[] }[]
  scenarios: Scenario[]
}

const ROUND_LABELS: Record<number, string> = {
  1: "Round 1: Opening Statements",
  2: "Round 2: Rebuttals",
  3: "Round 3: Closings & Scenarios",
}

export function ConversationView({ topicId, sessionId, isLive }: { topicId: string; sessionId: string; isLive?: boolean }) {
  const [session, setSession] = useState<ForumSession | null>(null)
  const [liveTurns, setLiveTurns] = useState<Turn[]>([])
  const [scrubPos, setScrubPos] = useState<number>(100) // percentage 0-100
  const [selectedClue, setSelectedClue] = useState<string | null>(null)
  const [filterRep, setFilterRep] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)

  // Load existing session
  useEffect(() => {
    fetch(`/api/topics/${topicId}/forum/${sessionId}`)
      .then(r => r.json())
      .then(setSession)
      .catch(() => {})
  }, [topicId, sessionId])

  // SSE for live turns
  useSSE(isLive ? topicId : null, (event) => {
    if (event.type === "forum_turn") {
      setLiveTurns(prev => {
        const turn = event.turn as unknown as Turn
        // Prevent duplicates
        if (prev.some(t => t.id === turn.id)) return prev
        return [...prev, turn]
      })
      // Auto-scroll
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100)
    }
  })

  // All turns: from loaded session + live additions
  const allTurns: Turn[] = [
    ...(session?.rounds.flatMap(r => r.turns) ?? []),
    ...liveTurns.filter(lt => !session?.rounds.some(r => r.turns.some(t => t.id === lt.id))),
  ]

  // Apply scrub (replay mode for completed sessions)
  const isComplete = session?.status === "complete"
  const displayedTurns = isComplete
    ? allTurns.slice(0, Math.ceil(allTurns.length * scrubPos / 100))
    : allTurns

  // Apply rep filter
  const filteredTurns = filterRep
    ? displayedTurns.filter(t => t.representative_id === filterRep)
    : displayedTurns

  const allReps = [...new Set(allTurns.map(t => t.representative_id))]
  const scenarios = session?.scenarios ?? []

  // Group displayed turns by round
  const turnsByRound: Record<number, Turn[]> = {}
  for (const turn of filteredTurns) {
    if (!turnsByRound[turn.round]) turnsByRound[turn.round] = []
    turnsByRound[turn.round].push(turn)
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Filter bar */}
      <div className="flex items-center gap-3 pb-3 border-b border-gray-100">
        <select
          className="text-xs border border-gray-200 rounded px-2 py-1"
          value={filterRep}
          onChange={e => setFilterRep(e.target.value)}
        >
          <option value="">All representatives</option>
          {allReps.map(r => <option key={r} value={r}>{r.replace("rep-", "")}</option>)}
        </select>
        <span className="text-xs text-gray-400">{filteredTurns.length} turns</span>
        {session?.type === "delta" && (
          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded">Delta session</span>
        )}
      </div>

      {/* Conversation thread */}
      <div className="flex-1 overflow-y-auto space-y-6 py-4">
        {Object.entries(turnsByRound).map(([round, turns]) => (
          <div key={round}>
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 border-t border-gray-100" />
              <span className="text-xs text-gray-400 font-medium">{ROUND_LABELS[Number(round)] ?? `Round ${round}`}</span>
              <div className="flex-1 border-t border-gray-100" />
            </div>
            <div className="space-y-4">
              {turns.map(turn => (
                <TurnBubble
                  key={turn.id}
                  turn={turn}
                  topicId={topicId}
                  isDelta={session?.type === "delta"}
                  onClueClick={setSelectedClue}
                />
              ))}
            </div>
          </div>
        ))}

        {/* Scenarios section */}
        {scenarios.length > 0 && scrubPos >= 100 && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 border-t border-purple-100" />
              <span className="text-xs text-purple-500 font-medium">Scenarios Emerging</span>
              <div className="flex-1 border-t border-purple-100" />
            </div>
            <div className="space-y-2">
              {scenarios.map(s => (
                <ScenarioCard key={s.id} scenario={s} onClueClick={setSelectedClue} />
              ))}
            </div>
          </div>
        )}

        {isLive && liveTurns.length === 0 && !session && (
          <div className="text-center text-gray-400 text-sm py-12">Waiting for forum to begin…</div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Replay scrub bar (completed sessions only) */}
      {isComplete && allTurns.length > 0 && (
        <div className="border-t border-gray-100 pt-3 flex items-center gap-3">
          <span className="text-xs text-gray-400 shrink-0">Replay</span>
          <input
            type="range"
            min={0}
            max={100}
            value={scrubPos}
            onChange={e => setScrubPos(Number(e.target.value))}
            className="flex-1 accent-blue-500"
          />
          <span className="text-xs text-gray-400 shrink-0">
            {Math.ceil(allTurns.length * scrubPos / 100)}/{allTurns.length}
          </span>
        </div>
      )}

      {/* Clue detail sidebar */}
      {selectedClue && (
        <ClueDetailSidebar
          topicId={topicId}
          clueId={selectedClue}
          onClose={() => setSelectedClue(null)}
        />
      )}
    </div>
  )
}
