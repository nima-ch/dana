import { Elysia, t } from "elysia"
import { DEFAULT_MODELS, TASK_CATEGORIES, dbGetSettings, dbSaveSettings } from "../db/queries/settings"

export async function getDefaultModels(): Promise<Record<string, string>> {
  return dbGetSettings().default_models
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
    dbSaveSettings(settings)
    return settings
  }, {
    body: t.Object({
      default_models: t.Optional(t.Record(t.String(), t.String())),
    })
  })
