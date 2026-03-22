import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { webSearch } from "../src/tools/external/webSearch"
import { httpFetch } from "../src/tools/external/httpFetch"
import { timelineLookup } from "../src/tools/external/timelineLookup"
import { mkdir, rm } from "fs/promises"
import { join } from "path"

const TEST_DATA_DIR = "/tmp/dana-tools-test"
const TEST_TOPIC_ID = "test-topic"

beforeAll(async () => {
  process.env.DATA_DIR = TEST_DATA_DIR
  await mkdir(join(TEST_DATA_DIR, "topics", TEST_TOPIC_ID, "sources", "cache"), { recursive: true })
})

afterAll(async () => {
  await rm(TEST_DATA_DIR, { recursive: true, force: true })
})

describe("webSearch", () => {
  it("returns array of results with correct shape", async () => {
    const results = await webSearch("Bun.js runtime", 3)
    expect(Array.isArray(results)).toBe(true)
    // DDG may return 0 results in headless env — just check shape if any
    for (const r of results) {
      expect(typeof r.title).toBe("string")
      expect(typeof r.url).toBe("string")
      expect(r.url).toMatch(/^https?:\/\//)
      expect(typeof r.snippet).toBe("string")
    }
    console.log(`webSearch returned ${results.length} results`)
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
