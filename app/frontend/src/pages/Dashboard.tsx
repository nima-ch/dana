import { useEffect, useState } from "react"
import { useTopicsStore } from "../stores/topicsStore"
import { TopicCard } from "../components/Dashboard/TopicCard"
import { NewTopicDialog } from "../components/Dashboard/NewTopicDialog"
import { GlobalSettingsDialog } from "../components/Dashboard/GlobalSettingsDialog"

export function Dashboard() {
  const { topics, loading, error, fetch, create, delete: deleteTopic } = useTopicsStore()
  const [showDialog, setShowDialog] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => { fetch() }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Dana</h1>
          <p className="text-xs text-gray-500">Geopolitical & Scenario Analysis</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-2 text-gray-400 hover:text-gray-600 text-sm"
            onClick={() => setShowSettings(true)}
            title="Global Settings"
          >
            &#9881;
          </button>
          <button
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
            onClick={() => setShowDialog(true)}
          >
            + New Topic
          </button>
        </div>
      </header>

      <main className="px-6 py-6 max-w-6xl mx-auto">
        {loading && (
          <div className="text-center py-12 text-gray-400 text-sm">Loading topics…</div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-4">
            {error}
          </div>
        )}

        {!loading && topics.length === 0 && (
          <div className="text-center py-20">
            <p className="text-gray-400 text-sm mb-4">No topics yet.</p>
            <button
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
              onClick={() => setShowDialog(true)}
            >
              Create your first topic
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {topics.map(topic => (
            <TopicCard
              key={topic.id}
              topic={topic}
              onDelete={deleteTopic}
            />
          ))}
        </div>
      </main>

      {showDialog && (
        <NewTopicDialog
          onClose={() => setShowDialog(false)}
          onCreate={create}
        />
      )}

      {showSettings && (
        <GlobalSettingsDialog onClose={() => setShowSettings(false)} />
      )}
    </div>
  )
}
