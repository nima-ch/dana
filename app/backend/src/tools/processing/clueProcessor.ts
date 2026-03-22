import { chatCompletionText } from "../../llm/proxyClient"

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

const SYSTEM_PROMPT = `You are a neutral intelligence analyst. Given raw web content and a topic context, extract and bias-correct the information in a single pass.

You must output ONLY a valid JSON object with exactly these fields:
{
  "extracted_content": "The main factual content extracted from the raw text, neutrally stated",
  "bias_corrected_summary": "A bias-corrected, neutrally worded summary of the key facts relevant to the topic",
  "bias_flags": ["array of applicable flags from: state_media, opposition_media, pro_western, pro_russia, pro_china, unverified, single_source, satire, opinion, mild_opposition_lean, mild_government_lean, financial_interest, none"],
  "source_credibility_score": <integer 0-100>,
  "credibility_notes": "Brief explanation of the credibility score",
  "origin_source": {
    "url": "URL of the FIRST publisher of this claim (may equal the fetched URL if not a republication)",
    "outlet": "Name of the originating outlet",
    "is_republication": <true if fetched page cites/attributes another outlet as the original source, false otherwise>
  },
  "key_points": ["array of 2-5 concise factual bullet points"],
  "date_references": ["array of dates mentioned in ISO format where possible, e.g. 2026-02-15"],
  "relevance_score": <integer 0-100 indicating relevance to the topic context>
}

Rules:
- bias_corrected_summary must be strictly neutral — remove loaded language, emotional framing, rhetorical devices
- If the page is clearly opinion/editorial, flag it and still extract factual claims only
- origin_source.url: if the article says "According to Reuters..." or "First reported by BBC...", the origin is Reuters/BBC not the current outlet
- credibility_score: 80+ = established outlet with editorial standards, 50-79 = minor/partisan outlet, <50 = unverified/single source/state media with known distortion history
- Output ONLY the JSON object, no prose before or after`

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
