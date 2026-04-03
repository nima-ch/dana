const BASE = "/api"

export interface Topic {
  id: string
  title: string
  description: string
  created_at: string
  updated_at: string
  status: string
  current_version: number
  models: Record<string, string>
  settings: Record<string, unknown>
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error((err as any).message || res.statusText)
  }
  return res.json()
}

export const api = {
  topics: {
    list: () => request<Topic[]>("/topics"),
    get: (id: string) => request<Topic>(`/topics/${id}`),
    create: (data: { title: string; description: string }) =>
      request<Topic>("/topics", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, patch: Partial<Topic>) =>
      request<Topic>(`/topics/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
    delete: (id: string) =>
      request<{ success: boolean }>(`/topics/${id}`, { method: "DELETE" }),
  },
  expertCouncil: {
    get: (topicId: string) => request<any>(`/topics/${topicId}/expert-council`),
    getVersion: (topicId: string, version: number) => request<any>(`/topics/${topicId}/expert-council/${version}`),
  },
  verdict: {
    get: (topicId: string) => request<any>(`/topics/${topicId}/verdict`),
    getVersion: (topicId: string, version: number) => request<any>(`/topics/${topicId}/verdict/${version}`),
  },
  pipeline: {
    discover: (topicId: string) =>
      request<{ run_id: string; started_at: string; status: string }>(
        `/topics/${topicId}/pipeline/discover`, { method: "POST" }
      ),
    enrich: (topicId: string) =>
      request<{ run_id: string; started_at: string; status: string }>(
        `/topics/${topicId}/pipeline/enrich`, { method: "POST" }
      ),
    analyze: (topicId: string) =>
      request<{ run_id: string; started_at: string; status: string }>(
        `/topics/${topicId}/pipeline/analyze`, { method: "POST" }
      ),
    run: (topicId: string) =>
      request<{ run_id: string; started_at: string; status: string }>(
        `/topics/${topicId}/pipeline/run`, { method: "POST" }
      ),
    update: (topicId: string) =>
      request<{ run_id: string; started_at: string; status: string }>(
        `/topics/${topicId}/pipeline/update`, { method: "POST" }
      ),
    reanalyze: (topicId: string) =>
      request<{ run_id: string; started_at: string; status: string }>(
        `/topics/${topicId}/pipeline/reanalyze`, { method: "POST" }
      ),
    status: (topicId: string) =>
      request<{ running: boolean; run_id?: string; started_at?: string }>(
        `/topics/${topicId}/pipeline/status`
      ),
  },
  representatives: {
    list: (topicId: string) => request<any[]>(`/topics/${topicId}/representatives`),
  },
  parties: {
    list: (topicId: string) => request<any[]>(`/topics/${topicId}/parties`),
    update: (topicId: string, partyId: string, data: Record<string, unknown>) =>
      request<any>(`/topics/${topicId}/parties/${partyId}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (topicId: string, partyId: string) =>
      request<{ success: boolean }>(`/topics/${topicId}/parties/${partyId}`, { method: "DELETE" }),
    add: (topicId: string, data: Record<string, unknown>) =>
      request<any>(`/topics/${topicId}/parties`, { method: "POST", body: JSON.stringify(data) }),
    merge: (topicId: string, sourceIds: string[], target: Record<string, unknown>) =>
      request<any>(`/topics/${topicId}/parties/merge`, {
        method: "POST", body: JSON.stringify({ source_ids: sourceIds, target }),
      }),
    smartAdd: (topicId: string, name: string) =>
      request<any>(`/topics/${topicId}/parties/smart-add`, {
        method: "POST", body: JSON.stringify({ name }),
      }),
    smartEdit: (topicId: string, partyId: string, feedback: string) =>
      request<any>(`/topics/${topicId}/parties/${partyId}/smart-edit`, {
        method: "POST", body: JSON.stringify({ feedback }),
      }),
    split: (topicId: string, sourceId: string, into: { name: string }[]) =>
      request<{ removed: string; created: any[] }>(`/topics/${topicId}/parties/split`, {
        method: "POST", body: JSON.stringify({ source_id: sourceId, into }),
      }),
  },
  clues: {
    list: (topicId: string) => request<any[]>(`/topics/${topicId}/clues`),
    update: (topicId: string, clueId: string, data: Record<string, unknown>) =>
      request<any>(`/topics/${topicId}/clues/${clueId}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (topicId: string, clueId: string) =>
      request<{ success: boolean }>(`/topics/${topicId}/clues/${clueId}`, { method: "DELETE" }),
    smartEdit: (topicId: string, clueId: string, feedback: string) =>
      request<any>(`/topics/${topicId}/clues/smart-edit/${clueId}`, {
        method: "POST", body: JSON.stringify({ feedback }),
      }),
    bulkImportStart: (topicId: string, content: string) =>
      request<{ status: string }>(`/topics/${topicId}/clues/bulk`, {
        method: "POST", body: JSON.stringify({ content }),
      }),
    bulkImportStatus: (topicId: string) =>
      request<{ status: string; imported?: number; error?: string }>(`/topics/${topicId}/clues/bulk/status`),
    research: (topicId: string, query: string) =>
      request<{ imported: number; clues: any[]; query: string }>(`/topics/${topicId}/clues/research`, {
        method: "POST", body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(600_000),
      }),
    cleanupStart: (topicId: string) =>
      request<{ status: string }>(`/topics/${topicId}/clues/cleanup/propose`, { method: "POST" }),
    cleanupStatus: (topicId: string) =>
      request<{ status: string; groups?: any[]; original_count?: number; error?: string }>(`/topics/${topicId}/clues/cleanup/status`),
    cleanupApply: (topicId: string, groups: any[]) =>
      request<{ original_count: number; merged: number; deleted: number; final_count: number }>(
        `/topics/${topicId}/clues/cleanup/apply`,
        { method: "POST", body: JSON.stringify({ groups }) },
      ),
  },
  settings: {
    get: () => request<any>("/settings"),
    update: (data: Record<string, unknown>) =>
      request<any>("/settings", { method: "PUT", body: JSON.stringify(data) }),
  },
  prompts: {
    list: () => request<Array<{ name: string; path: string; content: string; agent: string; variables: string[]; stage: string }>>("/prompts"),
    get: (name: string) => request<{ name: string; path: string; content: string; agent: string; variables: string[]; stage: string }>(`/prompts/${encodeURIComponent(name)}`),
    update: (name: string, content: string) =>
      request<{ name: string; path: string; content: string; agent: string; variables: string[]; stage: string }>(`/prompts/${encodeURIComponent(name)}`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      }),
    reset: (name: string) =>
      request<{ name: string; path: string; content: string; agent: string; variables: string[]; stage: string }>(`/prompts/${encodeURIComponent(name)}/reset`, {
        method: "POST",
      }),
  },
  providers: {
    list: () => request<{ providers: Array<{ provider: string; label: string; status: string; account: string | null; credential_file: string }> }>("/providers"),
    login: (provider: string) => request<{ provider: string; oauth_url: string | null; status: string }>("/providers/login", { method: "POST", body: JSON.stringify({ provider }) }),
    loginStatus: (provider: string) => request<{ provider: string; connected: boolean; timeout: boolean; oauth_url?: string | null; error?: string | null }>(`/providers/login/status?provider=${encodeURIComponent(provider)}`),
    disconnect: (provider: string) => request<{ provider: string; removed: number }>(`/providers/${provider}`, { method: "DELETE" }),
    models: () => request<{ providers: Array<{ provider: string; models: string[] }> }>("/providers/models"),
    statuses: () => request<{ providers: Array<{ provider: string; connected: boolean; account?: string | null }> }>("/providers"),
    health: () => request<{ proxy_online: boolean; connected_providers: string[]; model_count: number; credential_files: number }>("/providers/health"),
  },
  agents: {
    list: () => request<any[]>("/agents"),
    updateTools: (name: string, tools: string[]) =>
      request<any>(`/agents/${encodeURIComponent(name)}/tools`, {
        method: "PUT",
        body: JSON.stringify({ tools }),
      }),
    updateModel: (name: string, model: string) =>
      request<any>(`/agents/${encodeURIComponent(name)}/model`, {
        method: "PUT",
        body: JSON.stringify({ model }),
      }),
  },
  tools: {
    list: () => request<any[]>("/tools"),
    create: (data: Record<string, unknown>) =>
      request<any>("/tools", { method: "POST", body: JSON.stringify(data) }),
    remove: (name: string) =>
      request<{ success: boolean }>(`/tools/${encodeURIComponent(name)}`, {
        method: "DELETE",
      }),
  },
  models: {
    list: () => request<{ id: string }[]>("/models"),
  },
}
