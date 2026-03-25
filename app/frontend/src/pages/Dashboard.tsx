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
      {/* Header */}
      <header className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
              <span className="text-white text-sm font-bold">D</span>
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900 leading-tight">Dana</h1>
              <p className="text-[10px] text-gray-400 leading-tight">Geopolitical & Scenario Analysis</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              onClick={() => setShowSettings(true)}
              title="Global Settings"
            >
              ⚙
            </button>
            <button
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
              onClick={() => setShowDialog(true)}
            >
              + New Topic
            </button>
          </div>
        </div>
      </header>

      <main className="px-6 py-8 max-w-6xl mx-auto">
        {loading && (
          <div className="flex items-center justify-center py-20 gap-2 text-gray-400">
            <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
            <span className="text-sm">Loading topics…</span>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-6">
            {error}
          </div>
        )}

        {!loading && topics.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center text-2xl">🌍</div>
            <div className="text-center">
              <p className="text-gray-700 font-medium text-sm">No topics yet</p>
              <p className="text-gray-400 text-xs mt-1">Create your first geopolitical analysis topic</p>
            </div>
            <button
              className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
              onClick={() => setShowDialog(true)}
            >
              Create first topic
            </button>
          </div>
        )}

        {topics.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-5">
              <p className="text-xs text-gray-400">{topics.length} topic{topics.length !== 1 ? "s" : ""}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {topics.map(topic => (
                <TopicCard key={topic.id} topic={topic} onDelete={deleteTopic} />
              ))}
            </div>
          </>
        )}
      </main>

      {showDialog && (
        <NewTopicDialog onClose={() => setShowDialog(false)} onCreate={create} />
      )}
      {showSettings && (
        <GlobalSettingsDialog onClose={() => setShowSettings(false)} />
      )}
    </div>
  )
}
