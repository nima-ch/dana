import { chatCompletionText } from "../../llm/proxyClient"
import { loadPrompt } from "../../llm/promptLoader"

export interface OriginSource {
  url: string
  outlet: string
  is_republication: boolean
}

export interface ClueProcessorOutput {
  extracted_content: string
  bias_corrected_summary: string
  bias_flags: string[]
  source_credibility_score: number
  credibility_notes: string
  origin_source: OriginSource
  key_points: string[]
  date_references: string[]
  relevance_score: number
}

const SYSTEM_PROMPT = loadPrompt("clue-processor/system")

export async function processClue(
  rawHtml: string,
  sourceUrl: string,
  topicContext: string,
  model: string = "claude-haiku-4-5-20251001"
): Promise<ClueProcessorOutput> {
  const truncatedHtml = rawHtml.slice(0, 6000)

  const prompt = `SOURCE URL: ${sourceUrl}

TOPIC CONTEXT: ${topicContext}

RAW CONTENT:
${truncatedHtml}

Extract, bias-correct, and analyze this content for the topic context above.`

  const text = await chatCompletionText({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    max_tokens: 1000,
  })

  // Extract JSON from response — handle markdown code fences if present
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/) || text.match(/(\{[\s\S]+\})/)
  const jsonStr = jsonMatch ? jsonMatch[1] : text

  try {
    const parsed = JSON.parse(jsonStr) as ClueProcessorOutput
    // Validate required fields exist
    const required: (keyof ClueProcessorOutput)[] = [
      "extracted_content", "bias_corrected_summary", "bias_flags",
      "source_credibility_score", "credibility_notes", "origin_source",
      "key_points", "date_references", "relevance_score"
    ]
    for (const field of required) {
      if (parsed[field] === undefined) throw new Error(`Missing field: ${field}`)
    }
    return parsed
  } catch (e) {
    throw new Error(`ClueProcessor: failed to parse LLM response as JSON: ${e}\nResponse: ${text}`)
  }
}
