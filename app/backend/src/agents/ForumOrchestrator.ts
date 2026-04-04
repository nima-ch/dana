import { log } from "../utils/logger"
import { budgetOutput } from "../llm/tokenBudget"
import { chatCompletionText } from "../llm/proxyClient"
import { dbGetControls } from "../db/queries/settings"
import { runForumPrepAgent } from "./ForumPrepAgent"
import { runRepresentativeTurn } from "./RepresentativeAgent"
import { runDevilsAdvocate } from "./DevilsAdvocate"
import { ForumSupervisor, pickNextSpeaker, DEFAULT_MAX_TURNS, SUPERVISOR_CHECK_INTERVAL, COMPRESS_INTERVAL } from "./ForumSupervisor"
import { writeArtifact } from "../tools/internal/artifactStore"
import { writeForumSession, getForumSession } from "../tools/internal/getForumData"
import { emit, emitThink } from "../routes/stream"
import { dbGetRepresentatives, dbGetAllScratchpads } from "../db/queries/forum"
import { dbUpsertForumSession } from "../db/queries/forum"
import type { ForumSession, ForumTurn, Representative } from "../db/queries/forum"

export interface ForumOrchestratorOutput {
  session_id: string
  turns_completed: number
  scenario_count: number
  closure_reason: string
}

function getDataDir() { return process.env.DATA_DIR || "/home/nima/dana/data" }

// Format a flat list of turns into display text for the session (grouped by every 10)
function turnBatch(turnNumber: number): number {
  return Math.floor((turnNumber - 1) / 10) + 1
}

export async function runForumOrchestrator(
  topicId: string,
  runId: string,
  sessionId: string,
  model: string,
  _checkpoint: unknown,   // kept for API compatibility, unused in dynamic forum
  onProgress?: (msg: string) => void
): Promise<ForumOrchestratorOutput> {
  const representatives = dbGetRepresentatives(topicId) as Representative[]
  if (!representatives.length) throw new Error("No representatives found")

  log.separator()
  log.forum(`Forum starting: ${representatives.length} parties, session=${sessionId}`)
  log.forum(`Parties: ${representatives.map(r => `${r.party_id}(w=${r.speaking_weight})`).join(", ")}`)
  log.separator()

  // ── Initialize or resume session ─────────────────────────────────────────
  let session: ForumSession
  try {
    session = await getForumSession(topicId, sessionId)
    log.forum("Resuming existing session")
  } catch {
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

  // Retrieve topic title from DB for supervisor/context
  const { dbGetTopic } = await import("../db/queries/topics")
  const topicRow = dbGetTopic(topicId)
  const topicTitle = topicRow?.title ?? topicId

  const controls = dbGetControls()
  const maxTurns = controls.forum_max_turns
  const minTurns = Math.max(8, Math.floor(representatives.length * 1.5))

  // ── Phase 1: Preparation ─────────────────────────────────────────────────
  onProgress?.("Forum: agents preparing scratchpads…")
  emit(topicId, { type: "progress", stage: "forum", pct: 0.02, msg: "Representatives preparing…" })

  await runForumPrepAgent(topicId, topicTitle, sessionId, model, onProgress)
  emit(topicId, { type: "progress", stage: "forum", pct: 0.1, msg: "All representatives ready. Debate opening…" })

  // ── Phase 2: Dynamic debate loop ─────────────────────────────────────────
  const supervisor = new ForumSupervisor(topicId, sessionId, model, topicTitle, maxTurns, minTurns)

  // Track consecutive passes per party
  const consecutivePasses: Record<string, number> = {}
  representatives.forEach(r => { consecutivePasses[r.party_id] = 0 })

  // Flat list of all turns (for context building)
  const allTurns: ForumTurn[] = session.rounds.flatMap(r => r.turns)
  let turnNumber = allTurns.length + 1

  log.forum(`Debate opening at turn ${turnNumber} (max=${maxTurns}, min=${minTurns})`)
  emitThink(topicId, "🎙️", "Forum is open", `${representatives.length} parties ready to debate`)

  while (!supervisor.isDone) {
    // Balance correction — force underrepresented party if needed
    const forcedPartyId = supervisor.checkBalance(representatives)
    let selected: Representative

    if (forcedPartyId) {
      selected = representatives.find(r => r.party_id === forcedPartyId) ?? pickNextSpeaker(representatives)
      emitThink(topicId, "⚖️", `Balance correction`, `Giving floor to ${forcedPartyId}`)
    } else {
      selected = pickNextSpeaker(representatives)
    }

    onProgress?.(`Forum turn ${turnNumber}: ${selected.party_id}`)
    emitThink(topicId, "🗣️", `${selected.party_id}`, `Turn ${turnNumber}`)

    const myTurnCount = supervisor.turnDistribution[selected.party_id] ?? 0

    // Run the turn
    const { turn, passed } = await runRepresentativeTurn({
      topicId,
      runId,
      sessionId,
      partyId: selected.party_id,
      personaTitle: selected.persona_title,
      model,
      turnNumber,
      myTurnCount,
      speakingWeight: selected.speaking_weight,
      consecutivePasses: consecutivePasses[selected.party_id] ?? 0,
      recentTurns: allTurns.slice(-8),
      compressedHistory: supervisor.compressedHistory,
      liveScenarios: supervisor.liveScenarios,
      topic: topicTitle,
    })

    if (passed) {
      consecutivePasses[selected.party_id] = (consecutivePasses[selected.party_id] ?? 0) + 1
      log.forum(`  ${selected.party_id} passed (consecutive passes: ${consecutivePasses[selected.party_id]})`)
    } else if (turn) {
      consecutivePasses[selected.party_id] = 0
      allTurns.push(turn)

      // Store turn in session — batch by groups of 10
      const batchNum = turnBatch(turnNumber)
      let roundEntry = session.rounds.find(r => r.round === batchNum)
      if (!roundEntry) {
        roundEntry = { round: batchNum, type: "debate", turns: [] }
        session.rounds.push(roundEntry)
      }
      roundEntry.turns.push(turn)
      await writeForumSession(topicId, session)

      // Emit live turn event
      emit(topicId, { type: "forum_turn", turn: turn as unknown as Record<string, unknown> })

      supervisor.observeTurn(turn)
      turnNumber++

      // Supervisor checks every SUPERVISOR_CHECK_INTERVAL turns
      if (allTurns.length % SUPERVISOR_CHECK_INTERVAL === 0) {
        const recentTurns = allTurns.slice(-10)
        const [scenarios, completion] = await Promise.all([
          supervisor.updateScenarios(allTurns),
          supervisor.checkCompletion(recentTurns),
        ])

        // Update session scenarios
        session.scenarios = scenarios
        await writeForumSession(topicId, session)

        emit(topicId, { type: "progress", stage: "forum", pct: Math.min(0.1 + (allTurns.length / maxTurns) * 0.7, 0.8), msg: `Turn ${allTurns.length}: ${completion.coverage_score}% coverage` })

        if (completion.done) {
          log.forum(`Debate closed by supervisor at turn ${allTurns.length}: ${completion.reason}`)
          break
        }
      }

      // Compress history every COMPRESS_INTERVAL turns
      if (allTurns.length % COMPRESS_INTERVAL === 0) {
        await supervisor.compressHistory(allTurns)
      }
    }

    // Safety: if all parties are passing continuously, force a speak
    const allPassing = representatives.every(r => (consecutivePasses[r.party_id] ?? 0) >= 2)
    if (allPassing) {
      log.forum("All parties passing — resetting pass counts to force engagement")
      representatives.forEach(r => { consecutivePasses[r.party_id] = 0 })
    }
  }

  log.forum(`Debate ended after ${allTurns.length} turns`)
  emit(topicId, { type: "progress", stage: "forum", pct: 0.82, msg: "Debate concluded — running Devil's Advocate…" })

  // ── Phase 3: Final scenario update ────────────────────────────────────────
  const finalScenarios = await supervisor.updateScenarios(allTurns)
  session.scenarios = finalScenarios

  // ── Phase 4: Devil's Advocate ─────────────────────────────────────────────
  if (finalScenarios.length > 0) {
    // Sort by support count so DA targets the most-supported scenario
    const sorted = [...finalScenarios].sort((a, b) => b.supported_by.length - a.supported_by.length)
    session.scenarios = sorted
    await writeForumSession(topicId, session)

    try {
      log.forum("Devil's Advocate starting")
      await runDevilsAdvocate(topicId, runId, sessionId, model)
    } catch (e) {
      log.forum(`Devil's Advocate failed (non-fatal): ${e}`)
    }
  }

  emit(topicId, { type: "progress", stage: "forum", pct: 0.9, msg: "Synthesizing debate summary…" })

  // ── Phase 5: Debate summary for expert council ────────────────────────────
  const allScratchpads = dbGetAllScratchpads(topicId, sessionId)
  const debateSummary = await synthesizeDebate(topicTitle, allTurns, finalScenarios, model)

  // ── Phase 6: Finalize session ─────────────────────────────────────────────
  const contestedClues = computeContestedClues(allTurns)
  const uncontestedClues = computeUncontestedClues(allTurns, contestedClues)

  session.scenario_summary = {
    scenarios: finalScenarios.map(s => ({
      id: s.id,
      title: s.title,
      key_clues: s.clues_cited,
      required_conditions: s.required_conditions,
      falsification_conditions: s.falsification_conditions,
    })),
    contested_clues: contestedClues,
    uncontested_clues: uncontestedClues,
  }
  session.status = "complete"
  session.completed_at = new Date().toISOString()
  await writeForumSession(topicId, session)

  const output: ForumOrchestratorOutput = {
    session_id: sessionId,
    turns_completed: allTurns.length,
    scenario_count: finalScenarios.length,
    closure_reason: supervisor.isDone ? "supervisor" : "max_turns",
  }

  await writeArtifact(topicId, runId, "forum_orchestrator", {
    ...output,
    debate_summary: debateSummary,
    scratchpads: allScratchpads.map(s => ({ party_id: s.party_id, content: s.content })),
  })

  emit(topicId, { type: "stage_complete", stage: "forum", session_id: sessionId })
  log.forum(`Forum complete: ${allTurns.length} turns, ${finalScenarios.length} scenarios`)

  return output
}

async function synthesizeDebate(
  topic: string,
  allTurns: ForumTurn[],
  scenarios: { title: string; description: string; supported_by: string[]; contested_by: string[] }[],
  model: string
): Promise<string> {
  const turnsStr = allTurns
    .map(t => `[${t.party_name}]: ${t.statement.slice(0, 200)}`)
    .join("\n\n")

  const scenariosStr = scenarios
    .map(s => `• ${s.title}: ${s.description} (for: ${s.supported_by.join(", ")}, against: ${s.contested_by.join(", ")})`)
    .join("\n")

  try {
    return await chatCompletionText({
      model,
      messages: [
        {
          role: "system",
          content: "You are summarizing a multi-party geopolitical forum debate for expert analysts. Produce a 4-6 paragraph dense summary covering: the main positions argued, key clues cited and disputed, how scenarios emerged from the debate, and where parties found unexpected common ground or irreconcilable disagreement. Preserve clue IDs inline.",
        },
        {
          role: "user",
          content: `TOPIC: ${topic}\n\nSCENARIOS THAT EMERGED:\n${scenariosStr}\n\nDEBATE TRANSCRIPT (truncated):\n${turnsStr.slice(0, 12000)}`,
        },
      ],
      temperature: 0.3,
      max_tokens: budgetOutput(model, turnsStr.slice(0, 12000) + scenariosStr, { min: 800, max: 2000 }),
    })
  } catch {
    return "Debate summary unavailable."
  }
}

function computeContestedClues(turns: ForumTurn[]) {
  const clueRepMap = new Map<string, Set<string>>()
  for (const t of turns) {
    for (const cid of t.clues_cited) {
      if (!clueRepMap.has(cid)) clueRepMap.set(cid, new Set())
      clueRepMap.get(cid)!.add(t.representative_id)
    }
  }
  const contested: { clue_id: string; cited_by: string[]; conflict: string }[] = []
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

function computeUncontestedClues(turns: ForumTurn[], contested: { clue_id: string }[]) {
  const contestedIds = new Set(contested.map(c => c.clue_id))
  const allCited = new Set(turns.flatMap(t => t.clues_cited))
  return [...allCited].filter(id => !contestedIds.has(id))
}
