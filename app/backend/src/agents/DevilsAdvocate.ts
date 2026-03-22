import { chatCompletionText } from "../llm/proxyClient"
import { budgetOutput } from "../llm/tokenBudget"
import { getScenarioList } from "../tools/internal/getForumData"
import { writeArtifact } from "../tools/internal/artifactStore"
import { buildAgentContext, serializeContext } from "./contextBuilder"

export interface DevilsAdvocateOutput {
  target_scenario_id: string
  target_scenario_title: string
  falsification_arguments: {
    argument: string
    clues_cited: string[]
    falsification_condition: string
  }[]
  verdict: "robust" | "fragile" | "uncertain"
}

const SYSTEM = `You are the Devil's Advocate in a geopolitical analysis forum. Your job is to stress-test the MOST PROBABLE scenario.

You must produce AT LEAST 3 genuine, well-reasoned falsification arguments — reasons why the scenario might NOT occur.

OUTPUT ONLY valid JSON:
{
  "target_scenario_id": "<id>",
  "target_scenario_title": "<title>",
  "falsification_arguments": [
    {
      "argument": "<why this scenario might not happen>",
      "clues_cited": ["clue-id", ...],
      "falsification_condition": "<observable event that would confirm this argument>"
    }
  ],
  "verdict": "<robust|fragile|uncertain>"
}

Rules:
- Arguments must be logically sound and evidence-based, not rhetorical
- Each argument must cite at least one clue ID
- Minimum 3 arguments, aim for 4-5
- verdict: robust = scenario survives scrutiny, fragile = significant weaknesses, uncertain = evidence insufficient
- Output ONLY the JSON`

export async function runDevilsAdvocate(
  topicId: string,
  runId: string,
  sessionId: string,
  model: string
): Promise<DevilsAdvocateOutput> {
  const scenarios = await getScenarioList(topicId, sessionId)
  if (!scenarios.length) throw new Error("No scenarios to stress-test")

  // Target the first scenario (orchestrator will have sorted by probability)
  const target = scenarios[0]
  const ctx = await buildAgentContext("forum", topicId)
  const contextStr = serializeContext(ctx)

  const prompt = `CONTEXT:\n${contextStr}

TARGET SCENARIO: ${target.title}
Description: ${target.description}
Required conditions: ${target.required_conditions.join("; ")}
Clues cited: ${target.clues_cited.join(", ")}

Stress-test this scenario. Produce ≥3 genuine falsification arguments.`

  const daOutputBudget = budgetOutput(model, SYSTEM + prompt, { min: 2000, max: 6000 })
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await chatCompletionText({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: attempt === 0 ? prompt : `${prompt}\n\nOutput ONLY valid JSON. Min 3 arguments.` },
      ],
      temperature: 0.4,
      max_tokens: daOutputBudget,
    })

    try {
      const match = raw.match(/\{[\s\S]+\}/)
      if (!match) throw new Error("No JSON found")
      const parsed = JSON.parse(match[0]) as DevilsAdvocateOutput
      if (!parsed.falsification_arguments || parsed.falsification_arguments.length < 3) {
        throw new Error(`Only ${parsed.falsification_arguments?.length ?? 0} arguments, need ≥3`)
      }
      // Always use the actual scenario ID, not whatever the LLM generated
      parsed.target_scenario_id = target.id
      parsed.target_scenario_title = target.title
      await writeArtifact(topicId, runId, "devils_advocate", parsed)
      return parsed
    } catch (e) {
      console.warn(`DevilsAdvocate parse attempt ${attempt + 1} failed:`, e)
    }
  }

  throw new Error("DevilsAdvocate: failed to produce valid output after 3 attempts")
}
