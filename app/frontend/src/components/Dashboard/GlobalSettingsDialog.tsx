import { useEffect, useState } from "react"
import { api } from "../../api/client"

const TASK_CATEGORIES = [
  { key: "data_gathering", label: "Data Gathering" },
  { key: "extraction", label: "Extraction" },
  { key: "enrichment", label: "Enrichment" },
  { key: "delta_updates", label: "Delta Updates" },
  { key: "forum_reasoning", label: "Forum Reasoning" },
  { key: "expert_council", label: "Expert Council" },
  { key: "verdict", label: "Verdict" },
]

export function GlobalSettingsDialog({ onClose }: { onClose: () => void }) {
  const [models, setModels] = useState<Record<string, string>>({})
  const [availableModels, setAvailableModels] = useState<{ id: string }[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.settings.get().then(s => setModels(s.default_models || {})).catch(() => {})
    api.models.list().then(setAvailableModels).catch(() => {})
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.settings.update({ default_models: models })
      onClose()
    } catch (e) {
      console.error("Failed to save settings:", e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Global Default Models</h2>
          <button className="text-gray-400 hover:text-gray-600 text-sm" onClick={onClose}>&#10005;</button>
        </div>

        <p className="text-xs text-gray-400 mb-4">New topics will inherit these model assignments.</p>

        <div className="space-y-3 mb-6">
          {TASK_CATEGORIES.map(cat => (
            <div key={cat.key} className="flex items-center gap-3">
              <span className="text-xs text-gray-700 flex-1">{cat.label}</span>
              <select
                className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-700 w-44"
                value={models[cat.key] || ""}
                onChange={e => setModels({ ...models, [cat.key]: e.target.value })}
              >
                <option value="">Select model</option>
                {availableModels.map(m => (
                  <option key={m.id} value={m.id}>{m.id}</option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className="flex gap-2 justify-end">
          <button className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800" onClick={onClose}>Cancel</button>
          <button
            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Defaults"}
          </button>
        </div>
      </div>
    </div>
  )
}
