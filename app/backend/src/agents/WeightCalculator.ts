import { chatCompletionText } from "../llm/proxyClient"
import { writeArtifact } from "../tools/internal/artifactStore"
import { buildAgentContext, serializeContext } from "./contextBuilder"
import { log } from "../utils/logger"
import { join } from "path"
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
  speaking_weight: number
  speaking_budget: SpeakingBudget
  auto_generated: true
}

export interface WeightCalculatorOutput {
  topic_id: string
  run_id: string
  party_weights: { party_id: string; weight: number; weight_factors: Party["weight_factors"] }[]
}

// Word pools per round type (total words split across all parties proportionally)
const ROUND_POOLS = { opening: 600, rebuttal: 400, closing: 300 }
const MIN_FLOOR = 150
const LOW_WEIGHT_THRESHOLD = 15

const WEIGHT_SYSTEM = `You are scoring party influence for geopolitical analysis.

For each party given, score their current influence on 5 dimensions (0-100 each) and compute an overall weight.

Output ONLY a valid JSON array:
[
  {
    "party_id": "<id>",
    "weight": <overall 0-100>,
    "weight_factors": {
      "military_capacity": <0-100>,
      "economic_control": <0-100>,
      "information_control": <0-100>,
      "international_support": <0-100>,
      "internal_legitimacy": <0-100>
    },
    "reasoning": "<1-2 sentences explaining the overall weight>"
  }
]

Rules:
- weight should reflect real-world influence on the specific topic, not just general power
- Show working: weight_factors drive the overall weight (roughly their average)
- Output ONLY the JSON array, no prose`

const PERSONA_SYSTEM = `Generate a representative persona prompt for a geopolitical forum advocate.

The advocate argues FOR their party using only evidence and logic — they are honest but partisan in focus.
They must: acknowledge strongest counter-arguments, cite clue IDs, apply the Steelman Protocol.

Output ONLY a 3-4 sentence persona prompt string (no JSON wrapper, just the plain text prompt).`

function getDataDir() { return process.env.DATA_DIR || "/home/nima/dana/data" }

function computeSpeakingBudget(weight: number, totalWeight: number, isLowWeight: boolean): SpeakingBudget {
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
  const partiesPath = join(getDataDir(), "topics", topicId, "parties.json")
  const partiesFile = Bun.file(partiesPath)
  const parties = await partiesFile.json() as Party[]

  const ctx = await buildAgentContext("weight", topicId)
  const contextStr = serializeContext(ctx)

  log.weight(`Scoring ${parties.length} parties: ${parties.map(p => p.name).join(", ")}`)
  onProgress?.(`WeightCalculator: scoring ${parties.length} parties`)

  // Score weights
  const partyList = parties.map(p => ({ id: p.id, name: p.name, type: p.type, agenda: p.agenda }))
  const prompt = `TOPIC: ${title}\n\nCONTEXT:\n${contextStr}\n\nPARTIES TO SCORE:\n${JSON.stringify(partyList, null, 2)}`

  let weightScores: { party_id: string; weight: number; weight_factors: Party["weight_factors"] }[] = []

  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await chatCompletionText({
      model,
      messages: [
        { role: "system", content: WEIGHT_SYSTEM },
        { role: "user", content: attempt === 0 ? prompt : `${prompt}\n\nOutput ONLY valid JSON array. No trailing commas.` },
      ],
      temperature: 0.2,
      max_tokens: 2000,
    })
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

  // Generate representative personas
  onProgress?.("WeightCalculator: generating representative personas")
  const representatives: Representative[] = []

  for (const party of parties) {
    const personaPrompt = `PARTY: ${party.name}\nAGENDA: ${party.agenda}\nTOPIC: ${title}`
    const persona = await chatCompletionText({
      model,
      messages: [
        { role: "system", content: PERSONA_SYSTEM },
        { role: "user", content: personaPrompt },
      ],
      temperature: 0.3,
      max_tokens: 200,
    })

    const isLowWeight = party.weight < LOW_WEIGHT_THRESHOLD
    const budget = computeSpeakingBudget(party.weight, totalWeight, isLowWeight)

    representatives.push({
      id: `rep-${party.id}`,
      party_id: party.id,
      persona_prompt: persona.trim(),
      speaking_weight: party.weight,
      speaking_budget: budget,
      auto_generated: true,
    })
  }

  // Write updated parties and representatives
  await Bun.write(partiesPath, JSON.stringify(parties, null, 2))
  const repsPath = join(getDataDir(), "topics", topicId, "representatives.json")
  await Bun.write(repsPath, JSON.stringify(representatives, null, 2))

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
