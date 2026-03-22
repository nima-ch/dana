export interface SearchResult {
  title: string
  url: string
  snippet: string
  date?: string
}

// Uses DuckDuckGo HTML search — no API key required
export async function webSearch(
  query: string,
  numResults: number = 5,
  dateFilter?: string
): Promise<SearchResult[]> {
  const q = dateFilter ? `${query} ${dateFilter}` : query
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Dana/1.0)",
      Accept: "text/html",
    },
  })

  if (!res.ok) throw new Error(`webSearch failed: HTTP ${res.status}`)

  const html = await res.text()
  const results: SearchResult[] = []

  // Parse result blocks from DDG HTML response
  const resultRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g
  const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([^<]+)<\/a>/g

  const urls: string[] = []
  const titles: string[] = []
  const snippets: string[] = []

  let m: RegExpExecArray | null
  while ((m = resultRegex.exec(html)) !== null && urls.length < numResults) {
    const href = m[1]
    const title = m[2].trim()
    // DDG wraps URLs — extract the actual URL from uddg param
    const uddg = href.match(/uddg=([^&]+)/)
    const actualUrl = uddg ? decodeURIComponent(uddg[1]) : href
    if (actualUrl.startsWith("http")) {
      urls.push(actualUrl)
      titles.push(title)
    }
  }

  let si = 0
  while ((m = snippetRegex.exec(html)) !== null && si < urls.length) {
    snippets.push(m[1].trim())
    si++
  }

  for (let i = 0; i < Math.min(urls.length, numResults); i++) {
    results.push({
      title: titles[i] || "",
      url: urls[i],
      snippet: snippets[i] || "",
    })
  }

  return results
}
