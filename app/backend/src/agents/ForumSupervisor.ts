import { chatCompletionText } from "../llm/proxyClient"
import { budgetOutput } from "../llm/tokenBudget"
import { resolvePrompt } from "../llm/promptLoader"
import { runAgenticLoop } from "../llm/agenticLoop"
import { log } from "../utils/logger"
import { emitThink } from "../routes/stream"
import { dbUpsertSupervisorState, dbGetSupervisorState } from "../db/queries/forum"
import type { ForumTurn, ForumScenario, SupervisorState } from "../db/queries/forum"
import type { Representative } from "../db/queries/forum"

export const DEFAULT_MAX_TURNS = 50
export const SUPERVISOR_CHECK_INTERVAL = 5
const BALANCE_THRESHOLD = 0.3   // actual share must be >= 30% of expected
const BALANCE_MIN_TURNS = 10    // don't correct balance in first 10 turns
export const COMPRESS_INTERVAL = 10    // compress history every N turns

export interface SupervisorResult {
  done: boolean
  reason: string
  coverage_score: number
}

export class ForumSupervisor {
  private state: SupervisorState
  private topicId: string
  private model: string
  private topic: string
  private maxTurns: number
  private minTurns: number

  constructor(
    topicId: string,
    sessionId: string,
    model: string,
    topic: string,
    maxTurns: number = DEFAULT_MAX_TURNS,
    minTurns: number = 8,
  ) {
    this.topicId = topicId
    this.model = model
    this.topic = topic
    this.maxTurns = maxTurns
    this.minTurns = minTurns

    // Load existing state or create fresh
    const existing = dbGetSupervisorState(topicId, sessionId)
    this.state = existing ?? {
      session_id: sessionId,
      topic_id: topicId,
      turn_count: 0,
      turn_distribution: {},
      live_scenarios: [],
      compressed_history: "",
      status: "running",
      updated_at: new Date().toISOString(),
    }
  }

  get turnCount(): number { return this.state.turn_count }
  get liveScenarios(): ForumScenario[] { return this.state.live_scenarios }
  get compressedHistory(): string { return this.state.compressed_history }
  get turnDistribution(): Record<string, number> { return this.state.turn_distribution }
  get isDone(): boolean { return this.state.status === "done" }

  // Called after every turn — no LLM, pure bookkeeping
  observeTurn(turn: ForumTurn): void {
    this.state.turn_count++
    const partyId = turn.representative_id.replace("rep-", "")
    this.state.turn_distribution[partyId] = (this.state.turn_distribution[partyId] ?? 0) + 1
    this.state.updated_at = new Date().toISOString()
    this.persist()
  }

  // Check if a party needs to be forced next due to imbalance
  checkBalance(reps: Representative[]): string | null {
    if (this.state.turn_count < BALANCE_MIN_TURNS) return null
    const total = this.state.turn_count
    for (const r of reps) {
      const expectedShare = r.speaking_weight / 100
      const actualCount = this.state.turn_distribution[r.party_id] ?? 0
      const actualShare = actualCount / total
      if (actualShare < expectedShare * BALANCE_THRESHOLD) {
        log.forum(`  Balance correction: ${r.party_id} has ${(actualShare * 100).toFixed(1)}% of turns (expected ~${(expectedShare * 100).toFixed(1)}%)`)
        return r.party_id
      }
    }
    return null
  }

  // Update scenario list from debate — every SUPERVISOR_CHECK_INTERVAL turns
  async updateScenarios(allTurns: ForumTurn[]): Promise<ForumScenario[]> {
    if (allTurns.length === 0) return this.state.live_scenarios

    const turnsStr = allTurns
      .map(t => `[${t.party_name} T${t.round}]: ${t.statement.slice(0, 250)}`)
      .join("\n\n")

    const currentScenariosStr = JSON.stringify(this.state.live_scenarios, null, 2)

    const scenariosConfig = await resolvePrompt("forum/supervisor-scenarios", {
      topic: this.topic,
      current_scenarios: currentScenariosStr,
      all_turns: turnsStr,
    })
    const effectiveModel = scenariosConfig.model ?? this.model

    const budget = budgetOutput(effectiveModel, scenariosConfig.content, { min: 1500, max: 4000 })

    try {
      let raw: string
      if (scenariosConfig.tools.length > 0) {
        raw = await runAgenticLoop({
          model: effectiveModel,
          topicId: this.topicId,
          tools: scenariosConfig.tools,
          temperature: 0.2,
          max_tokens: budget,
          messages: [
            { role: "system", content: scenariosConfig.content },
            { role: "user", content: "Update the scenario list based on the debate so far." },
          ],
        })
      } else {
        raw = await chatCompletionText({
          model: effectiveModel,
          messages: [
            { role: "system", content: scenariosConfig.content },
            { role: "user", content: "Update the scenario list based on the debate so far." },
          ],
          temperature: 0.2,
          max_tokens: budget,
        })
      }

      const match = raw.match(/\[[\s\S]+\]/)
      if (!match) throw new Error("No JSON array in scenarios response")
      const updated = JSON.parse(match[0]) as ForumScenario[]
      this.state.live_scenarios = updated
      this.persist()
      log.forum(`  Supervisor: ${updated.length} scenarios tracked`)
      emitThink(this.topicId, "📊", `Scenarios updated`, `${updated.length} scenarios on the table`)
      return updated
    } catch (e) {
      log.forum(`  Supervisor scenario update failed: ${e}`)
      return this.state.live_scenarios
    }
  }

  // Check if debate is complete — every SUPERVISOR_CHECK_INTERVAL turns
  async checkCompletion(recentTurns: ForumTurn[]): Promise<SupervisorResult> {
    if (this.state.turn_count >= this.maxTurns) {
      const result = { done: true, reason: `Hard ceiling of ${this.maxTurns} turns reached`, coverage_score: 75 }
      this.markDone(result.reason)
      return result
    }

    if (this.state.turn_count < this.minTurns) {
      return { done: false, reason: `Only ${this.state.turn_count} turns — minimum is ${this.minTurns}`, coverage_score: 0 }
    }

    const recentStr = recentTurns
      .map(t => `[${t.party_name}]: ${t.statement.slice(0, 200)}`)
      .join("\n\n")

    const distStr = Object.entries(this.state.turn_distribution)
      .map(([id, count]) => `${id}: ${count} turns`)
      .join(", ")

    const completionConfig = await resolvePrompt("forum/supervisor-completion", {
      topic: this.topic,
      turn_count: String(this.state.turn_count),
      turn_distribution: distStr,
      scenarios: JSON.stringify(this.state.live_scenarios, null, 2),
      recent_turns: recentStr,
      min_turns: String(this.minTurns),
    })
    const completionModel = completionConfig.model ?? this.model

    const budget = budgetOutput(completionModel, completionConfig.content, { min: 200, max: 500 })

    try {
      let raw: string
      if (completionConfig.tools.length > 0) {
        raw = await runAgenticLoop({
          model: completionModel,
          topicId: this.topicId,
          tools: completionConfig.tools,
          temperature: 0.2,
          max_tokens: budget,
          messages: [
            { role: "system", content: completionConfig.content },
            { role: "user", content: "Should the forum close?" },
          ],
        })
      } else {
        raw = await chatCompletionText({
          model: completionModel,
          messages: [
            { role: "system", content: completionConfig.content },
            { role: "user", content: "Should the forum close?" },
          ],
          temperature: 0.2,
          max_tokens: budget,
        })
      }

      const match = raw.match(/\{[\s\S]+\}/)
      if (!match) throw new Error("No JSON in completion response")
      const result = JSON.parse(match[0]) as SupervisorResult

      log.forum(`  Supervisor completion check: done=${result.done}, coverage=${result.coverage_score}, reason="${result.reason}"`)

      if (result.done) this.markDone(result.reason)
      return result
    } catch (e) {
      log.forum(`  Supervisor completion check failed: ${e}`)
      return { done: false, reason: "Check failed", coverage_score: 50 }
    }
  }

  // Compress conversation history — called every COMPRESS_INTERVAL turns
  async compressHistory(allTurns: ForumTurn[]): Promise<void> {
    if (allTurns.length < COMPRESS_INTERVAL) return

    // Compress all but the last 8 turns
    const toCompress = allTurns.slice(0, -8)
    if (toCompress.length === 0) return

    const turnsStr = toCompress
      .map(t => `[${t.party_name}]: ${t.statement.slice(0, 300)}`)
      .join("\n\n")

    try {
      const raw = await chatCompletionText({
        model: this.model,
        messages: [
          {
            role: "system",
            content: "You are summarizing a geopolitical debate transcript. Produce a dense, neutral summary that preserves: who argued what position, which clues were cited and how, which scenarios emerged, and any key concessions or disputes. Preserve clue IDs. Be comprehensive — this replaces the original transcript.",
          },
          { role: "user", content: `Summarize this debate transcript:\n\n${turnsStr}` },
        ],
        temperature: 0.2,
        max_tokens: 1500,
      })

      this.state.compressed_history = raw.trim()
      this.persist()
      log.forum(`  Supervisor: history compressed (${toCompress.length} turns → ${raw.length} chars)`)
    } catch (e) {
      log.forum(`  History compression failed: ${e}`)
    }
  }

  private markDone(reason: string): void {
    this.state.status = "done"
    this.state.closure_reason = reason
    this.state.updated_at = new Date().toISOString()
    this.persist()
  }

  private persist(): void {
    dbUpsertSupervisorState(this.topicId, this.state)
  }
}

// Pick next speaker by weighted random draw
export function pickNextSpeaker(reps: Representative[]): Representative {
  const totalWeight = reps.reduce((s, r) => s + r.speaking_weight, 0)
  const roll = Math.random() * totalWeight
  let cumulative = 0
  for (const r of reps) {
    cumulative += r.speaking_weight
    if (roll <= cumulative) return r
  }
  return reps[reps.length - 1]
}
