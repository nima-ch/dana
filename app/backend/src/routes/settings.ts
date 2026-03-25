import { Elysia, t } from "elysia"
import { dbGetSettings, dbSaveSettings } from "../db/queries/settings"

export async function getDefaultModels(): Promise<Record<string, string>> {
  return dbGetSettings().default_models
}

export const settingsRouter = new Elysia({ prefix: "/api/settings" })
  .get("/", () => dbGetSettings())
  .put("/", ({ body }) => {
    const settings = dbGetSettings()
    if (body.default_models) {
      settings.default_models = { ...settings.default_models, ...body.default_models }
    }
    dbSaveSettings(settings)
    return settings
  }, {
    body: t.Object({
      default_models: t.Optional(t.Record(t.String(), t.String())),
    })
  })
