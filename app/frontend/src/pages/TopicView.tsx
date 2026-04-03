import { useParams } from "react-router-dom"

export function TopicView() {
  const { id } = useParams()
  return <div className="min-h-screen bg-background p-6 text-foreground">Topic workspace placeholder for {id}</div>
}
