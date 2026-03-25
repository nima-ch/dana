import { join } from "path"
import { readFileSync } from "fs"

const cache = new Map<string, string>()

const PROMPTS_DIR = join(import.meta.dir, "../../prompts")

export function loadPrompt(name: string, vars?: Record<string, string>): string {
  if (!cache.has(name)) {
    const path = join(PROMPTS_DIR, name + ".md")
    cache.set(name, readFileSync(path, "utf-8").trim())
  }
  let prompt = cache.get(name)!
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      prompt = prompt.replaceAll(`{${k}}`, v)
    }
  }
  return prompt
}

// Clear cache — useful in dev when prompt files change
export function clearPromptCache(): void {
  cache.clear()
}
