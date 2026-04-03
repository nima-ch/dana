import { Elysia, t } from "elysia"
import { readdirSync, rmSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { spawn } from "child_process"
import { fetchAvailableModels, isProxyAvailable } from "../llm/proxyClient"

const credentialsDir = () => join(process.env.DATA_DIR || "/home/nima/dana/data", ".cli-proxy-api")
const loginTimeoutMs = Number(process.env.PROVIDER_LOGIN_TIMEOUT_MS || 120000)
const activeLogins = new Map<string, { startedAt: number; oauthUrl?: string; done: boolean; error?: string }>()

function ensureCredentialsDir() {
  mkdirSync(credentialsDir(), { recursive: true })
}

function providerLabel(provider: string) {
  return provider === "claude" ? "Anthropic" : provider[0].toUpperCase() + provider.slice(1)
}

function scanProviderCredentials() {
  const dir = credentialsDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(name => name.endsWith(".json") || name.endsWith(".yaml") || name.endsWith(".yml") || name.endsWith(".token"))
}

function normalizeProvider(provider: string) {
  return provider.toLowerCase().trim()
}

function providerFromFile(name: string) {
  const base = name.split(".")[0]
  return base.replace(/^(credentials-|auth-|token-)/, "")
}

export const providersRouter = new Elysia({ prefix: "/api/providers" })
  .get("/", async () => {
    const files = scanProviderCredentials()
    const connected = files.map(file => {
      const provider = providerFromFile(file)
      let account: string | null = null
      try {
        const raw = readFileSync(join(credentialsDir(), file), "utf8")
        const parsed = raw.trim().startsWith("{") ? JSON.parse(raw) : null
        account = parsed?.email || parsed?.account || parsed?.username || parsed?.name || null
      } catch {}
      return { provider, label: providerLabel(provider), status: "connected", account, credential_file: file }
    })
    return { providers: connected }
  })
  .post("/login", async ({ body, set }) => {
    if (!(await isProxyAvailable())) {
      set.status = 503
      return { error: "CLIProxyAPI unavailable" }
    }

    const provider = normalizeProvider(body.provider)
    ensureCredentialsDir()
    const command = `CLIProxyAPI -${provider}-login -no-browser`
    const proc = spawn(command, { shell: true, env: process.env })
    const state = { startedAt: Date.now(), done: false, oauthUrl: undefined as string | undefined, error: undefined as string | undefined }
    activeLogins.set(provider, state)

    proc.stdout.on("data", chunk => {
      const text = String(chunk)
      const match = text.match(/https?:\/\/\S+/)
      if (match && !state.oauthUrl) state.oauthUrl = match[0]
    })
    proc.stderr.on("data", chunk => {
      const text = String(chunk)
      if (!state.error) state.error = text.trim()
    })
    proc.on("exit", code => {
      state.done = code === 0
    })

    return { provider, oauth_url: state.oauthUrl ?? null, status: "started" }
  }, { body: t.Object({ provider: t.String() }) })
  .get("/login/status", async ({ query }) => {
    const provider = normalizeProvider(query.provider)
    const state = activeLogins.get(provider)
    const credential = scanProviderCredentials().find(file => providerFromFile(file) === provider)
    if (credential) {
      return { provider, connected: true, timeout: false }
    }
    if (!state) return { provider, connected: false, timeout: false }
    const timedOut = Date.now() - state.startedAt > loginTimeoutMs
    if (timedOut) return { provider, connected: false, timeout: true }
    return { provider, connected: state.done, timeout: false, oauth_url: state.oauthUrl ?? null, error: state.error ?? null }
  })
  .delete("/:provider", async ({ params, set }) => {
    const provider = normalizeProvider(params.provider)
    ensureCredentialsDir()
    const files = scanProviderCredentials().filter(file => providerFromFile(file) === provider)
    for (const file of files) rmSync(join(credentialsDir(), file), { force: true })
    return { provider, removed: files.length }
  })
  .get("/models", async () => {
    const models = await fetchAvailableModels()
    const grouped = new Map<string, string[]>()
    for (const model of models) {
      const provider = model.owned_by || model.id.split("/")[0] || "unknown"
      if (!grouped.has(provider)) grouped.set(provider, [])
      grouped.get(provider)!.push(model.id)
    }
    return { providers: Array.from(grouped.entries()).map(([provider, models]) => ({ provider, models })) }
  })
