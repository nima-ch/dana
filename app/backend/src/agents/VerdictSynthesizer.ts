import { chatCompletionText } from "../llm/proxyClient"
import { log } from "../utils/logger"
import { readArtifact, writeArtifact } from "../tools/internal/artifactStore"
import { getScenarioSummary } from "../tools/internal/getForumData"
import { join } from "path"
import type {
  ExpertArtifact,
  ExpertCouncilOutput,
  ExpertPersona,
  FinalVerdict,
  RankedScenario,
  WeightChallengeDecision,
} from "./ExpertAgent"

function getDataDir() { return process.env.DATA_DIR || "/home/nima/dana/data" }

function resolveWeightChallenges(deliberations: ExpertArtifact[]): WeightChallengeDecision[] {
  // Group challenges by party_id + dimension
  const grouped = new Map<string, { flagged_by: string[]; defended_by: string[]; challenge: ExpertArtifact["weight_challenges"][0] }>()

  for (const d of deliberations) {
    for (const wc of d.weight_challenges) {
      const key = `${wc.party_id}::${wc.dimension}`
      if (!grouped.has(key)) {
        grouped.set(key, { flagged_by: [], defended_by: [], challenge: wc })
      }
      grouped.get(key)!.flagged_by.push(d.expert_id)
    }
  }

  // Check for defenses: an expert who did NOT challenge a dimension is considered neutral,
  // not a defender. A defender would need to explicitly argue the original score is correct.
  // Since we don't have explicit defense in the current format, we treat no-challenge as neutral.

  const decisions: WeightChallengeDecision[] = []
  for (const [, entry] of grouped) {
    const { flagged_by, challenge } = entry
    // Acceptance rule: ≥2 experts flag, OR 1 flags + no defense
    const accepted = flagged_by.length >= 2 || (flagged_by.length === 1 && entry.defended_by.length === 0)

    decisions.push({
      party_id: challenge.party_id,
      dimension: challenge.dimension,
      original_score: challenge.original_score,
      applied_score: accepted ? challenge.suggested_score : challenge.original_score,
      status: accepted ? "accepted" : "rejected",
      reason: accepted
        ? `${flagged_by.length} expert(s) flagged (${flagged_by.join(", ")}); none defended original`
        : `Only ${flagged_by.length} expert(s) flagged; ${entry.defended_by.length} defended original`,
      flagged_by,
      defended_by: entry.defended_by,
    })
  }

  return decisions
}

const VERDICT_SYSTEM = `You are the Verdict Synthesizer. You aggregate expert assessments into a final verdict.

You will receive:
1. All expert scenario assessments with probabilities
2. Cross-deliberation responses
3. Scenario definitions from the forum
4. Weight challenge decisions

Produce a final verdict as JSON:
{
  "scenarios_ranked": [
    {
      "scenario_id": "<id>",
      "title": "<scenario title>",
      "probability": <0.0-1.0>,
      "confidence": "high" | "medium" | "low",
      "key_drivers": ["<driver>", ...],
      "watch_indicators": ["<indicator>", ...],
      "near_future_trajectories": {
        "90_days": "<trajectory>",
        "6_months": "<trajectory>",
        "1_year": "<trajectory>"
      }
    }
  ],
  "final_assessment": "<comprehensive narrative assessment, 2-4 paragraphs>",
  "confidence_note": "<note on overall confidence level and key uncertainties>"
}

Rules:
- Rank scenarios by probability (highest first)
- Probabilities must sum to ≤ 1.0
- Each scenario needs ≥ 2 watch indicators
- Each scenario needs all 3 trajectory timeframes
- Final assessment should synthesize expert consensus and disagreements
- Confidence note should flag key uncertainties and evidence gaps`

export async function runVerdictSynthesizer(
  topicId: string,
  runId: string,
  experts: ExpertPersona[],
  sessionId: string,
  model: string,
  onProgress?: (msg: string) => void,
): Promise<ExpertCouncilOutput> {
  log.verdict("Reading expert artifacts")
  onProgress?.("Verdict: reading expert artifacts")

  const deliberations: ExpertArtifact[] = []
  for (const expert of experts) {
    try {
      const artifact = await readArtifact<ExpertArtifact>(topicId, runId, `expert_${expert.domain}`)
      deliberations.push(artifact)
    } catch {
      console.warn(`Missing artifact for expert ${expert.domain}`)
    }
  }

  if (!deliberations.length) throw new Error("No expert deliberations found")

  // Resolve weight challenges
  const weightDecisions = resolveWeightChallenges(deliberations)
  onProgress?.(`Verdict: ${weightDecisions.length} weight challenge(s) processed`)

  // Get scenario definitions
  const scenarioSummary = await getScenarioSummary(topicId, sessionId)

  // Aggregate probabilities per scenario
  const probMap = new Map<string, number[]>()
  for (const d of deliberations) {
    for (const sa of d.scenario_assessments) {
      if (!probMap.has(sa.scenario_id)) probMap.set(sa.scenario_id, [])
      probMap.get(sa.scenario_id)!.push(sa.probability_contribution)
    }
  }

  const avgProbs: Record<string, number> = {}
  for (const [id, probs] of probMap) {
    avgProbs[id] = probs.reduce((a, b) => a + b, 0) / probs.length
  }

  // Normalize if > 1.0
  const total = Object.values(avgProbs).reduce((a, b) => a + b, 0)
  if (total > 1.0) {
    for (const id of Object.keys(avgProbs)) {
      avgProbs[id] = Math.round((avgProbs[id] / total) * 100) / 100
    }
  }

  // Build prompt for verdict synthesis
  const expertSummary = deliberations.map(d => {
    const assessments = d.scenario_assessments.map(a =>
      `  ${a.scenario_id}: p=${a.probability_contribution}, analogues=[${a.historic_analogues.join(", ")}], weak_points=[${a.weak_points_identified.join("; ")}]`
    ).join("\n")
    const crossDelib = d.cross_deliberation_response
      ? `  Cross-deliberation: ${d.cross_deliberation_response.slice(0, 300)}...`
      : ""
    return `[${d.expert_name} (${d.domain})]\n${assessments}\n${crossDelib}`
  }).join("\n\n")

  const scenarioStr = scenarioSummary
    ? scenarioSummary.scenarios.map(s => `${s.id}: ${s.title} (conditions: ${s.required_conditions.join(", ")})`).join("\n")
    : "No scenario summary available"

  const prompt = `SCENARIOS:\n${scenarioStr}\n\nAGGREGATED PROBABILITIES:\n${JSON.stringify(avgProbs, null, 2)}\n\nEXPERT ASSESSMENTS:\n${expertSummary}\n\nWEIGHT CHALLENGE DECISIONS:\n${JSON.stringify(weightDecisions, null, 2)}\n\nSynthesize the final verdict.`

  onProgress?.("Verdict: synthesizing final assessment")

  let verdict: Omit<FinalVerdict, "synthesized_at" | "weight_challenge_decisions"> | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await chatCompletionText({
      model,
      messages: [
        { role: "system", content: VERDICT_SYSTEM },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 8000,
    })
    try {
      const match = raw.match(/\{[\s\S]+\}/)
      if (!match) throw new Error("No JSON found")
      verdict = JSON.parse(match[0])
      break
    } catch (e) {
      console.warn(`Verdict synthesis attempt ${attempt + 1} failed:`, e)
    }
  }

  if (!verdict) throw new Error("Verdict synthesis failed after 3 attempts")

  // Ensure probabilities are normalized
  const verdictTotal = verdict.scenarios_ranked.reduce((s, r) => s + r.probability, 0)
  if (verdictTotal > 1.05) {
    const scale = 1.0 / verdictTotal
    for (const r of verdict.scenarios_ranked) {
      r.probability = Math.round(r.probability * scale * 100) / 100
    }
  }

  // Sort by probability descending
  verdict.scenarios_ranked.sort((a, b) => b.probability - a.probability)

  const finalVerdict: FinalVerdict = {
    synthesized_at: new Date().toISOString(),
    scenarios_ranked: verdict.scenarios_ranked,
    final_assessment: verdict.final_assessment,
    confidence_note: verdict.confidence_note,
    weight_challenge_decisions: weightDecisions,
  }

  const councilOutput: ExpertCouncilOutput = {
    version: 1, // will be set by pipeline
    verdict_id: `verdict-v1`,
    experts,
    deliberations,
    final_verdict: finalVerdict,
  }

  // Write expert council file
  const councilPath = join(getDataDir(), "topics", topicId, `expert_council_v1.json`)
  await Bun.write(councilPath, JSON.stringify(councilOutput, null, 2))

  // Write verdict artifact for pipeline tracking
  await writeArtifact(topicId, runId, "verdict_synthesis", finalVerdict)

  const rankedStr = finalVerdict.scenarios_ranked.map(s => `${s.title || s.scenario_id}=${Math.round(s.probability * 100)}%`).join(", ")
  log.verdict(`Synthesis complete: ${rankedStr}`)
  log.verdict(`Weight challenges: ${weightDecisions.length} total, ${weightDecisions.filter(d => d.status === "accepted").length} accepted`)
  onProgress?.("Verdict: synthesis complete")
  return councilOutput
}
