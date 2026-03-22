import { useState } from "react"

interface Props {
  onClose: () => void
  onCreate: (title: string, description: string) => Promise<unknown>
}

export function NewTopicDialog({ onClose, onCreate }: Props) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setLoading(true)
    setError("")
    try {
      await onCreate(title.trim(), description.trim())
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">New Topic</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Topic / Question</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. IRI regime collapse and formation of a new Iranian state"
              value={title}
              onChange={e => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={4}
              placeholder="Provide context and scope for the analysis..."
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim()}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Creating…" : "Create Topic"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
