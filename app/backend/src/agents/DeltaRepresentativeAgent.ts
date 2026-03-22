import { chatCompletionText } from "../llm/proxyClient"
import { getClue } from "../tools/internal/getClue"
import { getPartyProfile } from "../tools/internal/getPartyProfile"
import { getPriorTurns } from "../tools/internal/getForumData"
import { writeArtifact } from "../tools/internal/artifactStore"
import { buildAgentContext, serializeContext } from "./contextBuilder"
import type { ForumTurn } from "../tools/internal/getForumData"
import { join } from "path"

function getDataDir() { return process.env.DATA_DIR || "/home/nima/dana/data" }

export interface DeltaContext {
  new_clues: string[]
  updated_clues: string[]
  affected_parties: string[]
  change_narrative: string
}

export interface DeltaTurn {
  id: string
  representative_id: string
  party_name: string
  type: "position_update"
  prior_position_summary: string
  updated_position: string
  position_delta: "upgraded" | "downgraded" | "unchanged" | "new_argument"
  clues_cited: string[]
  timestamp: string
  word_count: number
}

const DELTA_SYSTEM = `You are a forum representative providing a position update based on new evidence.

You previously argued for your party. New clues have emerged. Your task:
1. Summarize your prior position in 1-2 sentences
2. Assess how the new clues affect your party's position
3. Write an updated position statement
4. Classify the change: upgraded (stronger), downgraded (weaker), unchanged, or new_argument

OUTPUT FORMAT (JSON only):
{
  "prior_position_summary": "<1-2 sentence summary of your prior position>",
  "updated_position": "<your updated position statement with clue citations [clue-xxx]>",
  "position_delta": "upgraded" | "downgraded" | "unchanged" | "new_argument",
  "clues_cited": ["clue-id", ...]
}

Rules:
- You MUST reference your prior position and explain what changed
- Cite new/updated clues by ID
- Stay under 200 words for the updated position
- Be honest about whether new evidence helps or hurts your party`

export async function runDeltaRepresentativeAgent(
  topicId: string,
  runId: string,
  partyId: string,
  priorSessionId: string,
  deltaContext: DeltaContext,
  model: string,
  onProgress?: (msg: string) => void,
): Promise<DeltaTurn> {
  onProgress?.(`Delta rep ${partyId}: assessing new evidence`)

  const ctx = await buildAgentContext("delta", topicId)
  const contextStr = serializeContext(ctx)

  const party = await getPartyProfile(topicId, partyId)

  // Get prior turns for this party
  const priorTurns = await getPriorTurns(topicId, priorSessionId, { party_id: partyId })
  const priorStatementsStr = priorTurns.length > 0
    ? priorTurns.map(t => `[R${t.round}]: ${t.statement.slice(0, 400)}`).join("\n\n")
    : "No prior statements found."

  // Fetch full details of new/updated clues
  const clueDetails: string[] = []
  for (const cId of [...deltaContext.new_clues, ...deltaContext.updated_clues]) {
    try {
      const clue = await getClue(topicId, cId)
      clueDetails.push(`[${cId}] ${clue.title}: ${clue.bias_corrected_summary}`)
    } catch { /* skip missing */ }
  }

  // Load rep persona
  const repsFile = Bun.file(join(getDataDir(), "topics", topicId, "representatives.json"))
  const reps = await repsFile.json() as { party_id: string; persona_prompt: string }[]
  const rep = reps.find(r => r.party_id === partyId)
  const persona = rep?.persona_prompt ?? `You represent ${party.name}.`

  const userPrompt = `${persona}

CONTEXT:\n${contextStr}

YOUR PARTY: ${party.name}
AGENDA: ${party.agenda}

WHAT CHANGED:
${deltaContext.change_narrative}

NEW/UPDATED CLUES:
${clueDetails.join("\n")}

YOUR PRIOR STATEMENTS:
${priorStatementsStr}

Produce your position update as JSON.`

  let deltaTurn: Omit<DeltaTurn, "id" | "representative_id" | "party_name" | "type" | "timestamp" | "word_count"> | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await chatCompletionText({
      model,
      messages: [
        { role: "system", content: DELTA_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 800,
    })
    try {
      const match = raw.match(/\{[\s\S]+\}/)
      if (!match) throw new Error("No JSON found")
      deltaTurn = JSON.parse(match[0])
      break
    } catch (e) {
      console.warn(`Delta rep ${partyId} attempt ${attempt + 1} failed:`, e)
    }
  }

  if (!deltaTurn) throw new Error(`Delta rep ${partyId} failed after 3 attempts`)

  const result: DeltaTurn = {
    id: `delta-turn-${partyId}`,
    representative_id: `rep-${partyId}`,
    party_name: party.name,
    type: "position_update",
    prior_position_summary: deltaTurn.prior_position_summary,
    updated_position: deltaTurn.updated_position,
    position_delta: deltaTurn.position_delta,
    clues_cited: deltaTurn.clues_cited || [],
    timestamp: new Date().toISOString(),
    word_count: deltaTurn.updated_position?.split(/\s+/).length ?? 0,
  }

  await writeArtifact(topicId, runId, `delta_representative_${partyId}`, result)
  onProgress?.(`Delta rep ${partyId}: ${result.position_delta}`)

  return result
}
