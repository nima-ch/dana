import { chatCompletionText } from "../llm/proxyClient"
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
  personaTitle?: string
  speakingBudget: SpeakingBudget
  round: number
  roundType: "opening_statements" | "rebuttals" | "closings_and_scenarios"
  model: string
}

export interface RepTurnOutput {
  turn: ForumTurn
  artifact_name: string
}

const BASE_SYSTEM = `You are a forum representative in a structured geopolitical analysis. You have a DISTINCT PERSONA that shapes HOW you argue — your rhetorical style, what you emphasize, and your framing — while remaining evidence-based.

YOUR VOICE:
- Argue with conviction FROM your party's perspective — use "we" language when appropriate
- Your communication style, word choices, and emphases should reflect your persona
- Be a fierce advocate: actively challenge other parties' positions, find weaknesses in their arguments
- Seek out clues that support your party and interpret them in the most favorable (but honest) light
- Play devil's advocate to other parties: question their assumptions, highlight evidence that undermines them

INTELLECTUAL HONESTY (non-negotiable):
- Every factual claim must cite a clue ID. Unsupported claims must be labeled "(inference)" or "(assumption)"
- You MUST concede the strongest counter-argument against your position — then explain why it doesn't change your conclusion
- Do not fabricate evidence or misrepresent clue content

OUTPUT FORMAT — strict JSON:
{
  "position": "<Your core argument in 2-3 bold sentences. This is your thesis — clear, assertive, from your party's perspective>",
  "evidence": [
    {"claim": "<factual claim>", "clue_id": "<clue-XXX>", "interpretation": "<how this evidence supports YOUR party's position>"}
  ],
  "challenges": [
    {"target_party": "<party name you are challenging>", "challenge": "<your specific challenge to their position>", "clue_id": "<optional clue-XXX that undermines them>"}
  ],
  "concessions": ["<the strongest argument against your position, honestly stated>"],
  "scenario_endorsement": "<only in Round 3: which scenario(s) you endorse/propose, with falsification condition>",
  "statement": "<full flowing statement that weaves together all the above — this is the 'speech' version>",
  "clues_cited": ["clue-XXX", ...],
  "word_count": <integer>
}

Rules:
- evidence array: 3-6 items, each citing a specific clue
- challenges array: 1-3 items targeting specific other parties
- concessions: at least 1 honest concession
- statement: the narrative version that reads as a coherent speech
- Output ONLY valid JSON, no markdown fences`

function countWords(text: string): number {
  return text.trim().split(/\s+/).length
}

function buildRoundInstructions(roundType: RepTurnInput["roundType"], budget: number): string {
  switch (roundType) {
    case "opening_statements":
      return `ROUND: Opening Statement. Present your party's position with force and conviction. Lay out your strongest evidence. Identify which other parties' positions concern you most. Budget: ~${budget} words.`
    case "rebuttals":
      return `ROUND: Rebuttal. You've read all opening statements. Attack the weakest arguments from other parties using evidence. Defend your position against the strongest critiques. Be specific about WHO you're challenging and WHY their evidence is weaker than yours. Budget: ~${budget} words.`
    case "closings_and_scenarios":
      return `ROUND: Closing + Scenario Proposal. Make your strongest final case. Propose or endorse 1-2 scenarios (with required conditions and falsification conditions). Explain what would prove you WRONG. Budget: ~${budget} words.`
  }
}

export async function runRepresentativeAgent(input: RepTurnInput): Promise<RepTurnOutput> {
  const { topicId, runId, sessionId, partyId, personaPrompt, personaTitle, speakingBudget, round, roundType, model } = input

  const budget = roundType === "opening_statements" ? speakingBudget.opening_statement
    : roundType === "rebuttals" ? speakingBudget.rebuttal
    : speakingBudget.closing

  const ctx = await buildAgentContext("forum", topicId)
  const contextStr = serializeContext(ctx)

  let priorTurnsStr = ""
  if (round > 1) {
    const priorTurns = await getPriorTurns(topicId, sessionId, { round: round - 1 })
    if (priorTurns.length > 0) {
      priorTurnsStr = "\n\nPRIOR ROUND STATEMENTS:\n" + priorTurns.map(t =>
        `[${t.party_name}]: ${t.position || t.statement.slice(0, 400)}...`
      ).join("\n\n")
    }
  }

  // Also include same-round prior turns for rebuttals (so later speakers can reference earlier ones)
  if (round >= 2) {
    const sameRoundTurns = await getPriorTurns(topicId, sessionId, { round })
    if (sameRoundTurns.length > 0) {
      priorTurnsStr += "\n\nEARLIER THIS ROUND:\n" + sameRoundTurns.map(t =>
        `[${t.party_name}]: ${t.position || t.statement.slice(0, 400)}...`
      ).join("\n\n")
    }
  }

  const party = await getPartyProfile(topicId, partyId)

  const systemPrompt = `PERSONA: ${personaPrompt}\n\n${BASE_SYSTEM}`
  const userPrompt = `TOPIC CONTEXT:\n${contextStr}

YOUR PARTY: ${party.name}
PARTY TYPE: ${party.type}
AGENDA: ${party.agenda}
MEANS: ${party.means.join(", ")}
VULNERABILITIES: ${party.vulnerabilities.join(", ")}
STANCE: ${party.stance}

${buildRoundInstructions(roundType, budget)}${priorTurnsStr}

Argue with conviction from ${party.name}'s perspective. Cite clues by ID from the context above.`

  const raw = await chatCompletionText({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.6,
    max_tokens: Math.max(budget * 3, 1000),
  })

  // Parse structured output
  let statement = raw
  let clues_cited: string[] = []
  let word_count = countWords(raw)
  let position: string | undefined
  let evidence: ForumTurn["evidence"]
  let challenges: ForumTurn["challenges"]
  let concessions: string[] | undefined
  let scenario_endorsement: string | undefined

  const jsonMatch = raw.match(/\{[\s\S]+\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      statement = parsed.statement ?? raw
      clues_cited = parsed.clues_cited ?? []
      word_count = parsed.word_count ?? countWords(statement)
      position = parsed.position
      evidence = parsed.evidence
      challenges = parsed.challenges
      concessions = parsed.concessions
      scenario_endorsement = parsed.scenario_endorsement
    } catch { /* use raw */ }
  }

  // Extract clue citations from text if not in structured output
  if (clues_cited.length === 0) {
    const matches = statement.match(/\[clue-\d+\]/g) ?? []
    clues_cited = [...new Set(matches.map(m => m.replace(/[\[\]]/g, "")))]
  }

  // Also extract from evidence/challenges if clues_cited is still empty
  if (clues_cited.length === 0 && evidence) {
    clues_cited = [...new Set(evidence.map(e => e.clue_id).filter(Boolean))]
  }

  const turn: ForumTurn = {
    id: `turn-${partyId}-r${round}`,
    representative_id: `rep-${partyId}`,
    party_name: party.name,
    persona_title: personaTitle,
    statement,
    position,
    evidence,
    challenges,
    concessions,
    scenario_endorsement: roundType === "closings_and_scenarios" ? scenario_endorsement : undefined,
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
