import { chatCompletionText } from "../llm/proxyClient"
import { budgetOutput, fitContext } from "../llm/tokenBudget"
import { log } from "../utils/logger"
import { buildAgentContext, serializeContext } from "./contextBuilder"
import { getClue } from "../tools/internal/getClue"
import { getScenarioSummary } from "../tools/internal/getForumData"
import { writeArtifact, readArtifact, artifactExists } from "../tools/internal/artifactStore"
import { webSearch } from "../tools/external/webSearch"
import { join } from "path"

function getDataDir() { return process.env.DATA_DIR || "/home/nima/dana/data" }

export interface ExpertPersona {
  id: string
  name: string
  domain: string
  persona_prompt: string
  auto_generated: boolean
}

export interface ScenarioAssessment {
  scenario_id: string
  assessment: string
  historic_analogues: string[]
  weak_points_identified: string[]
  probability_contribution: number
}

export interface WeightChallenge {
  party_id: string
  dimension: string
  original_score: number
  suggested_score: number
  reasoning: string
  clues_cited: string[]
}

export interface ExpertArtifact {
  expert_id: string
  expert_name: string
  domain: string
  scenario_assessments: ScenarioAssessment[]
  weight_challenges: WeightChallenge[]
  cross_deliberation_response?: string
}

export interface ExpertCouncilOutput {
  version: number
  verdict_id: string
  experts: ExpertPersona[]
  deliberations: ExpertArtifact[]
  final_verdict?: FinalVerdict
}

export interface FinalVerdict {
  synthesized_at: string
  scenarios_ranked: RankedScenario[]
  final_assessment: string
  confidence_note: string
  weight_challenge_decisions: WeightChallengeDecision[]
}

export interface RankedScenario {
  scenario_id: string
  title: string
  probability: number
  confidence: "high" | "medium" | "low"
  key_drivers: string[]
  watch_indicators: string[]
  near_future_trajectories: {
    "90_days": string
    "6_months": string
    "1_year": string
  }
}

export interface WeightChallengeDecision {
  party_id: string
  dimension: string
  original_score: number
  applied_score: number
  status: "accepted" | "rejected"
  reason: string
  flagged_by: string[]
  defended_by: string[]
}

const EXPERT_DOMAINS = [
  { domain: "geopolitics", name: "Geopolitical Analyst" },
  { domain: "history", name: "Historian" },
  { domain: "psychology", name: "Psychologist / Behavioral Analyst" },
  { domain: "economics", name: "Economist / Resource Analyst" },
  { domain: "military", name: "Military / Security Expert" },
  { domain: "sociology", name: "Sociologist / Cultural Analyst" },
  { domain: "legal", name: "Legal / Constitutional Expert" },
  { domain: "media", name: "Media & Information Warfare Expert" },
]

function buildExpertPersona(domain: string, name: string, topicTitle: string): ExpertPersona {
  return {
    id: `exp-${domain}`,
    name,
    domain,
    persona_prompt: `You are a ${name} analyzing the topic: "${topicTitle}". Your role is to cross-examine forum scenarios, bring in historic analogues and domain-specific analysis, identify logical weak points, and assign probability estimates. You have NO party allegiance — your analysis must be impartial and grounded in evidence and domain expertise.`,
    auto_generated: true,
  }
}

export function generateExpertPersonas(topicTitle: string, count: number): ExpertPersona[] {
  const selected = EXPERT_DOMAINS.slice(0, Math.min(count, EXPERT_DOMAINS.length))
  return selected.map(d => buildExpertPersona(d.domain, d.name, topicTitle))
}

const EXPERT_SYSTEM = `You are a domain expert conducting independent scenario analysis.

You will receive:
1. A lean context snapshot (parties and clue titles)
2. A structured scenario summary from a completed forum debate (NOT raw arguments)
3. Full details of specific clues you choose to examine

Your task:
- Assess each scenario independently using your domain expertise
- Cite specific clues (by ID) for every factual claim
- Identify historic analogues relevant to each scenario
- Find weak points and unsupported assumptions
- Assign a probability contribution (0.0-1.0) to each scenario. All probabilities must sum to ≤ 1.0
- If any party's weight score seems miscalibrated based on clue evidence, issue a weight challenge

Output ONLY valid JSON:
{
  "scenario_assessments": [
    {
      "scenario_id": "<id>",
      "assessment": "<your detailed assessment>",
      "historic_analogues": ["<analogue 1>", ...],
      "weak_points_identified": ["<point>", ...],
      "probability_contribution": <0.0-1.0>
    }
  ],
  "weight_challenges": [
    {
      "party_id": "<id>",
      "dimension": "<weight dimension>",
      "original_score": <number>,
      "suggested_score": <number>,
      "reasoning": "<evidence-based reasoning>",
      "clues_cited": ["<clue_id>", ...]
    }
  ]
}

Rules:
- Probability contributions across all scenarios must sum to ≤ 1.0
- Each scenario must have ≥ 1 historic analogue
- Weight challenges are optional — only issue them when clue evidence clearly shows miscalibration
- Be precise and evidence-based — never speculate without citing clues`

export async function runExpertAgent(
  topicId: string,
  runId: string,
  expert: ExpertPersona,
  sessionId: string,
  model: string,
  onProgress?: (msg: string) => void,
): Promise<ExpertArtifact> {
  log.expert(`${expert.name} (${expert.domain}): starting analysis`)
  onProgress?.(`Expert ${expert.name}: starting analysis`)

  const ctx = await buildAgentContext("expert", topicId)
  const contextStr = serializeContext(ctx)

  const scenarioSummary = await getScenarioSummary(topicId, sessionId)
  if (!scenarioSummary) throw new Error("No scenario summary found — forum not complete")

  // Build the clue details for contested clues (experts should examine these)
  const clueDetails: string[] = []
  const clueIdsToFetch = new Set<string>()

  for (const sc of scenarioSummary.scenarios) {
    for (const cId of sc.key_clues) clueIdsToFetch.add(cId)
  }
  for (const cc of scenarioSummary.contested_clues) {
    clueIdsToFetch.add(cc.clue_id)
  }

  for (const cId of clueIdsToFetch) {
    try {
      const clue = await getClue(topicId, cId)
      clueDetails.push(`[${cId}] ${clue.title}: ${clue.bias_corrected_summary} (credibility: ${clue.source_credibility.score}, flags: ${clue.bias_flags.join(", ") || "none"})`)
    } catch { /* clue might not exist */ }
  }

  // Try to find historic analogues via web search
  let analogueContext = ""
  try {
    const scenarioTitles = scenarioSummary.scenarios.map(s => s.title).join(", ")
    const searchResults = await webSearch(`historic analogues ${scenarioTitles}`, 3)
    if (searchResults.length > 0) {
      analogueContext = `\n\nWEB SEARCH RESULTS (for historic analogues):\n${searchResults.map(r => `- ${r.title}: ${r.snippet}`).join("\n")}`
    }
  } catch { /* search failure is non-fatal */ }

  // Load party data for weight challenge context
  const partiesFile = Bun.file(join(getDataDir(), "topics", topicId, "parties.json"))
  const parties = await partiesFile.json() as { id: string; name: string; weight: number; weight_factors: Record<string, number> }[]
  const partyWeightStr = parties.map(p => `${p.name} (${p.id}): total=${p.weight}, factors=${JSON.stringify(p.weight_factors)}`).join("\n")

  const userPrompt = fitContext([
    { content: `EXPERT ROLE: ${expert.persona_prompt}`, priority: 10, label: "expert role" },
    { content: `SCENARIO SUMMARY:\n${JSON.stringify(scenarioSummary, null, 2)}`, priority: 9, label: "scenarios" },
    { content: `KEY CLUE DETAILS:\n${clueDetails.join("\n")}`, priority: 8, label: "clue details" },
    { content: `PARTY WEIGHTS:\n${partyWeightStr}`, priority: 6, label: "party weights" },
    { content: `CONTEXT:\n${contextStr}`, priority: 5, label: "clue context" },
    ...(analogueContext ? [{ content: analogueContext, priority: 4, label: "analogues" }] : []),
    { content: "\nProduce your expert assessment as JSON.", priority: 10, label: "instruction" },
  ], 80_000)

  const expertOutputBudget = budgetOutput(model, EXPERT_SYSTEM + userPrompt, { min: 4000, max: 12000 })

  let artifact: Omit<ExpertArtifact, "expert_id" | "expert_name" | "domain"> | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await chatCompletionText({
      model,
      messages: [
        { role: "system", content: EXPERT_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: expertOutputBudget,
    })
    try {
      const match = raw.match(/\{[\s\S]+\}/)
      if (!match) throw new Error("No JSON object found")
      artifact = JSON.parse(match[0])
      break
    } catch (e) {
      console.warn(`Expert ${expert.name} attempt ${attempt + 1} failed:`, e)
    }
  }

  if (!artifact) throw new Error(`Expert ${expert.name} failed to produce valid output after 3 attempts`)

  // Validate probabilities sum to ≤ 1.0
  const probSum = artifact.scenario_assessments.reduce((s, a) => s + a.probability_contribution, 0)
  if (probSum > 1.05) {
    // Normalize
    const scale = 1.0 / probSum
    for (const a of artifact.scenario_assessments) {
      a.probability_contribution = Math.round(a.probability_contribution * scale * 100) / 100
    }
  }

  const result: ExpertArtifact = {
    expert_id: expert.id,
    expert_name: expert.name,
    domain: expert.domain,
    scenario_assessments: artifact.scenario_assessments,
    weight_challenges: artifact.weight_challenges || [],
  }

  await writeArtifact(topicId, runId, `expert_${expert.domain}`, result)
  const probStr = result.scenario_assessments.map(a => `${a.scenario_id}=${Math.round(a.probability_contribution * 100)}%`).join(", ")
  log.expert(`${expert.name} done: ${probStr}`, `${result.weight_challenges.length} weight challenge(s), ${result.scenario_assessments.flatMap(a => a.historic_analogues).length} analogues`)
  onProgress?.(`Expert ${expert.name}: complete`)

  return result
}

export async function runCrossDeliberation(
  topicId: string,
  runId: string,
  expert: ExpertPersona,
  allExperts: ExpertPersona[],
  model: string,
  onProgress?: (msg: string) => void,
): Promise<string> {
  onProgress?.(`Cross-deliberation: ${expert.name} reading other experts`)

  // Read all other expert artifacts
  const otherAssessments: string[] = []
  for (const other of allExperts) {
    if (other.id === expert.id) continue
    try {
      const artifact = await readArtifact<ExpertArtifact>(topicId, runId, `expert_${other.domain}`)
      const summary = artifact.scenario_assessments
        .map(a => `${a.scenario_id}: prob=${a.probability_contribution}, assessment=${a.assessment.slice(0, 200)}`)
        .join("\n")
      otherAssessments.push(`[${other.name}]:\n${summary}`)
    } catch { /* artifact might not exist */ }
  }

  if (!otherAssessments.length) return "No other expert assessments available for cross-deliberation."

  // Read own artifact
  const ownArtifact = await readArtifact<ExpertArtifact>(topicId, runId, `expert_${expert.domain}`)

  const prompt = `You are ${expert.name}. You previously assessed the scenarios and assigned probabilities.

YOUR ASSESSMENT:
${JSON.stringify(ownArtifact.scenario_assessments, null, 2)}

OTHER EXPERTS' ASSESSMENTS:
${otherAssessments.join("\n\n")}

Write a brief cross-deliberation response (2-4 paragraphs):
- What do you agree with from other experts?
- What do you disagree with and why?
- Do their assessments change your probability estimates?
- Any important points they missed?

Be concise and specific. Reference other experts by name.`

  const response = await chatCompletionText({
    model,
    messages: [
      { role: "system", content: expert.persona_prompt },
      { role: "user", content: prompt },
    ],
    temperature: 0.4,
    max_tokens: 1000,
  })

  // Update the artifact with cross-deliberation
  ownArtifact.cross_deliberation_response = response
  await writeArtifact(topicId, runId, `expert_${expert.domain}`, ownArtifact)

  onProgress?.(`Cross-deliberation: ${expert.name} complete`)
  return response
}
