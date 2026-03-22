import { Elysia, t } from "elysia"
import { join } from "path"

function getDataDir() { return process.env.DATA_DIR || "/home/nima/dana/data" }

const DEFAULT_MODELS: Record<string, string> = {
  data_gathering: "claude-haiku-4-5-20251001",
  extraction: "claude-haiku-4-5-20251001",
  enrichment: "claude-sonnet-4-6",
  delta_updates: "claude-sonnet-4-6",
  forum_reasoning: "claude-opus-4-6",
  expert_council: "claude-opus-4-6",
  verdict: "claude-opus-4-6",
}

function settingsPath() {
  return join(getDataDir(), "settings.json")
}

interface AppSettings {
  default_models: Record<string, string>
}

async function loadSettings(): Promise<AppSettings> {
  const file = Bun.file(settingsPath())
  if (!(await file.exists())) {
    return { default_models: DEFAULT_MODELS }
  }
  return file.json()
}

async function saveSettings(settings: AppSettings): Promise<void> {
  await Bun.write(settingsPath(), JSON.stringify(settings, null, 2))
}

export async function getDefaultModels(): Promise<Record<string, string>> {
  const settings = await loadSettings()
  return settings.default_models
}

export const settingsRouter = new Elysia({ prefix: "/api/settings" })
  .get("/", async () => loadSettings())
  .put("/", async ({ body }) => {
    const settings = await loadSettings()
    if (body.default_models) {
      settings.default_models = { ...settings.default_models, ...body.default_models }
    }
    await saveSettings(settings)
    return settings
  }, {
    body: t.Object({
      default_models: t.Optional(t.Record(t.String(), t.String())),
    })
  })
