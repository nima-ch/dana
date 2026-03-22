import { join } from "path"

function getDataDir(): string {
  return process.env.DATA_DIR || "/home/nima/dana/data"
}

export interface Topic {
  id: string
  title: string
  description: string
  created_at: string
  updated_at: string
  status: "draft" | "discovery" | "review_parties" | "enrichment" | "review_enrichment" | "forum" | "expert_council" | "verdict" | "complete" | "stale"
  current_version: number
  models: {
    data_gathering: string
    extraction: string
    enrichment: string
    delta_updates: string
    forum_reasoning: string
    expert_council: string
    verdict: string
  }
  settings: {
    auto_discover_parties: boolean
    auto_gather_clues: boolean
    clue_search_depth: number
    forum_rounds: number
    expert_count: number
    language: string
    auto_refresh_clues: boolean
    refresh_interval_hours: number
  }
}

const DEFAULT_MODELS = {
  data_gathering: "claude-haiku-4-5-20251001",
  extraction: "claude-haiku-4-5-20251001",
  enrichment: "claude-sonnet-4-6",
  delta_updates: "claude-sonnet-4-6",
  forum_reasoning: "claude-opus-4-6",
  expert_council: "claude-opus-4-6",
  verdict: "claude-opus-4-6",
}

const DEFAULT_SETTINGS = {
  auto_discover_parties: true,
  auto_gather_clues: true,
  clue_search_depth: 3,
  forum_rounds: 3,
  expert_count: 6,
  language: "en",
  auto_refresh_clues: false,
  refresh_interval_hours: 24,
}

function topicDir(id: string): string {
  return join(getDataDir(), "topics", id)
}

function topicFile(id: string): string {
  return join(topicDir(id), "topic.json")
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
}

async function ensureDir(path: string): Promise<void> {
  const { mkdir } = await import("fs/promises")
  await mkdir(path, { recursive: true })
}

async function readJSON<T>(path: string): Promise<T> {
  const f = Bun.file(path)
  if (!(await f.exists())) throw new Error(`File not found: ${path}`)
  return f.json() as Promise<T>
}

async function writeJSON(path: string, data: unknown): Promise<void> {
  await Bun.write(path, JSON.stringify(data, null, 2))
}

export async function listTopics(): Promise<Topic[]> {
  const { readdir } = await import("fs/promises")
  const topicsPath = join(getDataDir(), "topics")
  try {
    const dirs = await readdir(topicsPath)
    const topics: Topic[] = []
    for (const dir of dirs) {
      try {
        const topic = await readJSON<Topic>(join(topicsPath, dir, "topic.json"))
        topics.push(topic)
      } catch {
        // skip malformed dirs
      }
    }
    return topics.sort((a, b) => b.created_at.localeCompare(a.created_at))
  } catch {
    return []
  }
}

export async function getTopic(id: string): Promise<Topic> {
  return readJSON<Topic>(topicFile(id))
}

async function loadGlobalDefaultModels(): Promise<Record<string, string>> {
  try {
    const settingsFile = Bun.file(join(getDataDir(), "settings.json"))
    if (await settingsFile.exists()) {
      const settings = await settingsFile.json() as { default_models?: Record<string, string> }
      if (settings.default_models) return { ...DEFAULT_MODELS, ...settings.default_models }
    }
  } catch { /* fallback to hardcoded */ }
  return DEFAULT_MODELS
}

export async function createTopic(data: { title: string; description: string; models?: Partial<Topic["models"]>; settings?: Partial<Topic["settings"]> }): Promise<Topic> {
  const id = slugify(data.title) + "-" + Date.now().toString(36)
  const dir = topicDir(id)
  await ensureDir(dir)
  await ensureDir(join(dir, "sources", "raw"))
  await ensureDir(join(dir, "sources", "cache"))
  await ensureDir(join(dir, "logs"))
  await ensureDir(join(dir, "exports"))

  const globalModels = await loadGlobalDefaultModels()

  const topic: Topic = {
    id,
    title: data.title,
    description: data.description,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: "draft",
    current_version: 0,
    models: { ...globalModels, ...data.models },
    settings: { ...DEFAULT_SETTINGS, ...data.settings },
  }

  await writeJSON(topicFile(id), topic)
  await writeJSON(join(dir, "parties.json"), [])
  await writeJSON(join(dir, "clues.json"), [])
  await writeJSON(join(dir, "representatives.json"), [])
  await writeJSON(join(dir, "states.json"), [])

  return topic
}

export async function updateTopic(id: string, patch: Partial<Topic>): Promise<Topic> {
  const topic = await getTopic(id)
  const updated: Topic = { ...topic, ...patch, id, updated_at: new Date().toISOString() }
  await writeJSON(topicFile(id), updated)
  return updated
}

export async function deleteTopic(id: string): Promise<void> {
  const { rm } = await import("fs/promises")
  await rm(topicDir(id), { recursive: true, force: true })
}
