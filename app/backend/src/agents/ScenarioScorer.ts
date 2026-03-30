import { chatCompletionText } from "../llm/proxyClient"
import { budgetOutput, fitContext } from "../llm/tokenBudget"
import { loadPrompt } from "../llm/promptLoader"
import { log } from "../utils/logger"
import { emit, emitThink } from "../routes/stream"
import { dbGetParties } from "../db/queries/parties"
import { dbGetClues } from "../db/queries/clues"
import { dbGetAllScratchpads } from "../db/queries/forum"
import { getForumSession } from "../tools/internal/getForumData"
import { dbSaveExpertCouncil } from "../db/queries/expert"
import { dbGetTopic } from "../db/queries/topics"
import { writeArtifact } from "../tools/internal/artifactStore"
import type { ForumScenario, ForumTurn, ScratchpadContent } from "../db/queries/forum"
import type { Party } from "../db/queries/parties"
import type { ExpertCouncilOutput, FinalVerdict, RankedScenario } from "./ExpertAgent"

const SCORER_PROMPT = loadPrompt("scoring/score-scenarios")

// ─── Evidence map types ───────────────────────────────────────────────────────

interface ClueEvidence {
  clue_id: string
  title: string
  clue_type: string
  credibility: number
  bias_flags: string[]
  effective_weight: number       // credibility - 0.1 per bias flag, min 0.1
  summary: string
  cited_in_turns: number         // how many debate turns cited this clue
}

interface ScenarioEvidence {
  scenario_id: string
  title: string
  description: string
  supporting_clues: ClueEvidence[]
  contesting_clues: ClueEvidence[]
  forum_for: { party_id: string; party_name: string; weight: number; turn_count: number }[]
  forum_against: { party_id: string; party_name: string; weight: number; turn_count: number }[]
  scratchpad_pushers: { party_id: string; party_name: string; weight: number; scenario_push: string }[]
  scratchpad_resisters: { party_id: string; party_name: string; weight: number; vulnerability: string }[]
  net_power_projection: number   // positive = favored by high-weight parties
  evidence_density: number       // 0–1, how much evidence backs this vs. others
}

// ─── Pass 1: Build evidence map (no LLM) ─────────────────────────────────────

function computeEffectiveWeight(credibility: number, biasFlags: string[]): number {
  return Math.max(0.1, credibility - biasFlags.length * 0.1)
}

function buildEvidenceMap(
  scenarios: ForumScenario[],
  allTurns: ForumTurn[],
  scratchpads: { party_id: string; content: ScratchpadContent }[],
  parties: Party[],
  clueMap: Map<string, { title: string; clue_type: string; credibility: number; bias_flags: string[]; summary: string }>,
): ScenarioEvidence[] {
  const partyMap = new Map(parties.map(p => [p.id, p]))

  // Build turn citation index: clue_id → [party_id list]
  const clueCitedBy = new Map<string, string[]>()
  for (const turn of allTurns) {
    for (const cId of turn.clues_cited) {
      if (!clueCitedBy.has(cId)) clueCitedBy.set(cId, [])
      clueCitedBy.get(cId)!.push(turn.party_id ?? turn.representative_id.replace("rep-", ""))
    }
  }

  // Build per-party turn count index
  const partyTurnCount = new Map<string, number>()
  for (const turn of allTurns) {
    const pid = turn.party_id ?? turn.representative_id.replace("rep-", "")
    partyTurnCount.set(pid, (partyTurnCount.get(pid) ?? 0) + 1)
  }

  return scenarios.map(sc => {
    const scClueIds = new Set(sc.clues_cited)

    // Collect all clue IDs cited in turns by parties who supported/contested this scenario
    const supportingPartyIds = new Set(sc.supported_by)
    const contestingPartyIds = new Set(sc.contested_by)

    // Augment scenario clues with clues from supporting parties' turns
    for (const turn of allTurns) {
      const pid = turn.party_id ?? turn.representative_id.replace("rep-", "")
      if (supportingPartyIds.has(pid)) {
        for (const cId of turn.clues_cited) scClueIds.add(cId)
      }
    }

    // Build supporting clue evidence
    const supportingClues: ClueEvidence[] = []
    for (const cId of scClueIds) {
      const clue = clueMap.get(cId)
      if (!clue) continue
      supportingClues.push({
        clue_id: cId,
        title: clue.title,
        clue_type: clue.clue_type,
        credibility: clue.credibility,
        bias_flags: clue.bias_flags,
        effective_weight: computeEffectiveWeight(clue.credibility, clue.bias_flags),
        summary: clue.summary,
        cited_in_turns: (clueCitedBy.get(cId) ?? []).length,
      })
    }

    // Build contesting clue evidence (clues cited by contesting parties but not in sc.clues_cited)
    const contestingClues: ClueEvidence[] = []
    for (const turn of allTurns) {
      const pid = turn.party_id ?? turn.representative_id.replace("rep-", "")
      if (!contestingPartyIds.has(pid)) continue
      for (const cId of turn.clues_cited) {
        if (scClueIds.has(cId)) continue // already counted as supporting
        const clue = clueMap.get(cId)
        if (!clue) continue
        if (contestingClues.some(c => c.clue_id === cId)) continue // dedup
        contestingClues.push({
          clue_id: cId,
          title: clue.title,
          clue_type: clue.clue_type,
          credibility: clue.credibility,
          bias_flags: clue.bias_flags,
          effective_weight: computeEffectiveWeight(clue.credibility, clue.bias_flags),
          summary: clue.summary,
          cited_in_turns: (clueCitedBy.get(cId) ?? []).length,
        })
      }
    }

    // Forum participation: who argued for/against
    const forumFor = sc.supported_by.map(pid => {
      const party = partyMap.get(pid)
      return { party_id: pid, party_name: party?.name ?? pid, weight: party?.weight ?? 0, turn_count: partyTurnCount.get(pid) ?? 0 }
    })
    const forumAgainst = sc.contested_by.map(pid => {
      const party = partyMap.get(pid)
      return { party_id: pid, party_name: party?.name ?? pid, weight: party?.weight ?? 0, turn_count: partyTurnCount.get(pid) ?? 0 }
    })

    // Scratchpad intelligence
    const scratchpadPushers: ScenarioEvidence["scratchpad_pushers"] = []
    const scratchpadResisters: ScenarioEvidence["scratchpad_resisters"] = []

    for (const pad of scratchpads) {
      const party = partyMap.get(pad.party_id)
      if (!party) continue
      const push = pad.content.scenario_we_are_pushing ?? ""
      const vulns = pad.content.our_key_vulnerabilities ?? []
      const scTitle = sc.title.toLowerCase()

      // Check if this party's scratchpad scenario aligns with this scenario
      const pushLower = push.toLowerCase()
      if (pushLower.length > 0 && (
        scTitle.split(" ").filter(w => w.length > 4).some(w => pushLower.includes(w)) ||
        sc.benefiting_parties.includes(pad.party_id)
      )) {
        scratchpadPushers.push({ party_id: pad.party_id, party_name: party.name, weight: party.weight, scenario_push: push.slice(0, 150) })
      }

      // Check if this party listed a vulnerability related to this scenario
      for (const vuln of vulns) {
        if (scTitle.split(" ").filter(w => w.length > 4).some(w => vuln.toLowerCase().includes(w))) {
          scratchpadResisters.push({ party_id: pad.party_id, party_name: party.name, weight: party.weight, vulnerability: vuln.slice(0, 100) })
          break
        }
      }
    }

    // Net power projection: backing weight - blocking weight
    const backingWeight = [
      ...forumFor.map(p => p.weight),
      ...scratchpadPushers.map(p => p.weight),
    ].reduce((s, w) => s + w, 0)

    const blockingWeight = [
      ...forumAgainst.map(p => p.weight),
      ...scratchpadResisters.map(p => p.weight),
    ].reduce((s, w) => s + w, 0)

    const netPowerProjection = backingWeight - blockingWeight

    // Evidence density: sum of effective weights of supporting clues
    const evidenceDensity = supportingClues.reduce((s, c) => s + c.effective_weight, 0)

    return {
      scenario_id: sc.id,
      title: sc.title,
      description: sc.description,
      supporting_clues: supportingClues,
      contesting_clues: contestingClues,
      forum_for: forumFor,
      forum_against: forumAgainst,
      scratchpad_pushers: scratchpadPushers,
      scratchpad_resisters: scratchpadResisters,
      net_power_projection: netPowerProjection,
      evidence_density: evidenceDensity,
    }
  })
}

// ─── Pass 2: LLM probability scoring ─────────────────────────────────────────

function serializeEvidenceMap(evidenceMap: ScenarioEvidence[], parties: Party[]): string {
  const partyMap = new Map(parties.map(p => [p.id, p]))

  const sections: string[] = []

  for (const sc of evidenceMap) {
    const lines = [
      `=== SCENARIO: ${sc.scenario_id} — "${sc.title}" ===`,
      `Description: ${sc.description}`,
      `Net power projection: ${sc.net_power_projection > 0 ? "+" : ""}${Math.round(sc.net_power_projection)} (positive = backed by high-weight parties)`,
      `Evidence density score: ${sc.evidence_density.toFixed(2)}`,
    ]

    if (sc.supporting_clues.length > 0) {
      lines.push(`\nSUPPORTING CLUES (${sc.supporting_clues.length}):`)
      for (const c of sc.supporting_clues) {
        lines.push(`  [${c.clue_id}] ${c.title} | type=${c.clue_type} | credibility=${c.credibility.toFixed(2)} | bias_flags=[${c.bias_flags.join(", ")}] | effective_weight=${c.effective_weight.toFixed(2)} | cited_in_${c.cited_in_turns}_turns`)
        lines.push(`    Summary: ${c.summary.slice(0, 120)}`)
      }
    }

    if (sc.contesting_clues.length > 0) {
      lines.push(`\nCONTESTING CLUES (${sc.contesting_clues.length}):`)
      for (const c of sc.contesting_clues) {
        lines.push(`  [${c.clue_id}] ${c.title} | effective_weight=${c.effective_weight.toFixed(2)}`)
        lines.push(`    Summary: ${c.summary.slice(0, 100)}`)
      }
    }

    if (sc.forum_for.length > 0) {
      lines.push(`\nFORUM BACKING:`)
      for (const p of sc.forum_for) {
        const party = partyMap.get(p.party_id)
        const allies = party?.circle?.visible?.slice(0, 3).join(", ") ?? "none"
        lines.push(`  ${p.party_name} (weight=${p.weight}, turns=${p.turn_count}, allies=[${allies}])`)
      }
    }

    if (sc.forum_against.length > 0) {
      lines.push(`\nFORUM OPPOSITION:`)
      for (const p of sc.forum_against) {
        lines.push(`  ${p.party_name} (weight=${p.weight}, turns=${p.turn_count})`)
      }
    }

    if (sc.scratchpad_pushers.length > 0) {
      lines.push(`\nSCRATCHPAD INTEL — PRIVATELY PUSHING THIS SCENARIO:`)
      for (const p of sc.scratchpad_pushers) {
        lines.push(`  ${p.party_name} (weight=${p.weight}): "${p.scenario_push}"`)
      }
    }

    if (sc.scratchpad_resisters.length > 0) {
      lines.push(`\nSCRATCHPAD INTEL — PRIVATELY VULNERABLE TO THIS SCENARIO:`)
      for (const p of sc.scratchpad_resisters) {
        lines.push(`  ${p.party_name} (weight=${p.weight}): "${p.vulnerability}"`)
      }
    }

    sections.push(lines.join("\n"))
  }

  const partySection = [
    "\n=== PARTY REGISTRY ===",
    ...parties.map(p => {
      const allies = [...(p.circle?.visible ?? []), ...(p.circle?.shadow ?? [])].slice(0, 4).join(", ")
      return `${p.name} (id=${p.id}, weight=${p.weight}, stance=${p.stance}, allies/shadow=[${allies}])`
    }),
  ].join("\n")

  return sections.join("\n\n") + "\n\n" + partySection
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runScenarioScorer(
  topicId: string,
  runId: string,
  sessionId: string,
  model: string,
  onProgress?: (msg: string) => void,
): Promise<ExpertCouncilOutput> {
  log.separator()
  log.expert("Stage 5/5: SCENARIO SCORER starting")

  emitThink(topicId, "🔬", "Scenario Scorer", "Building evidence map from all sources")
  emit(topicId, { type: "progress", stage: "expert_council", pct: 0.1, msg: "Building evidence map..." })

  // Load all data
  const [session, parties, rawClues, scratchpads] = await Promise.all([
    getForumSession(topicId, sessionId),
    Promise.resolve(dbGetParties(topicId)),
    Promise.resolve(dbGetClues(topicId)),
    Promise.resolve(dbGetAllScratchpads(topicId, sessionId)),
  ])

  const allTurns = session.rounds.flatMap(r => r.turns)
  const scenarios = session.scenarios

  if (scenarios.length === 0) throw new Error("No scenarios found in forum session — cannot score")

  // Build clue lookup map
  const clueMap = new Map<string, { title: string; clue_type: string; credibility: number; bias_flags: string[]; summary: string }>()
  for (const clue of rawClues) {
    const v = clue.versions[clue.current - 1] ?? clue.versions[clue.versions.length - 1]
    if (!v) continue
    clueMap.set(clue.id, {
      title: v.title,
      clue_type: v.clue_type,
      credibility: v.source_credibility.score,
      bias_flags: v.source_credibility.bias_flags,
      summary: v.bias_corrected_summary,
    })
  }

  onProgress?.("Scorer: evidence map built")
  log.expert(`Scorer: ${scenarios.length} scenarios, ${allTurns.length} turns, ${scratchpads.length} scratchpads, ${rawClues.length} clues`)

  // Pass 1: Build structured evidence map (no LLM)
  const evidenceMap = buildEvidenceMap(scenarios, allTurns, scratchpads, parties, clueMap)

  log.expert(`Scorer: evidence map ready — power projections: ${evidenceMap.map(e => `${e.scenario_id}=${Math.round(e.net_power_projection)}`).join(", ")}`)
  emitThink(topicId, "📊", "Evidence map complete", `${scenarios.length} scenarios mapped`)

  // Pass 2: LLM probability scoring
  emit(topicId, { type: "progress", stage: "expert_council", pct: 0.4, msg: "Scoring scenario probabilities..." })
  onProgress?.("Scorer: running probability scoring")

  const evidenceStr = serializeEvidenceMap(evidenceMap, parties)

  const userPrompt = fitContext([
    { content: `TOPIC: ${topicId}`, priority: 5, label: "topic" },
    { content: `EVIDENCE PACKAGE:\n${evidenceStr}`, priority: 10, label: "evidence" },
    { content: `\nScore all ${scenarios.length} scenarios. Probabilities must sum to exactly 1.0.`, priority: 10, label: "instruction" },
  ], 80_000)

  const budget = budgetOutput(model, SCORER_PROMPT + userPrompt, { min: 4000, max: 12000 })

  let verdict: { scenarios_ranked: RankedScenario[]; final_assessment: string; confidence_note: string } | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await chatCompletionText({
      model,
      messages: [
        { role: "system", content: SCORER_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: budget,
    })

    try {
      const match = raw.match(/\{[\s\S]+\}/)
      if (!match) throw new Error("No JSON object found")
      const parsed = JSON.parse(match[0])
      if (!Array.isArray(parsed.scenarios_ranked)) throw new Error("Missing scenarios_ranked array")
      verdict = parsed
      break
    } catch (e) {
      log.error("SCORER", `Attempt ${attempt + 1} failed`, e)
    }
  }

  if (!verdict) throw new Error("Scenario scorer failed after 3 attempts")

  // Normalize probabilities to exactly 1.0
  const rawTotal = verdict.scenarios_ranked.reduce((s, r) => s + r.probability, 0)
  if (Math.abs(rawTotal - 1.0) > 0.01) {
    const scale = 1.0 / rawTotal
    for (const r of verdict.scenarios_ranked) {
      r.probability = Math.round(r.probability * scale * 1000) / 1000
    }
    // Adjust last entry for floating point remainder
    const adjustedTotal = verdict.scenarios_ranked.reduce((s, r) => s + r.probability, 0)
    verdict.scenarios_ranked[verdict.scenarios_ranked.length - 1].probability =
      Math.round((verdict.scenarios_ranked[verdict.scenarios_ranked.length - 1].probability + (1.0 - adjustedTotal)) * 1000) / 1000
  }

  // Sort descending
  verdict.scenarios_ranked.sort((a, b) => b.probability - a.probability)

  const finalVerdict: FinalVerdict = {
    synthesized_at: new Date().toISOString(),
    scenarios_ranked: verdict.scenarios_ranked,
    final_assessment: verdict.final_assessment,
    confidence_note: verdict.confidence_note,
    weight_challenge_decisions: [],
  }

  // Determine version
  let version = 1
  try {
    const topic = dbGetTopic(topicId)
    if (topic) version = Math.max(version, (topic.current_version || 0) + 1)
  } catch { /* use default */ }
  const vMatch = runId.match(/v(\d+)/)
  if (vMatch) version = parseInt(vMatch[1])

  const councilOutput: ExpertCouncilOutput = {
    version,
    verdict_id: `verdict-v${version}`,
    experts: [],         // no expert personas — single scorer
    deliberations: [],   // no per-expert artifacts
    final_verdict: finalVerdict,
  }

  // Persist
  dbSaveExpertCouncil(topicId, councilOutput)
  await writeArtifact(topicId, runId, "verdict_synthesis", finalVerdict)

  const rankedStr = finalVerdict.scenarios_ranked
    .map(s => `${(s.title ?? s.scenario_id).slice(0, 30)}=${Math.round(s.probability * 100)}%`)
    .join(", ")

  log.expert(`Scorer complete: ${rankedStr}`)
  emitThink(topicId, "✅", "Scenario scoring complete", rankedStr)

  emit(topicId, {
    type: "verdict_content",
    headline: finalVerdict.final_assessment.slice(0, 200),
    scenarios: finalVerdict.scenarios_ranked.map(s => ({ title: s.title ?? s.scenario_id, probability: s.probability })),
    final_assessment: finalVerdict.final_assessment,
    confidence_note: finalVerdict.confidence_note,
  })

  emit(topicId, { type: "stage_complete", stage: "expert_council" })
  onProgress?.("Scorer: complete")

  return councilOutput
}
