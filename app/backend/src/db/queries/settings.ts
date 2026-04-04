import { getDb } from "../database"

export const TASK_CATEGORIES = [
  "data_gathering",
  "extraction",
  "enrichment",
  "delta_updates",
  "forum_reasoning",
  "expert_council",
  "verdict",
] as const

export type TaskCategory = typeof TASK_CATEGORIES[number]

export const DEFAULT_MODELS: Record<TaskCategory, string> = {
  data_gathering: "claude-haiku-4-5-20251001",
  extraction: "claude-haiku-4-5-20251001",
  enrichment: "claude-sonnet-4-6",
  delta_updates: "claude-sonnet-4-6",
  forum_reasoning: "claude-opus-4-6",
  expert_council: "claude-opus-4-6",
  verdict: "claude-opus-4-6",
}

export interface AnalysisControls {
  discovery_research_iterations: number
  scoring_iterations: number
  scoring_batch_size: number
  enrichment_iterations: number
  enrichment_batch_size: number
  forum_max_turns: number
  max_fetch_chars: number
  corpus_cache_hours: number
}

export const DEFAULT_CONTROLS: AnalysisControls = {
  discovery_research_iterations: 20,
  scoring_iterations: 12,
  scoring_batch_size: 2,
  enrichment_iterations: 15,
  enrichment_batch_size: 2,
  forum_max_turns: 50,
  max_fetch_chars: 3000,
  corpus_cache_hours: 2,
}

export interface AppSettings {
  default_models: Record<string, string>
  analysis_controls: AnalysisControls
}

export function dbGetSettings(): AppSettings {
  const row = getDb().query<{ value: string }, [string]>(
    "SELECT value FROM app_settings WHERE key = ?"
  ).get("app_settings")
  if (!row) return { default_models: DEFAULT_MODELS, analysis_controls: DEFAULT_CONTROLS }
  try {
    const parsed = JSON.parse(row.value)
    return {
      default_models: parsed.default_models ?? DEFAULT_MODELS,
      analysis_controls: { ...DEFAULT_CONTROLS, ...(parsed.analysis_controls ?? {}) },
    }
  } catch {
    return { default_models: DEFAULT_MODELS, analysis_controls: DEFAULT_CONTROLS }
  }
}

export function dbSaveSettings(settings: AppSettings): void {
  getDb().run(
    `INSERT INTO app_settings (key, value) VALUES ('app_settings', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    [JSON.stringify(settings)]
  )
}

export function dbGetDefaultModels(): Record<string, string> {
  return dbGetSettings().default_models
}

export function dbGetControls(): AnalysisControls {
  return dbGetSettings().analysis_controls
}
