import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "./StatusBadge"
import type { Topic } from "@/api/client"

export function TopicCard({ topic, onDelete }: { topic: Topic; onDelete: (id: string) => Promise<void> }) {
  return (
    <article className="group rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <Link to={`/topic/${topic.id}`} className="block space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-2 text-base font-semibold leading-snug">{topic.title}</h3>
          <StatusBadge status={topic.status} />
        </div>
        <p className="line-clamp-2 text-sm text-muted-foreground">{topic.description || "No description provided."}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Updated {new Date(topic.updated_at).toLocaleDateString()}</span>
          <span>{(topic.settings as any)?.party_count ?? 0} parties</span>
          <span>{(topic.settings as any)?.clue_count ?? 0} clues</span>
        </div>
      </Link>
      <div className="mt-4 flex justify-end">
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void onDelete(topic.id) }}>Delete</Button>
      </div>
    </article>
  )
}
