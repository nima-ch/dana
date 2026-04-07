import { resolvePrompt } from "../llm/promptLoader"
import { runAgenticLoop } from "../llm/agenticLoop"
import { chatCompletionText } from "../llm/chatCompletion"
import { budgetOutput } from "../llm/tokenBudget"
import { log } from "../utils/logger"

export interface ClueGroup {
  group_id: string
  category: string
  merged_title: string
  merged_summary: string
  merged_credibility: number
  merged_bias_flags: string[]
  merged_relevance: number
  merged_date: string
  merged_clue_type: string
  merged_domain_tags: string[]
  merged_parties: string[]
  source_clue_ids: string[]
  action: "merge" | "keep" | "delete"
  reason: string
}

export async function runCleanupPropose(
  topicId: string,
  topicTitle: string,
  clues: {
    id: string
    title: string
    summary: string
    date: string
    credibility: number
    relevance: number
    parties: string[]
    clue_type: string
    bias_flags: string[]
    domain_tags: string[]
  }[],
  parties: { id: string; name: string }[],
  model: string,
): Promise<ClueGroup[]> {
  const partyList = parties.map(p => `${p.id}: ${p.name}`).join("\n")

  log.enrichment(`CleanupAgent: reviewing ${clues.length} clues for duplicates/redundancy`)

  const fullList = clues.map(c =>
    `[${c.id}] "${c.title}" (${c.date}, cred=${c.credibility}, rel=${c.relevance}, type=${c.clue_type}, parties=[${c.parties.join(",")}]) — ${c.summary.slice(0, 150)}`
  ).join("\n")

  const inputSize = fullList.length + partyList.length + 2000
  const maxInput = 60000
  const clueInput = inputSize > maxInput
    ? clues.map(c =>
        `[${c.id}] "${c.title}" (${c.date}, cred=${c.credibility}, type=${c.clue_type}) — ${c.summary.slice(0, 60)}`
      ).join("\n")
    : fullList

  const config = await resolvePrompt("clue-extractor/cleanup", { party_list: partyList })
  const effectiveModel = config.model ?? model

  const userContent = `TOPIC: ${topicTitle}

CLUES TO REVIEW (${clues.length} total):
${clueInput}

Review every clue. Every clue ID must appear in exactly one group in your output.`

  let raw: string
  if (config.tools.length > 0) {
    raw = await runAgenticLoop({
      model: effectiveModel,
      topicId,
      stage: "enrichment",
      tools: config.tools,
      temperature: 0.1,
      max_tokens: budgetOutput(effectiveModel, clueInput + partyList, { min: 8000, max: 16000 }),
      messages: [
        { role: "system", content: config.content },
        { role: "user", content: userContent },
      ],
    })
  } else {
    raw = await chatCompletionText({
      model: effectiveModel,
      messages: [
        { role: "system", content: config.content },
        { role: "user", content: userContent },
      ],
      temperature: 0.1,
      max_tokens: budgetOutput(effectiveModel, clueInput + partyList, { min: 8000, max: 16000 }),
    })
  }

  try {
    const match = raw.match(/\[[\s\S]+/)
    if (!match) throw new Error("No JSON array in response")
    let jsonStr = match[0]
    let groups: ClueGroup[]
    try {
      groups = JSON.parse(jsonStr)
    } catch {
      // Salvage truncated JSON
      const lastComplete = jsonStr.lastIndexOf("},")
      const lastObj = jsonStr.lastIndexOf("}")
      const cutPoint = lastComplete > 0 ? lastComplete + 1 : lastObj > 0 ? lastObj + 1 : -1
      if (cutPoint > 0) {
        groups = JSON.parse(jsonStr.slice(0, cutPoint) + "]")
        log.enrichment(`CleanupAgent: salvaged ${groups.length} groups from truncated JSON`)
      } else {
        throw new Error("No salvageable groups in response")
      }
    }
    const mergeCount = groups.filter(g => g.action === "merge").length
    const deleteCount = groups.filter(g => g.action === "delete").length
    const keepCount = groups.filter(g => g.action === "keep").length
    log.enrichment(`CleanupAgent: ${groups.length} groups — ${mergeCount} merge, ${keepCount} keep, ${deleteCount} delete`)
    return groups
  } catch (e) {
    log.error("CLEANUP", "Failed to parse cleanup groups", e)
    throw new Error("CleanupAgent: failed to parse response")
  }
}
