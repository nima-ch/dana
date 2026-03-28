import { chatCompletionText } from "../llm/proxyClient"
import { budgetOutput } from "../llm/tokenBudget"
import { loadPrompt } from "../llm/promptLoader"
import { emitThink } from "../routes/stream"
import { log } from "../utils/logger"
import { dbGetParties } from "../db/queries/parties"
import { dbGetClues } from "../db/queries/clues"
import { dbGetRepresentatives } from "../db/queries/forum"
import { dbWriteScratchpad } from "../db/queries/forum"
import type { ScratchpadContent } from "../db/queries/forum"

export interface PrepResult {
  prepared: string[]  // representative_ids that got a scratchpad
}

export async function runForumPrepAgent(
  topicId: string,
  title: string,
  sessionId: string,
  model: string,
  onProgress?: (msg: string) => void
): Promise<PrepResult> {
  const representatives = dbGetRepresentatives(topicId)
  const parties = dbGetParties(topicId)
  const allClues = dbGetClues(topicId)

  if (!representatives.length) throw new Error("No representatives found — run WeightCalculator first")

  log.forum(`ForumPrepAgent: preparing ${representatives.length} representatives`)
  emitThink(topicId, "📋", "Forum preparation", `${representatives.length} representatives reading evidence…`)

  // Build clue list string once (shared across all agents)
  const clueList = allClues.map(clue => {
    const cur = clue.versions.find(v => v.v === clue.current)!
    const status = clue.status === "disputed" ? " [DISPUTED]" : ""
    return `[${clue.id}]${status} (${cur.clue_type}, ${cur.timeline_date}) ${cur.title}: ${cur.bias_corrected_summary.slice(0, 200)}`
  }).join("\n")

  const prepared: string[] = []

  // All reps prepare in parallel — scratchpads are fully independent
  await Promise.all(representatives.map(async (rep) => {
    const party = parties.find(p => p.id === rep.party_id)
    if (!party) return

    const otherParties = parties
      .filter(p => p.id !== party.id)
      .map(p => `- ${p.name} (${p.type}): agenda="${p.agenda.slice(0, 100)}" stance=${p.stance}`)
      .join("\n")

    onProgress?.(`Forum prep: ${party.name} reading evidence…`)
    emitThink(topicId, "🧠", `Prep · ${party.name}`, "Reading all clues, building strategy…")
    log.forum(`  Preparing ${party.name} (${allClues.length} clues to analyze)`)

    const SCRATCHPAD_PROMPT = loadPrompt("forum/scratchpad", {
      party_name: party.name,
      party_type: party.type,
      agenda: party.agenda,
      means: party.means.slice(0, 5).join(", "),
      stance: party.stance,
      vulnerabilities: party.vulnerabilities.slice(0, 3).join(", "),
      other_parties: otherParties,
      clue_list: clueList,
    })

    const budget = budgetOutput(model, SCRATCHPAD_PROMPT, { min: 2000, max: 8000 })

    try {
      const raw = await chatCompletionText({
        model,
        messages: [
          { role: "system", content: SCRATCHPAD_PROMPT },
          { role: "user", content: `Prepare your private strategic notes for the upcoming forum on: "${title}"` },
        ],
        temperature: 0.4,
        max_tokens: budget,
      })

      const match = raw.match(/\{[\s\S]+\}/)
      if (!match) throw new Error("No JSON object in scratchpad response")

      const content = JSON.parse(match[0]) as ScratchpadContent

      dbWriteScratchpad(topicId, {
        representative_id: rep.id,
        session_id: sessionId,
        topic_id: topicId,
        party_id: party.id,
        content,
        created_at: new Date().toISOString(),
      })

      prepared.push(rep.id)
      emitThink(topicId, "✅", `Ready · ${party.name}`, `Analyzed ${content.clue_analysis?.length ?? 0} clues · pushing: "${content.scenario_we_are_pushing?.slice(0, 60)}"`)
      log.forum(`  ${party.name} ready: analyzed ${content.clue_analysis?.length ?? 0} clues, pushing "${content.scenario_we_are_pushing?.slice(0, 60)}"`)
    } catch (e) {
      log.forum(`  Prep failed for ${party.name}: ${e}`)
      // Write minimal fallback scratchpad so the agent can still participate
      dbWriteScratchpad(topicId, {
        representative_id: rep.id,
        session_id: sessionId,
        topic_id: topicId,
        party_id: party.id,
        content: {
          clue_analysis: [],
          our_core_position: party.agenda,
          scenario_we_are_pushing: "outcome favorable to " + party.name,
          strongest_opposing_party: "",
          our_key_vulnerabilities: party.vulnerabilities.slice(0, 2),
          opening_move: "We will defend our position based on the available evidence.",
        },
        created_at: new Date().toISOString(),
      })
      prepared.push(rep.id)
    }
  }))

  log.forum(`ForumPrepAgent complete: ${prepared.length}/${representatives.length} prepared`)
  return { prepared }
}
