import { Elysia, t } from "elysia"
import { DEFAULT_MODELS, DEFAULT_CONTROLS, TASK_CATEGORIES, dbGetSettings, dbSaveSettings } from "../db/queries/settings"
import type { AnalysisControls } from "../db/queries/settings"

export async function getDefaultModels(): Promise<Record<string, string>> {
  return dbGetSettings().default_models
}

const CONTROL_RANGES: Record<keyof AnalysisControls, [number, number]> = {
  discovery_research_iterations: [5, 30],
  scoring_iterations: [5, 20],
  scoring_batch_size: [1, 4],
  enrichment_iterations: [5, 25],
  enrichment_batch_size: [1, 4],
  forum_max_turns: [10, 100],
  max_fetch_chars: [1000, 8000],
  corpus_cache_hours: [1, 24],
}

function clampControls(input: Partial<AnalysisControls>): Partial<AnalysisControls> {
  const clamped: Partial<AnalysisControls> = {}
  for (const [key, value] of Object.entries(input)) {
    const k = key as keyof AnalysisControls
    const range = CONTROL_RANGES[k]
    if (range && typeof value === "number") {
      clamped[k] = Math.max(range[0], Math.min(range[1], Math.round(value)))
    }
  }
  return clamped
}

export const settingsRouter = new Elysia({ prefix: "/api/settings" })
  .get("/", () => dbGetSettings())
  .put("/", ({ body }) => {
    const settings = dbGetSettings()

    if (body.default_models) {
      settings.default_models = {
        ...DEFAULT_MODELS,
        ...settings.default_models,
        ...Object.fromEntries(TASK_CATEGORIES.map(category => [category, body.default_models?.[category] ?? settings.default_models[category] ?? DEFAULT_MODELS[category]])),
      }
    }

    if (body.analysis_controls) {
      const clamped = clampControls(body.analysis_controls)
      settings.analysis_controls = { ...settings.analysis_controls, ...clamped }
    }

    dbSaveSettings(settings)
    return settings
  }, {
    body: t.Object({
      default_models: t.Optional(t.Record(t.String(), t.String())),
      analysis_controls: t.Optional(t.Record(t.String(), t.Number())),
    })
  })
