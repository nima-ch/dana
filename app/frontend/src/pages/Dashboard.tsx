import { useEffect, useState } from "react"
import { useTopicsStore } from "../stores/topicsStore"
import { TopicCard } from "../components/Dashboard/TopicCard"
import { NewTopicDialog } from "../components/Dashboard/NewTopicDialog"
import { GlobalSettingsDialog } from "../components/Dashboard/GlobalSettingsDialog"

export function Dashboard() {
  const { topics, loading, error, fetch, create, delete: deleteTopic } = useTopicsStore()
  const [showDialog, setShowDialog] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => { void fetch() }, [fetch])

  return (
    <>
      <main className="mx-auto max-w-6xl px-6 py-8">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
            <span className="text-sm">Loading topics…</span>
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!loading && topics.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-2xl">🌍</div>
            <div>
              <p className="text-sm font-medium">No topics yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Create your first geopolitical analysis topic</p>
            </div>
            <button
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:opacity-90"
              onClick={() => setShowDialog(true)}
            >
              Create first topic
            </button>
          </div>
        )}

        {topics.length > 0 && (
          <>
            <div className="mb-5 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{topics.length} topic{topics.length !== 1 ? "s" : ""}</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {topics.map(topic => <TopicCard key={topic.id} topic={topic} onDelete={deleteTopic} />)}
            </div>
          </>
        )}
      </main>
      {showDialog && <NewTopicDialog onClose={() => setShowDialog(false)} onCreate={create} />}
      {showSettings && <GlobalSettingsDialog onClose={() => setShowSettings(false)} />}
    </>
  )
}
