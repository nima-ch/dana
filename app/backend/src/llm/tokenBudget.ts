// Approximate token count using chars/3.5 ratio (good enough for Claude)
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

// Known context windows for Claude models
const CONTEXT_WINDOWS: Record<string, number> = {
  "claude-haiku-4-5-20251001": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-opus-4-6": 200_000,
  "claude-opus-4-5-20251101": 200_000,
  "claude-opus-4-20250514": 200_000,
}
const DEFAULT_CONTEXT_WINDOW = 128_000

export function getContextWindow(model: string): number {
  if (CONTEXT_WINDOWS[model]) return CONTEXT_WINDOWS[model]
  if (model.includes("claude")) return 200_000
  return DEFAULT_CONTEXT_WINDOW
}

// Given the model and actual input text, compute a safe max_tokens for output
export function budgetOutput(
  model: string,
  inputText: string,
  opts: { min: number; max: number },
): number {
  const contextWindow = getContextWindow(model)
  const inputTokens = estimateTokens(inputText)
  const safetyMargin = 500
  const available = contextWindow - inputTokens - safetyMargin
  return Math.min(Math.max(available, opts.min), opts.max)
}

// Section with priority for context fitting
export interface ContextSection {
  content: string
  priority: number   // higher = keep first, lower = trim first
  label: string
}

// Fit multiple context sections into a token budget.
// High-priority sections kept in full; low-priority trimmed/dropped.
// Returns concatenated string that fits within maxTokens.
export function fitContext(sections: ContextSection[], maxTokens: number): string {
  const sorted = [...sections].sort((a, b) => b.priority - a.priority)

  const included: { content: string; label: string }[] = []
  let usedTokens = 0

  for (const section of sorted) {
    const sectionTokens = estimateTokens(section.content)

    if (usedTokens + sectionTokens <= maxTokens) {
      included.push({ content: section.content, label: section.label })
      usedTokens += sectionTokens
    } else {
      const remaining = maxTokens - usedTokens
      if (remaining > 200) {
        // Truncate to fit remaining budget
        const charBudget = Math.floor(remaining * 3.5)
        const truncated = section.content.slice(0, charBudget) + `\n\n[...${section.label} truncated]`
        included.push({ content: truncated, label: section.label })
        usedTokens += remaining
      }
      break
    }
  }

  return included.map(s => s.content).join("\n\n")
}
