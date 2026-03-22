import { runRepresentativeAgent } from "./RepresentativeAgent"
import { runDevilsAdvocate } from "./DevilsAdvocate"
import { readArtifact, writeArtifact } from "../tools/internal/artifactStore"
import { writeForumSession, getForumSession } from "../tools/internal/getForumData"
import { markTurnComplete, isTurnComplete, writeCheckpoint } from "../pipeline/checkpointManager"
import { emit } from "../routes/stream"
import { join } from "path"
import type { ForumSession, ForumTurn, ForumScenario, ScenarioSummary } from "../tools/internal/getForumData"
import type { Representative } from "./WeightCalculator"
import { chatCompletionText } from "../llm/proxyClient"
import { buildAgentContext, serializeContext } from "./contextBuilder"

export interface ForumOrchestratorOutput {
  session_id: string
  rounds_completed: number
  scenario_count: number
  contested_clue_count: number
}

const SCENARIO_SYSTEM = `You are synthesizing forum debate into structured scenarios.

Given all forum turns, produce a list of distinct scenarios.

Output ONLY valid JSON array:
[
  {
    "id": "scenario-a",
    "title": "<concise title>",
    "description": "<2-3 sentence description>",
    "proposed_by": "<representative_id>",
    "supported_by": ["<rep_id>", ...],
    "contested_by": ["<rep_id>", ...],
    "clues_cited": ["clue-id", ...],
    "benefiting_parties": ["<party_id>", ...],
    "required_conditions": ["<condition>", ...],
    "falsification_conditions": ["<condition>", ...]
  }
]

Rules:
- Deduplicate similar scenarios — merge overlapping ones
- Each scenario must have ≥1 required_condition and ≥1 falsification_condition
- Output ONLY the JSON array`

function getDataDir() { return process.env.DATA_DIR || "/home/nima/dana/data" }

async function loadRepresentatives(topicId: string): Promise<Representative[]> {
  const f = Bun.file(join(getDataDir(), "topics", topicId, "representatives.json"))
  if (!(await f.exists())) return []
  return f.json()
}

function sortByWeight(reps: Representative[], ascending = false): Representative[] {
  return [...reps].sort((a, b) => ascending ? a.speaking_weight - b.speaking_weight : b.speaking_weight - a.speaking_weight)
}

function computeContestedClues(turns: ForumTurn[]): ScenarioSummary["contested_clues"] {
  // Track which reps cited each clue
  const clueRepMap = new Map<string, Set<string>>()
  for (const turn of turns) {
    for (const clueId of turn.clues_cited) {
      if (!clueRepMap.has(clueId)) clueRepMap.set(clueId, new Set())
      clueRepMap.get(clueId)!.add(turn.representative_id)
    }
  }

  const contested: ScenarioSummary["contested_clues"] = []
  for (const [clueId, reps] of clueRepMap.entries()) {
    if (reps.size >= 2) {
      contested.push({
        clue_id: clueId,
        cited_by: [...reps],
        conflict: `Cited by ${reps.size} different parties with potentially conflicting interpretations`,
      })
    }
  }
  return contested
}

function computeUncontestedClues(turns: ForumTurn[], contested: ScenarioSummary["contested_clues"]): string[] {
  const contestedIds = new Set(contested.map(c => c.clue_id))
  const allCited = new Set(turns.flatMap(t => t.clues_cited))
  return [...allCited].filter(id => !contestedIds.has(id))
}

export async function runForumOrchestrator(
  topicId: string,
  runId: string,
  sessionId: string,
  model: string,
  checkpoint: Awaited<ReturnType<typeof import("../pipeline/checkpointManager").readCheckpoint>>,
  onProgress?: (msg: string) => void
): Promise<ForumOrchestratorOutput> {
  const representatives = await loadRepresentatives(topicId)
  if (!representatives.length) throw new Error("No representatives found")

  // Initialize or resume forum session
  let session: ForumSession
  const sessionFilePath = join(getDataDir(), "topics", topicId, `${sessionId}.json`)
  const sessionFile = Bun.file(sessionFilePath)

  if (await sessionFile.exists()) {
    session = await sessionFile.json()
  } else {
    session = {
      session_id: sessionId,
      version: 1,
      type: "full",
      status: "running",
      started_at: new Date().toISOString(),
      rounds: [],
      scenarios: [],
    }
    await writeForumSession(topicId, session)
  }

  const roundDefs: { round: number; type: ForumTurn["type"]; reps: Representative[] }[] = [
    { round: 1, type: "opening_statements", reps: sortByWeight(representatives) },
    { round: 2, type: "rebuttals", reps: sortByWeight(representatives, true) }, // ascending — lightest first
    { round: 3, type: "closings_and_scenarios", reps: sortByWeight(representatives) },
  ]

  for (const { round, type, reps } of roundDefs) {
    // Ensure round exists in session
    if (!session.rounds.find(r => r.round === round)) {
      session.rounds.push({ round, type, turns: [] })
      await writeForumSession(topicId, session)
    }

    await writeCheckpoint(topicId, runId, { stage: "forum", step: round })
    onProgress?.(`Forum Round ${round}: ${type}`)

    for (const rep of reps) {
      const turnId = `${rep.party_id}-r${round}`
      if (isTurnComplete(checkpoint, turnId)) {
        onProgress?.(`Forum: skipping completed turn ${turnId} (resume)`)
        continue
      }

      onProgress?.(`Forum Round ${round}: ${rep.party_id} speaking`)

      const { turn } = await runRepresentativeAgent({
        topicId, runId, sessionId,
        partyId: rep.party_id,
        personaPrompt: rep.persona_prompt,
        speakingBudget: rep.speaking_budget,
        round,
        roundType: type as any,
        model,
      })

      // Append turn to session
      const roundEntry = session.rounds.find(r => r.round === round)!
      roundEntry.turns.push(turn)
      await writeForumSession(topicId, session)

      // Emit SSE event for live streaming
      emit(topicId, { type: "forum_turn", turn: turn as unknown as Record<string, unknown> })

      await markTurnComplete(topicId, runId, turnId)
    }
  }

  onProgress?.("Forum: synthesizing scenarios")

  // Synthesize scenarios from all turns
  const allTurns = session.rounds.flatMap(r => r.turns)
  const ctx = await buildAgentContext("forum", topicId)
  const contextStr = serializeContext(ctx)
  const turnsStr = allTurns.map(t => `[${t.party_name} R${t.round}]: ${t.statement.slice(0, 300)}`).join("\n\n")

  let scenarios: ForumScenario[] = []
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await chatCompletionText({
      model,
      messages: [
        { role: "system", content: SCENARIO_SYSTEM },
        { role: "user", content: `CONTEXT:\n${contextStr}\n\nFORUM TURNS:\n${turnsStr}\n\nSynthesize distinct scenarios.` },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    })
    try {
      const match = raw.match(/\[[\s\S]+\]/)
      if (!match) throw new Error("No array found")
      scenarios = JSON.parse(match[0])
      break
    } catch (e) {
      console.warn(`Scenario synthesis attempt ${attempt + 1} failed:`, e)
    }
  }

  // Devil's Advocate pass
  onProgress?.("Forum: Devil's Advocate pass")
  if (scenarios.length > 0) {
    session.scenarios = scenarios
    await writeForumSession(topicId, session)
    try {
      await runDevilsAdvocate(topicId, runId, sessionId, model)
    } catch (e) {
      console.warn("DevilsAdvocate failed:", e)
    }
  }

  // Compute contested/uncontested clues
  const contested = computeContestedClues(allTurns)
  const uncontested = computeUncontestedClues(allTurns, contested)

  const scenarioSummary: ScenarioSummary = {
    scenarios: scenarios.map(s => ({
      id: s.id,
      title: s.title,
      key_clues: s.clues_cited,
      required_conditions: s.required_conditions,
      falsification_conditions: s.falsification_conditions,
    })),
    contested_clues: contested,
    uncontested_clues: uncontested,
  }

  // Finalize session
  session.scenarios = scenarios
  session.scenario_summary = scenarioSummary
  session.status = "complete"
  session.completed_at = new Date().toISOString()
  await writeForumSession(topicId, session)

  emit(topicId, { type: "stage_complete", stage: "forum", session_id: sessionId })

  const output: ForumOrchestratorOutput = {
    session_id: sessionId,
    rounds_completed: 3,
    scenario_count: scenarios.length,
    contested_clue_count: contested.length,
  }

  await writeArtifact(topicId, runId, "forum_orchestrator", output)
  return output
}
