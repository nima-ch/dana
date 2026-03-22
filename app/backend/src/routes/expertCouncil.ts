import { Elysia } from "elysia"
import { join } from "path"
import { getAllVersions } from "../pipeline/stateManager"

function getDataDir() { return process.env.DATA_DIR || "/home/nima/dana/data" }

async function loadCouncil(topicId: string, version: number) {
  const path = join(getDataDir(), "topics", topicId, `expert_council_v${version}.json`)
  const file = Bun.file(path)
  if (!(await file.exists())) return null
  return file.json()
}

export const expertCouncilRouter = new Elysia({ prefix: "/api/topics/:id" })
  .get("/expert-council", async ({ params }) => {
    const states = await getAllVersions(params.id)
    const latest = states.findLast(s => s.verdict_id)
    if (!latest) return null
    return loadCouncil(params.id, latest.version)
  })
  .get("/expert-council/:version", async ({ params, error }) => {
    const v = parseInt(params.version)
    if (isNaN(v)) return error(400, { message: "Invalid version" })
    const data = await loadCouncil(params.id, v)
    if (!data) return error(404, { message: "Expert council not found for this version" })
    return data
  })
  .get("/verdict", async ({ params }) => {
    const states = await getAllVersions(params.id)
    const latest = states.findLast(s => s.verdict_id)
    if (!latest) return null
    const council = await loadCouncil(params.id, latest.version) as any
    return council?.final_verdict ?? null
  })
