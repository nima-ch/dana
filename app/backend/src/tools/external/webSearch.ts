export interface SearchResult {
  title: string
  url: string
  snippet: string
  date?: string  // ISO date string, extracted from snippet text or URL path when detectable
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

  // DDG returns 202 or a JS-challenge page when rate-limiting bots — detect and retry once
  if (!html.includes("result__a")) {
    // Back off and retry once after a short delay
    await new Promise(r => setTimeout(r, 1500))
    const retry = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    })
    const retryHtml = await retry.text()
    if (!retryHtml.includes("result__a")) {
      throw new Error(`webSearch blocked: DDG returned no results (rate-limited or bot-detected)`)
    }
    return parseResults(retryHtml, numResults)
  }

  return parseResults(html, numResults)
}

function parseResults(html: string, numResults: number): SearchResult[] {
  const results: SearchResult[] = []
  const resultRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g
  const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([^<]+)<\/a>/g

  const urls: string[] = []
  const titles: string[] = []
  const snippets: string[] = []

  let m: RegExpExecArray | null
  while ((m = resultRegex.exec(html)) !== null && urls.length < numResults) {
    const href = m[1]
    const title = m[2].trim()
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
      date: extractDate(urls[i], snippets[i] || ""),
    })
  }

  return results
}

// Extract a date from the URL path or snippet text
// Covers common patterns: /2026/03/27/, /2026-03-27, "March 27, 2026", "27 Mar 2026"
function extractDate(url: string, snippet: string): string | undefined {
  // URL path: /YYYY/MM/DD/ or /YYYY-MM-DD
  const urlDate = url.match(/[\/\-](\d{4})[\/\-](0[1-9]|1[0-2])[\/\-](0[1-9]|[12]\d|3[01])/)
  if (urlDate) return `${urlDate[1]}-${urlDate[2]}-${urlDate[3]}`

  // Snippet: "Month DD, YYYY" or "DD Month YYYY"
  const MONTHS: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  }
  const mdy = snippet.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(20\d{2})\b/i)
  if (mdy) {
    const m = MONTHS[mdy[1].slice(0, 3).toLowerCase()]
    const d = mdy[2].padStart(2, "0")
    return `${mdy[3]}-${m}-${d}`
  }
  const dmy = snippet.match(/\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(20\d{2})\b/i)
  if (dmy) {
    const m = MONTHS[dmy[2].slice(0, 3).toLowerCase()]
    const d = dmy[1].padStart(2, "0")
    return `${dmy[3]}-${m}-${d}`
  }

  return undefined
}
