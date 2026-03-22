import { join } from "path"
import { createHash } from "crypto"

const CACHE_TTL_MS = 48 * 60 * 60 * 1000 // 48 hours

export interface FetchResult {
  url: string
  title: string
  raw_content: string
  fetched_at: string
  cached: boolean
}

function urlHash(url: string): string {
  return createHash("md5").update(url).digest("hex")
}

function getCachePath(topicId: string, url: string): string {
  const dataDir = process.env.DATA_DIR || "/home/nima/dana/data"
  return join(dataDir, "topics", topicId, "sources", "cache", `${urlHash(url)}.json`)
}

// Strip HTML tags and collapse whitespace — lightweight readability
function extractText(html: string): { title: string; content: string } {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  const title = titleMatch ? titleMatch[1].trim() : ""

  // Remove script, style, nav, header, footer, aside blocks
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, " ")
    // Replace block elements with newlines
    .replace(/<\/(p|div|h[1-6]|li|br|tr|blockquote)>/gi, "\n")
    // Strip remaining tags
    .replace(/<[^>]+>/g, " ")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Collapse whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  // Keep first ~8000 chars to stay within LLM context
  if (text.length > 8000) text = text.slice(0, 8000) + "..."

  return { title, content: text }
}

export async function httpFetch(url: string, topicId?: string): Promise<FetchResult> {
  // Check cache if topicId provided
  if (topicId) {
    const cachePath = getCachePath(topicId, url)
    const cacheFile = Bun.file(cachePath)
    if (await cacheFile.exists()) {
      const cached = await cacheFile.json() as FetchResult & { cached_at: string }
      const age = Date.now() - new Date(cached.cached_at).getTime()
      if (age < CACHE_TTL_MS) {
        return { ...cached, cached: true }
      }
    }
  }

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Dana/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  })

  if (!res.ok) throw new Error(`httpFetch failed: HTTP ${res.status} for ${url}`)

  const html = await res.text()
  const { title, content: raw_content } = extractText(html)

  const result: FetchResult = {
    url,
    title,
    raw_content,
    fetched_at: new Date().toISOString(),
    cached: false,
  }

  // Write to cache
  if (topicId) {
    const cachePath = getCachePath(topicId, url)
    await Bun.write(cachePath, JSON.stringify({ ...result, cached_at: new Date().toISOString() }, null, 2))
  }

  return result
}
