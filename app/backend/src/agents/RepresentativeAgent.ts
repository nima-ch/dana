import { chatCompletionText } from "../llm/proxyClient"
import { budgetOutput } from "../llm/tokenBudget"
import { loadPrompt } from "../llm/promptLoader"
import { getPartyProfile } from "../tools/internal/getPartyProfile"
import { writeArtifact } from "../tools/internal/artifactStore"
import { log } from "../utils/logger"
import { dbGetScratchpad } from "../db/queries/forum"
import type { ForumTurn, ForumScenario, ScratchpadContent } from "../db/queries/forum"

export interface RepTurnInput {
  topicId: string
  runId: string
  sessionId: string
  partyId: string
  personaTitle: string
  model: string
  turnNumber: number
  myTurnCount: number
  speakingWeight: number
  consecutivePasses: number
  recentTurns: ForumTurn[]
  compressedHistory: string
  liveScenarios: ForumScenario[]
  topic: string
}

export interface RepTurnOutput {
  turn: ForumTurn | null   // null = passed
  passed: boolean
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function formatScratchpad(content: ScratchpadContent): string {
  const clueLines = content.clue_analysis
    .filter(c => {
      const rel = c.r ?? c.relevance_to_us
      return rel !== "N" && rel !== "neutral"
    })
    .slice(0, 20)
    .map(c => {
      const rel = c.r ?? (c.relevance_to_us === "supports" ? "S" : c.relevance_to_us === "weakens" ? "W" : "N")
      const use = c.use || c.how_we_use_it || ""
      return `  [${c.clue_id}] ${rel}: ${use.slice(0, 100)}`
    })

  return [
    `YOUR CORE POSITION: ${content.our_core_position}`,
    `SCENARIO YOU ARE PUSHING: ${content.scenario_we_are_pushing}`,
    `STRONGEST OPPONENT: ${content.strongest_opposing_party}`,
    `YOUR VULNERABILITIES: ${content.our_key_vulnerabilities.join("; ")}`,
    `YOUR OPENING MOVE: ${content.opening_move}`,
    `\nCLUE STRATEGY (non-neutral clues):`,
    ...clueLines,
  ].join("\n")
}

function formatRecentTurns(turns: ForumTurn[]): string {
  return turns.map(t =>
    `[Turn ${t.round} — ${t.party_name}]: ${t.statement}`
  ).join("\n\n---\n\n")
}

function formatScenarios(scenarios: ForumScenario[]): string {
  if (scenarios.length === 0) return "No scenarios defined yet."
  return scenarios.map(s =>
    `• ${s.title}: ${s.description} (supported by: ${s.supported_by.join(", ") || "none"}, contested by: ${s.contested_by.join(", ") || "none"})`
  ).join("\n")
}

export async function runRepresentativeTurn(input: RepTurnInput): Promise<RepTurnOutput> {
  const {
    topicId, runId, sessionId, partyId, personaTitle, model,
    turnNumber, myTurnCount, speakingWeight, consecutivePasses,
    recentTurns, compressedHistory, liveScenarios, topic,
  } = input

  const party = await getPartyProfile(topicId, partyId)
  const repId = `rep-${partyId}`

  // Load scratchpad
  const scratchpadRow = dbGetScratchpad(topicId, sessionId, repId)
  const scratchpadStr = scratchpadRow
    ? formatScratchpad(scratchpadRow.content)
    : `YOUR CORE POSITION: ${party.agenda}\nNo detailed preparation available.`

  // Build context
  const historyBlock = compressedHistory
    ? `DEBATE SUMMARY (earlier turns):\n${compressedHistory}\n\n`
    : ""

  const recentStr = formatRecentTurns(recentTurns)
  const scenariosStr = formatScenarios(liveScenarios)

  // Force speak if passed twice in a row
  const forceSpeak = consecutivePasses >= 2

  const TURN_PROMPT = loadPrompt("forum/representative-turn", {
    persona_title: personaTitle,
    party_name: party.name,
    scratchpad: scratchpadStr,
    topic,
    live_scenarios: scenariosStr,
    conversation_history: historyBlock,
    recent_turns: recentStr,
    my_turn_count: String(myTurnCount),
    turn_number: String(turnNumber),
    speaking_weight: String(speakingWeight),
  })

  const userContent = forceSpeak
    ? `Turn ${turnNumber}: You MUST speak this turn (you have passed the last ${consecutivePasses} turns). Make your contribution now.`
    : `Turn ${turnNumber}: It is your moment. Speak or pass.`

  const budget = budgetOutput(model, TURN_PROMPT + userContent, { min: 300, max: 800 })

  let raw: string
  try {
    raw = await chatCompletionText({
      model,
      messages: [
        { role: "system", content: TURN_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0.7,
      max_tokens: budget,
    })
  } catch (e) {
    log.forum(`  ${partyId} turn failed: ${e}`)
    return { turn: null, passed: true }
  }

  // Parse output
  let action: "speak" | "pass" = "speak"
  let statement = ""
  let cluesCited: string[] = []
  let scenarioSignal: string | undefined

  try {
    const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "")
    const match = cleaned.match(/\{[\s\S]+\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      action = parsed.action === "pass" && !forceSpeak ? "pass" : "speak"
      statement = parsed.statement || ""
      cluesCited = parsed.clues_cited || []
      scenarioSignal = parsed.scenario_signal || undefined
    } else {
      // Treat raw text as a statement
      statement = raw.trim()
    }
  } catch {
    statement = raw.trim()
  }

  if (action === "pass") {
    log.forum(`  ${partyId} PASSED turn ${turnNumber}`)
    return { turn: null, passed: true }
  }

  // Extract inline clue citations from statement text
  const inlineCites = statement.match(/\[clue-\d+\]/g) ?? []
  const allCited = [...new Set([...cluesCited, ...inlineCites.map(m => m.replace(/[\[\]]/g, ""))])]

  const turn: ForumTurn = {
    id: `turn-${partyId}-t${turnNumber}`,
    representative_id: repId,
    party_name: party.name,
    persona_title: personaTitle,
    statement,
    clues_cited: allCited,
    scenario_endorsement: scenarioSignal,
    timestamp: new Date().toISOString(),
    round: turnNumber,       // repurposed: turn number in the dynamic debate
    type: "debate",
    word_count: countWords(statement),
    evidence: [],
    challenges: [],
    concessions: [],
  }

  await writeArtifact(topicId, runId, `turn_${partyId}_t${turnNumber}`, turn)
  log.forum(`  ${partyId} spoke (${turn.word_count}w, cited ${allCited.length} clues): "${statement.slice(0, 80)}…"`)

  return { turn, passed: false }
}
