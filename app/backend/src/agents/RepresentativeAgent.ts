import { chatCompletionText } from "../llm/proxyClient"
import { getClue } from "../tools/internal/getClue"
import { getPartyProfile } from "../tools/internal/getPartyProfile"
import { getPriorTurns } from "../tools/internal/getForumData"
import { writeArtifact } from "../tools/internal/artifactStore"
import { buildAgentContext, serializeContext } from "./contextBuilder"
import type { SpeakingBudget } from "./WeightCalculator"
import type { ForumTurn } from "../tools/internal/getForumData"

export interface RepTurnInput {
  topicId: string
  runId: string
  sessionId: string
  partyId: string
  personaPrompt: string
  speakingBudget: SpeakingBudget
  round: number
  roundType: "opening_statements" | "rebuttals" | "closings_and_scenarios"
  model: string
}

export interface RepTurnOutput {
  turn: ForumTurn
  artifact_name: string
}

const BASE_SYSTEM = `You are a forum representative in a structured geopolitical analysis.

Your role: argue FOR your assigned party using ONLY evidence from clues and logical inference.

RULES (non-negotiable):
1. Every factual claim must cite a clue ID in brackets, e.g. [clue-001]. Unsupported claims must be labeled "(inference)" or "(assumption)".
2. STEELMAN: Before your main argument, state the strongest version of the opposing view in 1-2 sentences.
3. No emotional appeals. Reference emotional/social factors as data only.
4. Every scenario argument must include one falsification condition.
5. Acknowledge the most damaging evidence against your party before addressing it.
6. Stay within your word budget — exceed it by no more than 10%.

OUTPUT FORMAT (JSON only):
{
  "statement": "<your full statement as plain text>",
  "clues_cited": ["clue-id", ...],
  "word_count": <integer>
}`

function countWords(text: string): number {
  return text.trim().split(/\s+/).length
}

function buildRoundInstructions(roundType: RepTurnInput["roundType"], budget: number): string {
  switch (roundType) {
    case "opening_statements":
      return `ROUND: Opening Statement. Present your party's position on the topic. Budget: ~${budget} words.`
    case "rebuttals":
      return `ROUND: Rebuttal. You have read prior statements. Challenge the strongest opposing argument and defend against attacks on your party. Budget: ~${budget} words.`
    case "closings_and_scenarios":
      return `ROUND: Closing + Scenario Proposal. Summarize your position. Propose or endorse 1-2 scenarios (with required conditions and one falsification condition each). Budget: ~${budget} words.`
  }
}

export async function runRepresentativeAgent(input: RepTurnInput): Promise<RepTurnOutput> {
  const { topicId, runId, sessionId, partyId, personaPrompt, speakingBudget, round, roundType, model } = input

  // Determine budget for this round type
  const budget = roundType === "opening_statements" ? speakingBudget.opening_statement
    : roundType === "rebuttals" ? speakingBudget.rebuttal
    : speakingBudget.closing

  // Build context
  const ctx = await buildAgentContext("forum", topicId)
  const contextStr = serializeContext(ctx)

  // Get prior turns for this round context
  let priorTurnsStr = ""
  if (round > 1) {
    const priorTurns = await getPriorTurns(topicId, sessionId, { round: round - 1 })
    if (priorTurns.length > 0) {
      priorTurnsStr = "\n\nPRIOR ROUND STATEMENTS:\n" + priorTurns.map(t =>
        `[${t.party_name}]: ${t.statement.slice(0, 500)}...`
      ).join("\n\n")
    }
  }

  // Get party profile
  const party = await getPartyProfile(topicId, partyId)

  const systemPrompt = `${personaPrompt}\n\n${BASE_SYSTEM}`
  const userPrompt = `TOPIC CONTEXT:\n${contextStr}

YOUR PARTY: ${party.name}
AGENDA: ${party.agenda}
MEANS: ${party.means.join(", ")}
VULNERABILITIES: ${party.vulnerabilities.join(", ")}

${buildRoundInstructions(roundType, budget)}${priorTurnsStr}

Use get_clue tool calls mentally — the clue index above shows available clues. Cite by ID.`

  const raw = await chatCompletionText({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.6,
    max_tokens: Math.max(budget * 2, 600), // generous token budget
  })

  // Parse output
  let statement = raw
  let clues_cited: string[] = []
  let word_count = countWords(raw)

  const jsonMatch = raw.match(/\{[\s\S]+\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      statement = parsed.statement ?? raw
      clues_cited = parsed.clues_cited ?? []
      word_count = parsed.word_count ?? countWords(statement)
    } catch { /* use raw */ }
  }

  // Extract clue citations from text if not in JSON
  if (clues_cited.length === 0) {
    const matches = statement.match(/\[clue-\d+\]/g) ?? []
    clues_cited = [...new Set(matches.map(m => m.replace(/[\[\]]/g, "")))]
  }

  const turn: ForumTurn = {
    id: `turn-${partyId}-r${round}`,
    representative_id: `rep-${partyId}`,
    party_name: party.name,
    statement,
    clues_cited,
    timestamp: new Date().toISOString(),
    round,
    type: roundType,
    word_count,
  }

  const artifactName = `representative_${partyId}_r${round}`
  await writeArtifact(topicId, runId, artifactName, turn)

  return { turn, artifact_name: artifactName }
}
