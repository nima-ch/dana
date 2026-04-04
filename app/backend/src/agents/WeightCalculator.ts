import { chatCompletionText } from "../llm/proxyClient"
import { budgetOutput, fitContext } from "../llm/tokenBudget"
import { resolvePrompt } from "../llm/promptLoader"
import { runAgenticLoop } from "../llm/agenticLoop"
import { dbGetControls } from "../db/queries/settings"
import { writeArtifact } from "../tools/internal/artifactStore"
import { buildAgentContext, serializeContext } from "./contextBuilder"
import { emitThink } from "../routes/stream"
import { log } from "../utils/logger"
import { dbGetParties, dbSetParties } from "../db/queries/parties"
import { dbSetRepresentatives } from "../db/queries/forum"
import type { Party } from "./DiscoveryAgent"

export interface SpeakingBudget {
  opening_statement: number
  rebuttal: number
  closing: number
  minimum_floor: number
}

export interface Representative {
  id: string
  party_id: string
  persona_prompt: string
  persona_title: string
  speaking_weight: number
  speaking_budget: SpeakingBudget
  auto_generated: true
}

export interface WeightCalculatorOutput {
  topic_id: string
  run_id: string
  party_weights: { party_id: string; weight: number; weight_factors: Party["weight_factors"] }[]
}

const LOW_WEIGHT_THRESHOLD = 15


function computeSpeakingBudget(weight: number, totalWeight: number, isLowWeight: boolean): SpeakingBudget {
  const controls = dbGetControls()
  const ROUND_POOLS = { opening: controls.forum_speaking_budget, rebuttal: Math.round(controls.forum_speaking_budget * 0.67), closing: Math.round(controls.forum_speaking_budget * 0.5) }
  const MIN_FLOOR = controls.forum_min_speaking_floor
  if (isLowWeight) {
    return { opening_statement: MIN_FLOOR, rebuttal: MIN_FLOOR, closing: MIN_FLOOR, minimum_floor: MIN_FLOOR }
  }
  const ratio = weight / totalWeight
  return {
    opening_statement: Math.max(MIN_FLOOR, Math.round(ratio * ROUND_POOLS.opening)),
    rebuttal: Math.max(MIN_FLOOR, Math.round(ratio * ROUND_POOLS.rebuttal)),
    closing: Math.max(MIN_FLOOR, Math.round(ratio * ROUND_POOLS.closing)),
    minimum_floor: MIN_FLOOR,
  }
}

export async function runWeightCalculator(
  topicId: string,
  title: string,
  model: string,
  runId: string,
  onProgress?: (msg: string) => void
): Promise<WeightCalculatorOutput> {
  const weightConfig = await resolvePrompt("weight/weight-scoring")
  const weightModel = weightConfig.model ?? model
  const personaConfig = await resolvePrompt("weight/persona-generation")
  const personaModel = personaConfig.model ?? model

  const parties = dbGetParties(topicId)
  const ctx = await buildAgentContext("weight", topicId)
  const contextStr = serializeContext(ctx)

  log.weight(`Scoring ${parties.length} parties: ${parties.map(p => p.name).join(", ")}`)
  onProgress?.(`WeightCalculator: scoring ${parties.length} parties`)
  emitThink(topicId, "⚖️", "Calculating party weights", `${parties.length} parties`)

  // Score weights
  const partyList = parties.map(p => ({ id: p.id, name: p.name, type: p.type, agenda: p.agenda }))
  const fittedContext = fitContext([
    { content: `TOPIC: ${title}`, priority: 10, label: "topic" },
    { content: `PARTIES TO SCORE:\n${JSON.stringify(partyList, null, 2)}`, priority: 9, label: "parties" },
    { content: `CONTEXT:\n${contextStr}`, priority: 5, label: "clue context" },
  ], 50_000)
  const prompt = fittedContext

  const outputBudget = budgetOutput(weightModel, weightConfig.content + prompt, { min: 2000, max: Math.max(parties.length * 350, 3000) })

  let weightScores: { party_id: string; weight: number; weight_factors: Party["weight_factors"] }[] = []

  for (let attempt = 0; attempt < 3; attempt++) {
    const userContent = attempt === 0 ? prompt : `${prompt}\n\nOutput ONLY valid JSON array. No trailing commas.`
    let raw: string
    if (weightConfig.tools.length > 0) {
      raw = await runAgenticLoop({
        model: weightModel,
        messages: [
          { role: "system", content: weightConfig.content },
          { role: "user", content: userContent },
        ],
        tools: weightConfig.tools,
        topicId,
        stage: "weight",
        temperature: 0.2,
        max_tokens: outputBudget,
      })
    } else {
      raw = await chatCompletionText({
        model: weightModel,
        messages: [
          { role: "system", content: weightConfig.content },
          { role: "user", content: userContent },
        ],
        temperature: 0.2,
        max_tokens: outputBudget,
      })
    }
    try {
      const match = raw.match(/\[[\s\S]+\]/)
      if (!match) throw new Error("No array found")
      weightScores = JSON.parse(match[0])
      break
    } catch (e) {
      console.warn(`WeightCalculator parse attempt ${attempt + 1} failed:`, e)
    }
  }

  if (!weightScores.length) throw new Error("WeightCalculator: failed to parse weight scores")

  // Apply scores to parties
  const totalWeight = weightScores.reduce((sum, s) => sum + s.weight, 0)
  for (const party of parties) {
    const score = weightScores.find(s => s.party_id === party.id)
    if (score) {
      party.weight = score.weight
      party.weight_factors = score.weight_factors
    }
  }

  // Generate representative personas (batched for speed)
  onProgress?.(`WeightCalculator: generating ${parties.length} representative personas`)
  const representatives: Representative[] = []

  const controls = dbGetControls()
  const PERSONA_BATCH = controls.forum_persona_batch
  for (let bi = 0; bi < parties.length; bi += PERSONA_BATCH) {
    const batch = parties.slice(bi, bi + PERSONA_BATCH)
    onProgress?.(`WeightCalculator: personas ${bi + 1}-${Math.min(bi + PERSONA_BATCH, parties.length)} of ${parties.length}`)

    const batchResults = await Promise.all(batch.map(async (party) => {
      const personaInput = `PARTY: ${party.name}\nTYPE: ${party.type}\nAGENDA: ${party.agenda}\nMEANS: ${party.means.join(", ")}\nSTANCE: ${party.stance}\nTOPIC: ${title}`
      let personaRaw: string
      if (personaConfig.tools.length > 0) {
        personaRaw = await runAgenticLoop({
          model: personaModel,
          messages: [
            { role: "system", content: personaConfig.content },
            { role: "user", content: personaInput },
          ],
          tools: personaConfig.tools,
          topicId,
          stage: "weight",
          temperature: 0.4,
          max_tokens: 400,
        })
      } else {
        personaRaw = await chatCompletionText({
          model: personaModel,
          messages: [
            { role: "system", content: personaConfig.content },
            { role: "user", content: personaInput },
          ],
          temperature: 0.4,
          max_tokens: 400,
        })
      }

      let personaTitle = party.name + " Representative"
      let personaPrompt = personaRaw.trim()

      try {
        const match = personaRaw.match(/\{[\s\S]+\}/)
        if (match) {
          const parsed = JSON.parse(match[0])
          personaTitle = parsed.title || personaTitle
          personaPrompt = parsed.prompt || personaPrompt
        }
      } catch { /* use raw */ }

      const isLowWeight = party.weight < LOW_WEIGHT_THRESHOLD
      const budget = computeSpeakingBudget(party.weight, totalWeight, isLowWeight)

      const rep = {
        id: `rep-${party.id}`,
        party_id: party.id,
        persona_prompt: personaPrompt,
        persona_title: personaTitle,
        speaking_weight: party.weight,
        speaking_budget: budget,
        auto_generated: true,
      } as Representative

      emitThink(topicId, "🎭", `Representative created · ${party.name}`, `${personaTitle} · weight ${party.weight}`)

      return rep
    }))

    representatives.push(...batchResults)
  }

  // Persist updated parties and representatives to DB
  dbSetParties(topicId, parties)
  dbSetRepresentatives(topicId, representatives)

  const output: WeightCalculatorOutput = {
    topic_id: topicId,
    run_id: runId,
    party_weights: weightScores,
  }

  await writeArtifact(topicId, runId, "weight_calculation", output)
  log.weight(`Results: ${representatives.map(r => `${r.party_id}=${r.speaking_weight}w (opening=${r.speaking_budget.opening_statement}w)`).join(", ")}`)
  onProgress?.(`WeightCalculator: done. ${representatives.length} representatives created`)
  return output
}
