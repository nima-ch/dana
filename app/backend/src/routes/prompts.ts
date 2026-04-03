import { Elysia, t } from "elysia"
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, relative, resolve } from "path"

const PROMPTS_DIR = resolve(import.meta.dir, "../../prompts")
const BACKUP_DIR = join(process.env.DATA_DIR || "/home/nima/dana/data", ".prompt-backups")

function ensureBackupDir(): void {
  mkdirSync(BACKUP_DIR, { recursive: true })
}

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  return entries.flatMap(entry => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.isFile() && entry.name.endsWith('.md') ? [full] : []
  })
}

function stageFromPath(path: string): string {
  const rel = relative(PROMPTS_DIR, path).replace(/\\/g, '/')
  return rel.split('/')[0] || 'root'
}

function agentFromPath(path: string): string {
  const rel = relative(PROMPTS_DIR, path).replace(/\\/g, '/')
  const parts = rel.split('/')
  const base = parts[parts.length - 1].replace(/\.md$/, '')
  const stage = parts[0] || 'root'
  return `${stage}:${base}`
}

function variablesFromContent(content: string): string[] {
  const vars = new Set<string>()
  for (const match of content.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)) vars.add(match[1])
  return [...vars].sort()
}

function promptNameFromPath(path: string): string {
  return relative(PROMPTS_DIR, path).replace(/\\/g, '/').replace(/\.md$/, '')
}

function promptPathForName(name: string): string {
  const normalized = name.replace(/^\/+/, '').replace(/\.md$/, '')
  const full = join(PROMPTS_DIR, `${normalized}.md`)
  if (!full.startsWith(PROMPTS_DIR)) throw new Error('Invalid prompt name')
  return full
}

function readPrompt(path: string) {
  const content = readFileSync(path, 'utf8').trim()
  return {
    name: promptNameFromPath(path),
    path: relative(PROMPTS_DIR, path).replace(/\\/g, '/'),
    content,
    agent: agentFromPath(path),
    variables: variablesFromContent(content),
    stage: stageFromPath(path),
  }
}

export const promptsRouter = new Elysia({ prefix: '/api/prompts' })
  .get('/', () => walk(PROMPTS_DIR).map(readPrompt))
  .get('/:name', ({ params, error }) => {
    try {
      const path = promptPathForName(params.name)
      if (!existsSync(path)) return error(404, { error: 'Prompt not found' })
      return readPrompt(path)
    } catch (e) {
      return error(400, { error: String(e) })
    }
  })
  .put('/:name', async ({ params, body, error }) => {
    try {
      const path = promptPathForName(params.name)
      if (!existsSync(path)) return error(404, { error: 'Prompt not found' })
      ensureBackupDir()
      const backupPath = join(BACKUP_DIR, `${params.name.replace(/\//g, '__')}.md`)
      if (!existsSync(backupPath)) writeFileSync(backupPath, readFileSync(path, 'utf8'))
      writeFileSync(path, body.content)
      return readPrompt(path)
    } catch (e) {
      return error(400, { error: String(e) })
    }
  }, { body: t.Object({ content: t.String() }) })
  .post('/:name/reset', async ({ params, error }) => {
    try {
      const path = promptPathForName(params.name)
      if (!existsSync(path)) return error(404, { error: 'Prompt not found' })
      const backupPath = join(BACKUP_DIR, `${params.name.replace(/\//g, '__')}.md`)
      if (!existsSync(backupPath)) return error(404, { error: 'Backup not found' })
      writeFileSync(path, readFileSync(backupPath, 'utf8'))
      return readPrompt(path)
    } catch (e) {
      return error(400, { error: String(e) })
    }
  })
