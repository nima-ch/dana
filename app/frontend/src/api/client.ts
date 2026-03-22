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
  models: {
    list: () => request<{ id: string }[]>("/models"),
  },
}
