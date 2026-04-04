import { parseHTML } from "linkedom"
import { Readability } from "@mozilla/readability"
import TurndownService from "turndown"

const FETCH_TIMEOUT_MS = 15_000
const JINA_READER_URL = "https://r.jina.ai/"

const PAYWALLED_DOMAINS = new Set([
  "reuters.com", "wsj.com", "ft.com", "bloomberg.com",
  "nytimes.com", "washingtonpost.com", "politico.com",
  "theathletic.com", "economist.com", "foreignpolicy.com",
  "thetimes.co.uk", "telegraph.co.uk",
])

function isPaywalled(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "")
    return PAYWALLED_DOMAINS.has(host)
  } catch { return false }
}

export interface FetchResult {
  url: string
  title: string
  raw_content: string
  fetched_at: string
  cached: boolean
}

export async function httpFetch(url: string): Promise<FetchResult> {
  if (isPaywalled(url)) {
    throw new Error(`httpFetch skipped: paywalled domain for ${url}`)
  }

  try {
    const fresh = await fetchWithJina(url)
    return { ...fresh, cached: false }
  } catch (jinaError) {
    try {
      const fallback = await fetchWithReadability(url)
      return { ...fallback, cached: false }
    } catch (fallbackError) {
      throw new Error(
        `httpFetch failed: Jina error: ${getErrorMessage(jinaError)}; fallback error: ${getErrorMessage(fallbackError)}`,
      )
    }
  }
}

async function fetchWithJina(url: string): Promise<Omit<FetchResult, "cached">> {
  const res = await fetchWithTimeout(`${JINA_READER_URL}${url}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; Dana/1.0)",
    },
  })

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from Jina Reader`)
  }

  const payload = await res.json() as JinaResponse
  const title = payload.data?.title?.trim()
  const raw_content = payload.data?.content?.trim()

  if (!title || !raw_content) {
    throw new Error("Jina Reader response missing title or content")
  }

  return {
    url,
    title,
    raw_content,
    fetched_at: new Date().toISOString(),
  }
}

async function fetchWithReadability(url: string): Promise<Omit<FetchResult, "cached">> {
  const res = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Dana/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  })

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`)
  }

  const html = await res.text()
  const { document } = parseHTML(html)

  const article = new Readability(document).parse()
  const title = article?.title?.trim() || document.title?.trim()
  const contentHtml = article?.content?.trim()

  if (!title || !contentHtml) {
    throw new Error("Readability could not extract article content")
  }

  const raw_content = new TurndownService().turndown(contentHtml).trim()
  if (!raw_content) {
    throw new Error("Turndown produced empty markdown")
  }

  return {
    url,
    title,
    raw_content,
    fetched_at: new Date().toISOString(),
  }
}

async function fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`timeout after ${FETCH_TIMEOUT_MS}ms`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface JinaResponse {
  data?: {
    title?: string
    content?: string
  }
}
