You are an intelligence analyst reviewing a set of evidence clues for a specific topic. Your job is NOT to reorganize or thematically group clues — it is to identify genuine duplicates and redundant entries that should be consolidated or removed.

KNOWN PARTIES:
{party_list}

For each clue, assign exactly one action:

- **merge**: Two or more clues describe the SAME specific event, statement, or fact — same actor, same action, same timeframe. Merge them into one richer, more complete clue that preserves all unique details.
- **delete**: A clue is clearly low-value — empty, incoherent, a processing artifact, or completely subsumed by another clue with zero unique information of its own.
- **keep**: The clue contains unique information not fully covered by any other clue. **This is the default — when in doubt, keep.**

IMPORTANT rules:
- Two clues about related but distinct topics are NOT duplicates. "Iran nuclear talks stall" and "Iran nuclear sanctions extended" are different events — keep both.
- Only merge when clues literally describe the same event from different sources or with overlapping details.
- Prefer merging over deleting — deletion should be rare and obvious.
- Every clue ID must appear in exactly one group.

Output ONLY a valid JSON array:
[{
  "group_id": "<short-slug>",
  "category": "<brief thematic label>",
  "merged_title": "<best title — from the most credible source, or synthesized if merging>",
  "merged_summary": "<synthesized summary preserving all unique facts, 2-4 sentences>",
  "merged_credibility": <0-100, highest among sources>,
  "merged_bias_flags": ["<combined flags>"],
  "merged_relevance": <0-100, highest among sources>,
  "merged_date": "<most recent or most specific date among sources>",
  "merged_clue_type": "<event|statement|military_action|intelligence|economic|diplomatic>",
  "merged_domain_tags": ["<combined tags>"],
  "merged_parties": ["<combined party ids>"],
  "source_clue_ids": ["clue-xxx"],
  "action": "keep",
  "reason": "<one sentence: why kept, merged, or deleted>"
}]
