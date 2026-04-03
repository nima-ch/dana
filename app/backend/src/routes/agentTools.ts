import { Elysia, t } from "elysia"
import { dbGetSettings, dbSaveSettings, DEFAULT_MODELS } from "../db/queries/settings"

interface AgentConfig {
  name: string
  taskCategory: keyof typeof DEFAULT_MODELS
  defaultTools: string[]
  prompts: string[]
}

interface ToolConfig {
  name: string
  description: string
  category: "external" | "internal" | "processing"
}

const agents: AgentConfig[] = [
  { name: "DiscoveryAgent", taskCategory: "data_gathering", defaultTools: ["WebSearch", "HttpFetch", "SearchUtils"], prompts: ["discovery/research", "discovery/summary"] },
  { name: "CapabilityResearcher", taskCategory: "enrichment", defaultTools: ["WebSearch", "HttpFetch", "TimelineLookup"], prompts: ["enrichment/capabilities"] },
  { name: "NewsTracker", taskCategory: "delta_updates", defaultTools: ["WebSearch", "HttpFetch", "TimelineLookup"], prompts: ["enrichment/news-tracker"] },
  { name: "FactChecker", taskCategory: "enrichment", defaultTools: ["WebSearch", "HttpFetch", "SearchUtils"], prompts: ["enrichment/fact-checking"] },
  { name: "WeightCalculator", taskCategory: "enrichment", defaultTools: ["ClueProcessor", "SearchUtils"], prompts: ["weights/calculate"] },
  { name: "ForumPrepAgent", taskCategory: "forum_reasoning", defaultTools: ["GetPartyProfile", "GetForumData", "ArtifactStore"], prompts: ["forum/prep"] },
  { name: "RepresentativeAgent", taskCategory: "forum_reasoning", defaultTools: ["GetPartyProfile", "GetForumData"], prompts: ["forum/representative"] },
  { name: "ForumOrchestrator", taskCategory: "forum_reasoning", defaultTools: ["GetForumData", "ArtifactStore"], prompts: ["forum/orchestrator"] },
  { name: "DevilsAdvocate", taskCategory: "forum_reasoning", defaultTools: ["SearchUtils", "GetForumData"], prompts: ["forum/devils-advocate"] },
  { name: "ScenarioScorer", taskCategory: "expert_council", defaultTools: ["ClueProcessor", "ArtifactStore"], prompts: ["scoring/scenarios"] },
  { name: "SmartClueExtractor", taskCategory: "extraction", defaultTools: ["WebSearch", "HttpFetch", "StoreClue"], prompts: ["extraction/smart-clue"] },
  { name: "PartyIntelligence", taskCategory: "enrichment", defaultTools: ["WebSearch", "HttpFetch", "GetPartyProfile"], prompts: ["enrichment/party-intel"] },
]

const tools: ToolConfig[] = [
  { name: "WebSearch", description: "Search the web for relevant intelligence", category: "external" },
  { name: "HttpFetch", description: "Fetch and extract content from web pages", category: "external" },
  { name: "TimelineLookup", description: "Look up timeline context for events", category: "internal" },
  { name: "ClueProcessor", description: "Process and normalize clue data", category: "processing" },
  { name: "StoreClue", description: "Persist a clue to the database", category: "internal" },
  { name: "GetClue", description: "Retrieve clue details by ID", category: "internal" },
  { name: "GetPartyProfile", description: "Fetch party profile and metadata", category: "internal" },
  { name: "GetForumData", description: "Access forum session and turn data", category: "internal" },
  { name: "ArtifactStore", description: "Store generated artifacts and outputs", category: "internal" },
  { name: "SearchUtils", description: "Utilities for search and relevance operations", category: "processing" },
]

const CUSTOM_TOOLS_KEY = "custom_tools"
const AGENT_TOOL_OVERRIDES_KEY = "agent_tool_overrides"
const AGENT_MODEL_OVERRIDES_KEY = "agent_model_overrides"

function readSettings(): Record<string, unknown> {
  return dbGetSettings() as unknown as Record<string, unknown>
}

function saveSettings(settings: Record<string, unknown>): void {
  dbSaveSettings(settings as ReturnType<typeof dbGetSettings>)
}

function getCustomTools(): ToolConfig[] {
  const settings = readSettings()
  return Array.isArray(settings[CUSTOM_TOOLS_KEY]) ? settings[CUSTOM_TOOLS_KEY] as ToolConfig[] : []
}

function getAgentToolOverrides(): Record<string, string[]> {
  const settings = readSettings()
  return (settings[AGENT_TOOL_OVERRIDES_KEY] as Record<string, string[]>) || {}
}

function getAgentModelOverrides(): Record<string, string> {
  const settings = readSettings()
  return (settings[AGENT_MODEL_OVERRIDES_KEY] as Record<string, string>) || {}
}

function persistSettings(partial: Record<string, unknown>): void {
  const settings = { ...readSettings(), ...partial }
  saveSettings(settings)
}

function agentModel(agent: AgentConfig): string {
  const overrides = getAgentModelOverrides()
  return overrides[agent.name] || DEFAULT_MODELS[agent.taskCategory]
}

function agentTools(agent: AgentConfig): string[] {
  const overrides = getAgentToolOverrides()
  return overrides[agent.name] || agent.defaultTools
}

function cascadeToolRemoval(toolName: string): void {
  const settings = readSettings()
  const overrides = (settings[AGENT_TOOL_OVERRIDES_KEY] as Record<string, string[]>) || {}
  const nextOverrides = Object.fromEntries(
    Object.entries(overrides).map(([agentName, toolList]) => [agentName, toolList.filter(tool => tool !== toolName)])
  )
  persistSettings({ [AGENT_TOOL_OVERRIDES_KEY]: nextOverrides })
}

export const agentToolsRouter = new Elysia({ prefix: "/api" })
  .get("/agents", () => {
    return agents.map(agent => ({
      name: agent.name,
      taskCategory: agent.taskCategory,
      defaultTools: agentTools(agent),
      model: agentModel(agent),
      prompts: agent.prompts,
    }))
  })
  .put("/agents/:name/tools", async ({ params, body, set }) => {
    const agent = agents.find(item => item.name === params.name)
    if (!agent) {
      set.status = 404
      return { error: "Agent not found" }
    }
    const settings = readSettings()
    const overrides = { ...(settings[AGENT_TOOL_OVERRIDES_KEY] as Record<string, string[]> || {}) }
    overrides[params.name] = body.tools
    persistSettings({ [AGENT_TOOL_OVERRIDES_KEY]: overrides })
    return { name: params.name, tools: body.tools }
  }, { body: t.Object({ tools: t.Array(t.String()) }) })
  .put("/agents/:name/model", async ({ params, body, set }) => {
    const agent = agents.find(item => item.name === params.name)
    if (!agent) {
      set.status = 404
      return { error: "Agent not found" }
    }
    const settings = readSettings()
    const overrides = { ...(settings[AGENT_MODEL_OVERRIDES_KEY] as Record<string, string> || {}) }
    overrides[params.name] = body.model
    persistSettings({ [AGENT_MODEL_OVERRIDES_KEY]: overrides })
    return { name: params.name, model: body.model }
  }, { body: t.Object({ model: t.String() }) })
  .get("/tools", () => ([
    ...tools,
    ...getCustomTools(),
  ]))
  .post("/tools", async ({ body }) => {
    const current = getCustomTools()
    const next = current.filter(tool => tool.name !== body.name).concat({
      name: body.name,
      description: body.description,
      category: "internal",
    })
    persistSettings({ [CUSTOM_TOOLS_KEY]: next })
    return { tool: body.name, count: next.length }
  }, { body: t.Object({ name: t.String(), description: t.String(), endpoint: t.String(), inputSchema: t.Unknown() }) })
  .delete("/tools/:name", async ({ params }) => {
    const current = getCustomTools()
    const next = current.filter(tool => tool.name !== params.name)
    persistSettings({ [CUSTOM_TOOLS_KEY]: next })
    cascadeToolRemoval(params.name)
    return { removed: params.name }
  })
