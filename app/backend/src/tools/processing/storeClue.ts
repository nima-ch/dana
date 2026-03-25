import { dbInsertClue, dbClueExists, dbNextClueId } from "../../db/queries/clues"
import type { ClueVersion, Clue } from "../../db/queries/clues"
import type { ClueProcessorOutput } from "./clueProcessor"

// Re-export types for compatibility
export type { ClueVersion, Clue }

export interface StoreClueInput {
  topicId: string
  title: string
  sourceUrl: string
  fetchedAt: string
  processed: ClueProcessorOutput
  partyRelevance?: string[]
  domainTags?: string[]
  timelineDate?: string
  clueType?: string
  addedBy?: "auto" | "user"
  changeNote?: string
}

export interface StoreClueResult {
  clue_id: string
  version: number
  status: "created" | "duplicate"
}

export async function storeClue(input: StoreClueInput): Promise<StoreClueResult> {
  const timelineDate = input.timelineDate || input.processed.date_references[0] || new Date().toISOString().slice(0, 10)

  // Check for duplicate: same URL + same timeline_date
  const existingId = dbClueExists(input.topicId, input.sourceUrl, timelineDate)
  if (existingId) {
    return { clue_id: existingId, version: 1, status: "duplicate" }
  }

  const id = dbNextClueId(input.topicId)
  const now = new Date().toISOString()

  const version: ClueVersion = {
    v: 1,
    date: now,
    title: input.title,
    raw_source: {
      url: input.sourceUrl,
      fetched_at: input.fetchedAt,
    },
    source_credibility: {
      score: input.processed.source_credibility_score,
      notes: input.processed.credibility_notes,
      bias_flags: input.processed.bias_flags,
      origin_source: input.processed.origin_source,
    },
    bias_corrected_summary: input.processed.bias_corrected_summary,
    relevance_score: input.processed.relevance_score,
    party_relevance: input.partyRelevance || [],
    domain_tags: input.domainTags || [],
    timeline_date: timelineDate,
    clue_type: input.clueType || "event",
    change_note: input.changeNote || "Initial version",
    key_points: input.processed.key_points,
  }

  dbInsertClue(input.topicId, {
    id,
    current: 1,
    added_at: now,
    last_updated_at: now,
    added_by: input.addedBy || "auto",
    status: "verified",
    version,
  })

  return { clue_id: id, version: 1, status: "created" }
}
