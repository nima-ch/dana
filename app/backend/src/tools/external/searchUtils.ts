import type { SearchResult } from "./webSearch"

// Score a search result by recency and keyword relevance
export function scoreResult(result: SearchResult, titleKeywords: string[]): number {
  let score = 0

  if (result.date) {
    try {
      const ageMs = Date.now() - new Date(result.date).getTime()
      const ageMonths = ageMs / (1000 * 60 * 60 * 24 * 30)
      if (ageMonths <= 3) score += 40
      else if (ageMonths <= 6) score += 25
      else if (ageMonths <= 12) score += 15
    } catch { /* ignore */ }
  }

  const text = `${result.title} ${result.snippet}`.toLowerCase()
  for (const kw of titleKeywords) {
    if (text.includes(kw)) score += 10
  }

  return score
}

// Select best results: highest-scored, guaranteeing at least one most-recent if available
export function selectBestResults(results: SearchResult[], titleKeywords: string[], maxPick = 2): SearchResult[] {
  if (results.length === 0) return []

  const scored = results.map(r => ({ r, score: scoreResult(r, titleKeywords) }))
  scored.sort((a, b) => b.score - a.score)

  const picked: SearchResult[] = [scored[0].r]

  const withDate = results.filter(r => r.date)
  if (withDate.length > 0) {
    const mostRecent = [...withDate].sort((a, b) =>
      new Date(b.date!).getTime() - new Date(a.date!).getTime()
    )[0]
    if (mostRecent.url !== picked[0].url) picked.push(mostRecent)
  }

  for (const { r } of scored) {
    if (picked.length >= maxPick) break
    if (!picked.find(p => p.url === r.url)) picked.push(r)
  }

  return picked.slice(0, maxPick)
}

// Select best results with recency requirement — for news tracking
// Filters out results older than maxAgeDays if their date is known
export function selectRecentResults(results: SearchResult[], titleKeywords: string[], maxPick = 3, maxAgeDays = 90): SearchResult[] {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000

  // Separate dated results: keep only those within window, or undated (can't verify age)
  const eligible = results.filter(r => {
    if (!r.date) return true  // no date = keep, can't exclude
    try {
      return new Date(r.date).getTime() >= cutoff
    } catch { return true }
  })

  return selectBestResults(eligible.length >= 2 ? eligible : results, titleKeywords, maxPick)
}
