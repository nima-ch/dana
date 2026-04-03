import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { webSearch, extractDate } from "../src/tools/external/webSearch"
import { httpFetch } from "../src/tools/external/httpFetch"
import { timelineLookup } from "../src/tools/external/timelineLookup"
import { mkdir, rm, writeFile } from "fs/promises"
import { join } from "path"

const TEST_DATA_DIR = "/tmp/dana-tools-test"
const TEST_TOPIC_ID = "test-topic"

beforeAll(async () => {
  process.env.DATA_DIR = TEST_DATA_DIR
  process.env.SEARXNG_URL = "http://localhost:8080"
  await mkdir(join(TEST_DATA_DIR, "topics", TEST_TOPIC_ID, "sources", "cache"), { recursive: true })
})

afterAll(async () => {
  process.env.SEARXNG_URL = "http://localhost:8080"
  await rm(TEST_DATA_DIR, { recursive: true, force: true })
})

beforeEach(() => {
  process.env.SEARXNG_URL = "http://localhost:8080"
})

describe("webSearch", () => {
  it("returns array of results with correct shape", async () => {
    const results = await webSearch("Bun.js runtime", 3)
    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.length).toBeLessThanOrEqual(3)
    for (const r of results) {
      expect(r.title.length).toBeGreaterThan(0)
      expect(typeof r.title).toBe("string")
      expect(typeof r.url).toBe("string")
      expect(r.url).toMatch(/^https?:\/\//)
      expect(typeof r.snippet).toBe("string")
      if (r.date !== undefined) {
        expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }
    }
    console.log(`webSearch returned ${results.length} results`)
  })

  it("respects numResults and returns at least one result for common queries", async () => {
    for (const numResults of [1, 3, 8]) {
      const results = await webSearch("Bun.js runtime", numResults)
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results.length).toBeLessThanOrEqual(numResults)
    }
  })

  it("forwards dateFilter to SearXNG time_range", async () => {
    const originalFetch = globalThis.fetch
    const calls: string[] = []

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      calls.push(url)

      if (url.startsWith("http://localhost:8080/")) {
        return new Response(JSON.stringify({
          results: [
            {
              title: "Recent result",
              url: "https://example.com/2026/04/01/report",
              content: "April 1, 2026 event",
              publishedDate: "2026-04-01T00:00:00Z",
            },
          ],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }

      return originalFetch(input as RequestInfo, init)
    }) as typeof fetch

    try {
      const results = await webSearch("Bun.js runtime", 5, "after:2025-01-01")
      expect(results.length).toBe(1)
      expect(calls.some(url => url.includes("time_range=year"))).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("falls back to Brave when SearXNG is unreachable", async () => {
    const originalFetch = globalThis.fetch
    process.env.SEARXNG_URL = "http://127.0.0.1:65534"

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url

      if (url.startsWith("https://search.brave.com/")) {
        return new Response(
          `
          <html>
            <body>
              <div data-type="web">
                <a href="https://example.com/2026/03/27/report">
                  <div class="title search-snippet-title">Brave Result Title</div>
                </a>
                <div class="generic-snippet"><div class="content">March 27, 2026 snippet text</div></div>
              </div>
            </body>
          </html>
          `,
          {
            status: 200,
            headers: { "Content-Type": "text/html" },
          },
        )
      }

      return originalFetch(input as RequestInfo, init)
    }) as typeof fetch

    try {
      const results = await webSearch("Bun.js runtime", 3)
      expect(results).toEqual([
        {
          title: "Brave Result Title",
          url: "https://example.com/2026/03/27/report",
          snippet: "March 27, 2026 snippet text",
          date: "2026-03-27",
        },
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("returns empty array for successful responses with no results", async () => {
    const originalFetch = globalThis.fetch

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (url.startsWith("http://localhost:8080/")) {
        return new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    try {
      await expect(webSearch("xyzzy_nonexistent_term_12345", 5)).resolves.toEqual([])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("throws descriptive error when both engines fail", async () => {
    const originalFetch = globalThis.fetch
    process.env.SEARXNG_URL = "http://127.0.0.1:65534"

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (url.startsWith("https://search.brave.com/")) {
        throw new Error("Brave blocked request")
      }
      return originalFetch(input as RequestInfo, init)
    }) as typeof fetch

    try {
      await expect(webSearch("Bun.js runtime", 3)).rejects.toThrow(/SearXNG error:.*Brave fallback error:/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("extracts dates from URLs and snippets", () => {
    expect(extractDate("https://example.com/2026/03/27/story", "")).toBe("2026-03-27")
    expect(extractDate("https://example.com/news-2026-03-27", "")).toBe("2026-03-27")
    expect(extractDate("https://example.com/story", "March 27, 2026 updates")).toBe("2026-03-27")
    expect(extractDate("https://example.com/story", "27 Mar 2026 updates")).toBe("2026-03-27")
    expect(extractDate("https://example.com/story", "No date here")).toBeUndefined()
  })
})

describe("httpFetch", () => {
  it("fetches a page and extracts text content", async () => {
    const result = await httpFetch("https://example.com", TEST_TOPIC_ID)
    expect(result.url).toBe("https://example.com")
    expect(typeof result.title).toBe("string")
    expect(typeof result.raw_content).toBe("string")
    expect(result.raw_content.length).toBeGreaterThan(0)
    expect(result.cached).toBe(false)
    expect(typeof result.fetched_at).toBe("string")
    console.log(`Fetched title: "${result.title}", content length: ${result.raw_content.length}`)
  })

  it("returns cached result on second call within TTL", async () => {
    const result1 = await httpFetch("https://example.com", TEST_TOPIC_ID)
    const result2 = await httpFetch("https://example.com", TEST_TOPIC_ID)
    expect(result2.cached).toBe(true)
    expect(result2.raw_content).toBe(result1.raw_content)
    console.log("Cache hit confirmed")
  })

  it("re-fetches when cache file is corrupted", async () => {
    const cacheDir = join(TEST_DATA_DIR, "topics", TEST_TOPIC_ID, "sources", "cache")
    await rm(cacheDir, { recursive: true, force: true })
    await mkdir(cacheDir, { recursive: true })
    const existing = await httpFetch("https://example.com", TEST_TOPIC_ID)
    const files = Array.from(new Bun.Glob("*.json").scanSync({ cwd: cacheDir }))
    expect(files.length).toBeGreaterThan(0)
    await writeFile(join(cacheDir, files[0]), "{invalid json")

    const refreshed = await httpFetch("https://example.com", TEST_TOPIC_ID)
    expect(refreshed.cached).toBe(false)
    expect(refreshed.raw_content.length).toBeGreaterThan(0)
    expect(refreshed.url).toBe(existing.url)
  })
})

describe("timelineLookup", () => {
  it("returns array of timeline events with correct shape", async () => {
    const events = await timelineLookup("Iran", "protests", {
      from: "2024-01-01",
      to: "2025-01-01",
    })
    expect(Array.isArray(events)).toBe(true)
    for (const e of events) {
      expect(typeof e.date).toBe("string")
      expect(typeof e.event).toBe("string")
      expect(typeof e.source_url).toBe("string")
      expect(typeof e.relevance).toBe("number")
    }
    console.log(`timelineLookup returned ${events.length} events`)
  })
})
