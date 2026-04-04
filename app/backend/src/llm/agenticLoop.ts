import { chatCompletion } from "./proxyClient"
import type { ChatMessage, ToolDefinition, ToolCall } from "./proxyClient"
import { webSearch } from "../tools/external/webSearch"
import { httpFetch } from "../tools/external/httpFetch"
import { emitThink } from "../routes/stream"
import { log } from "../utils/logger"

const MAX_FETCH_CHARS = 3000
const DEFAULT_MAX_ITERATIONS = 10
const CHARS_PER_TOKEN = 4

export type CustomToolHandler = (args: Record<string, unknown>) => Promise<string>

interface AgenticLoopOptions {
  model: string
  messages: ChatMessage[]
  tools: ToolDefinition[]
  topicId: string
  maxIterations?: number
  temperature?: number
  max_tokens?: number
  customTools?: Record<string, CustomToolHandler>
  contextWarningThreshold?: number
}

function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0
  for (const m of messages) {
    if (m.content) chars += m.content.length
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        chars += tc.function.name.length + tc.function.arguments.length
      }
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

async function executeBuiltinTool(call: ToolCall, topicId: string): Promise<string> {
  const name = call.function.name
  let args: Record<string, unknown>
  try {
    args = JSON.parse(call.function.arguments)
  } catch {
    return JSON.stringify({ error: "Invalid JSON arguments" })
  }

  if (name === "web_search") {
    const query = String(args.query ?? "")
    const numResults = Math.min(Math.max(Number(args.num_results) || 3, 1), 5)
    emitThink(topicId, "🔎", "Searching", query)
    log.enrichment(`Tool call: web_search("${query}", ${numResults})`)
    try {
      const results = await webSearch(query, numResults)
      emitThink(topicId, "📄", `Found ${results.length} results`, results.slice(0, 3).map(r => r.title).join(", "))
      log.enrichment(`web_search: ${results.length} results for "${query}"`)
      return JSON.stringify(results.map(r => ({ title: r.title, url: r.url, snippet: r.snippet, date: r.date })))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitThink(topicId, "⚠", "Search failed", msg)
      log.enrichment(`web_search failed: ${msg}`)
      return JSON.stringify({ error: msg })
    }
  }

  if (name === "fetch_url") {
    const url = String(args.url ?? "")
    emitThink(topicId, "🌐", "Fetching", url)
    log.enrichment(`Tool call: fetch_url("${url}")`)
    try {
      const result = await httpFetch(url, topicId)
      const content = result.raw_content.slice(0, MAX_FETCH_CHARS)
      emitThink(topicId, "✓", "Fetched", `${result.title} (${result.raw_content.length} chars)`)
      log.enrichment(`fetch_url: ${result.title} (${result.raw_content.length} chars)`)
      return JSON.stringify({ title: result.title, content })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitThink(topicId, "⚠", "Fetch failed", msg)
      log.enrichment(`fetch_url failed: ${msg}`)
      return JSON.stringify({ error: msg })
    }
  }

  return JSON.stringify({ error: `Unknown built-in tool: ${name}` })
}

export async function runAgenticLoop(options: AgenticLoopOptions): Promise<string> {
  const { model, tools, topicId, temperature, max_tokens, customTools } = options
  const maxIter = options.maxIterations ?? DEFAULT_MAX_ITERATIONS
  const contextWarning = options.contextWarningThreshold ?? 150000
  const messages: ChatMessage[] = [...options.messages]
  let contextWarned = false

  for (let iteration = 0; iteration < maxIter; iteration++) {
    const response = await chatCompletion({
      model,
      messages,
      tools,
      tool_choice: "auto",
      temperature,
      max_tokens,
    })

    const choice = response.choices[0]
    if (!choice) throw new Error("No response from LLM")

    const assistantMsg = choice.message
    messages.push(assistantMsg)

    if (!assistantMsg.tool_calls?.length) {
      return assistantMsg.content ?? ""
    }

    emitThink(topicId, "🔧", `Tool calls (round ${iteration + 1})`, assistantMsg.tool_calls.map(tc => tc.function.name).join(", "))
    log.enrichment(`Agentic loop iteration ${iteration + 1}: ${assistantMsg.tool_calls.length} tool call(s)`)

    for (const toolCall of assistantMsg.tool_calls) {
      let result: string

      if (customTools && customTools[toolCall.function.name]) {
        let args: Record<string, unknown>
        try {
          args = JSON.parse(toolCall.function.arguments)
        } catch {
          args = {}
        }
        result = await customTools[toolCall.function.name](args)
      } else {
        result = await executeBuiltinTool(toolCall, topicId)
      }

      messages.push({
        role: "tool",
        content: result,
        tool_call_id: toolCall.id,
      })
    }

    if (!contextWarned) {
      const estTokens = estimateTokens(messages)
      if (estTokens > contextWarning) {
        contextWarned = true
        emitThink(topicId, "⏱", "Context budget high", `~${Math.round(estTokens / 1000)}k tokens used. Wrapping up soon.`)
        log.enrichment(`Agentic loop: context warning at ~${estTokens} tokens`)
        messages.push({
          role: "user",
          content: "IMPORTANT: You are approaching the context budget limit. Finish your current research and produce your final output within the next 2-3 tool calls.",
        })
      }
    }
  }

  log.enrichment(`Agentic loop hit max iterations (${maxIter}), forcing final response`)
  emitThink(topicId, "⏱", "Max research rounds reached", "Generating final answer...")

  messages.push({
    role: "user",
    content: "You have done enough research. Now output your final answer as valid JSON based on everything you have gathered. No more tool calls.",
  })

  const finalResponse = await chatCompletion({
    model,
    messages,
    temperature,
    max_tokens,
  })

  return finalResponse.choices[0]?.message?.content ?? ""
}
