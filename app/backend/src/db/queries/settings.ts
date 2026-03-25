import { getDb } from "../database"

const DEFAULT_MODELS: Record<string, string> = {
  data_gathering: "claude-haiku-4-5-20251001",
  extraction: "claude-haiku-4-5-20251001",
  enrichment: "claude-sonnet-4-6",
  delta_updates: "claude-sonnet-4-6",
  forum_reasoning: "claude-opus-4-6",
  expert_council: "claude-opus-4-6",
  verdict: "claude-opus-4-6",
}

export interface AppSettings {
  default_models: Record<string, string>
}

export function dbGetSettings(): AppSettings {
  const row = getDb().query<{ value: string }, [string]>(
    "SELECT value FROM app_settings WHERE key = ?"
  ).get("app_settings")
  if (!row) return { default_models: DEFAULT_MODELS }
  try {
    return JSON.parse(row.value)
  } catch {
    return { default_models: DEFAULT_MODELS }
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
