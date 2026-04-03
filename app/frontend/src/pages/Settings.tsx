import { Navigate, useParams } from "react-router-dom"

const tabs = new Set(["providers", "prompts", "agents", "pipeline"])

export function SettingsPage() {
  const { tab } = useParams()
  if (tab && !tabs.has(tab)) return <Navigate to="/settings" replace />

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="text-sm text-muted-foreground">Configure providers, prompts, agents, and pipeline settings.</p>
      <div className="rounded-xl border border-border bg-card p-6">Active tab: {tab ?? "providers"}</div>
    </div>
  )
}
