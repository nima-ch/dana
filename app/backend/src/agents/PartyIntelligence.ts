import { chatCompletionText } from "../llm/proxyClient"
import { budgetOutput } from "../llm/tokenBudget"
import { webSearch } from "../tools/external/webSearch"
import { httpFetch } from "../tools/external/httpFetch"
import { log } from "../utils/logger"
import type { Party } from "./DiscoveryAgent"

const PARTY_JSON_SCHEMA = `{
  "id": "<slug>",
  "name": "<full name>",
  "type": "<state|state_military|non_state|individual|media|economic|alliance>",
  "description": "<detailed 2-4 sentence description with specific facts, dates, events>",
  "weight": <0-100>,
  "weight_factors": {
    "military_capacity": <0-100>,
    "economic_control": <0-100>,
    "information_control": <0-100>,
    "international_support": <0-100>,
    "internal_legitimacy": <0-100>
  },
  "agenda": "<their goal regarding this topic>",
  "means": ["<specific lever of power or action>"],
  "circle": {
    "visible": ["<known ally or partner with brief context>"],
    "shadow": ["<inferred or covert actor with brief context>"]
  },
  "stance": "<active|passive|covert|overt|defensive_active>",
  "vulnerabilities": ["<specific weak point>"],
  "auto_discovered": false,
  "user_verified": true
}`

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30)
}

async function gatherResearch(queries: string[], topicId: string): Promise<string> {
  const snippets: string[] = []
  for (const query of queries.slice(0, 3)) {
    try {
      const results = await webSearch(query, 3)
      for (const r of results.slice(0, 2)) {
        try {
          const fetched = await httpFetch(r.url, topicId)
          snippets.push(`[${r.title}]\n${fetched.raw_content.slice(0, 2000)}`)
        } catch {
          if (r.snippet) snippets.push(`[${r.title}] ${r.snippet}`)
        }
      }
    } catch { /* skip */ }
  }
  return snippets.join("\n\n---\n\n").slice(0, 12000)
}

export async function smartAddParty(
  topicId: string,
  topicTitle: string,
  topicDescription: string,
  partyName: string,
  model: string,
  existingParties: Party[],
): Promise<Party> {
  log.discovery(`Smart add: researching "${partyName}" for topic "${topicTitle}"`)

  const research = await gatherResearch([
    `"${partyName}" role in ${topicTitle}`,
    `${partyName} political influence capabilities ${new Date().getFullYear()}`,
    `${partyName} alliances vulnerabilities geopolitical`,
  ], topicId)

  const existingNames = existingParties.map(p => p.name).join(", ")

  const raw = await chatCompletionText({
    model,
    messages: [
      {
        role: "system",
        content: `You are a geopolitical intelligence analyst. Given a party name, a topic, and research material, produce a complete party profile as JSON.

Output ONLY a single valid JSON object matching this schema:
${PARTY_JSON_SCHEMA}

Be specific and fact-based. Use the research material to ground your analysis. Weight factors should reflect the party's real capabilities relative to the topic.`,
      },
      {
        role: "user",
        content: `TOPIC: ${topicTitle}
DESCRIPTION: ${topicDescription}
PARTY TO PROFILE: ${partyName}
EXISTING PARTIES: ${existingNames}

RESEARCH MATERIAL:
${research}

Generate a complete party profile for "${partyName}". Output ONLY valid JSON, no markdown fences.`,
      },
    ],
    temperature: 0.3,
    max_tokens: budgetOutput(model, research + topicTitle, { min: 2000, max: 5000 }),
  })

  const match = raw.match(/\{[\s\S]+\}/)
  if (!match) throw new Error("Failed to parse party JSON from LLM response")
  const party = JSON.parse(match[0]) as Party
  party.id = party.id || slugify(partyName)
  party.auto_discovered = false
  party.user_verified = true

  log.discovery(`Smart add complete: ${party.name} (w=${party.weight})`)
  return party
}

export async function smartEditParty(
  topicId: string,
  topicTitle: string,
  currentParty: Party,
  feedback: string,
  model: string,
): Promise<Party> {
  log.discovery(`Smart edit: researching feedback for "${currentParty.name}"`)

  const research = await gatherResearch([
    `${currentParty.name} ${feedback.slice(0, 80)}`,
    `${currentParty.name} ${topicTitle} latest developments ${new Date().getFullYear()}`,
  ], topicId)

  const raw = await chatCompletionText({
    model,
    messages: [
      {
        role: "system",
        content: `You are a geopolitical intelligence analyst. Given a party's current profile, user feedback, and research material, update the profile to address the feedback.

Output ONLY a single valid JSON object matching this schema:
${PARTY_JSON_SCHEMA}

Preserve accurate existing information. Only change fields that the feedback and research warrant updating. Be specific and fact-based.`,
      },
      {
        role: "user",
        content: `TOPIC: ${topicTitle}

CURRENT PARTY PROFILE:
${JSON.stringify(currentParty, null, 2)}

USER FEEDBACK:
${feedback}

RESEARCH MATERIAL:
${research}

Update the party profile based on the feedback. Output ONLY valid JSON, no markdown fences.`,
      },
    ],
    temperature: 0.3,
    max_tokens: budgetOutput(model, JSON.stringify(currentParty) + research + feedback, { min: 2000, max: 5000 }),
  })

  const match = raw.match(/\{[\s\S]+\}/)
  if (!match) throw new Error("Failed to parse party JSON from LLM response")
  const updated = JSON.parse(match[0]) as Party
  updated.id = currentParty.id
  updated.auto_discovered = false
  updated.user_verified = true

  log.discovery(`Smart edit complete: ${updated.name}`)
  return updated
}

export async function smartSplitParty(
  topicId: string,
  topicTitle: string,
  sourceParty: Party,
  splitNames: string[],
  model: string,
): Promise<Party[]> {
  log.discovery(`Smart split: splitting "${sourceParty.name}" into ${splitNames.join(", ")}`)

  const research = await gatherResearch(
    splitNames.map(n => `"${n}" role capabilities ${topicTitle}`),
    topicId
  )

  const raw = await chatCompletionText({
    model,
    messages: [
      {
        role: "system",
        content: `You are a geopolitical intelligence analyst. A party is being split into multiple sub-parties. Distribute the original party's attributes across the new parties appropriately.

Output ONLY a valid JSON array of party objects, each matching this schema:
${PARTY_JSON_SCHEMA}

Each sub-party should get the relevant subset of means, circle members, and vulnerabilities. Re-estimate weights and weight_factors for each sub-party independently. Specialize descriptions and agendas.`,
      },
      {
        role: "user",
        content: `TOPIC: ${topicTitle}

ORIGINAL PARTY:
${JSON.stringify(sourceParty, null, 2)}

SPLIT INTO THESE PARTIES: ${splitNames.join(", ")}

RESEARCH MATERIAL:
${research}

Generate a complete profile for each sub-party. Output ONLY a valid JSON array, no markdown fences.`,
      },
    ],
    temperature: 0.3,
    max_tokens: budgetOutput(model, JSON.stringify(sourceParty) + research, { min: 3000, max: Math.max(splitNames.length * 2000, 6000) }),
  })

  const match = raw.match(/\[[\s\S]+\]/)
  if (!match) throw new Error("Failed to parse split parties JSON from LLM response")
  const parties = JSON.parse(match[0]) as Party[]

  for (const p of parties) {
    p.id = p.id || slugify(p.name)
    p.auto_discovered = false
    p.user_verified = true
  }

  log.discovery(`Smart split complete: ${parties.map(p => `${p.name} (w=${p.weight})`).join(", ")}`)
  return parties
}

export async function smartMergeParties(
  topicTitle: string,
  sources: Party[],
  targetName: string,
  model: string,
): Promise<Partial<Party>> {
  log.discovery(`Smart merge: merging ${sources.map(s => s.name).join(", ")} into "${targetName}"`)

  const raw = await chatCompletionText({
    model,
    messages: [
      {
        role: "system",
        content: `You are a geopolitical intelligence analyst. Multiple parties are being merged into one. Synthesize their profiles into a single coherent party profile.

Output ONLY a single valid JSON object matching this schema:
${PARTY_JSON_SCHEMA}

Combine means, circle members, and vulnerabilities intelligently (deduplicate, merge related items). Write a new unified description and agenda. Re-estimate weight and weight_factors for the combined entity.`,
      },
      {
        role: "user",
        content: `TOPIC: ${topicTitle}

PARTIES TO MERGE:
${sources.map(s => JSON.stringify(s, null, 2)).join("\n\n")}

MERGED PARTY NAME: ${targetName}

Synthesize a single party profile. Output ONLY valid JSON, no markdown fences.`,
      },
    ],
    temperature: 0.3,
    max_tokens: budgetOutput(model, sources.map(s => JSON.stringify(s)).join(""), { min: 2000, max: 5000 }),
  })

  const match = raw.match(/\{[\s\S]+\}/)
  if (!match) throw new Error("Failed to parse merged party JSON from LLM response")
  const merged = JSON.parse(match[0]) as Party
  merged.id = slugify(targetName)
  merged.auto_discovered = false
  merged.user_verified = true

  log.discovery(`Smart merge complete: ${merged.name} (w=${merged.weight})`)
  return merged
}
