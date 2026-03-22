const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  discovery: "bg-blue-100 text-blue-700",
  review_parties: "bg-amber-100 text-amber-700",
  enrichment: "bg-indigo-100 text-indigo-700",
  review_enrichment: "bg-amber-100 text-amber-700",
  forum: "bg-purple-100 text-purple-700",
  expert_council: "bg-yellow-100 text-yellow-700",
  verdict: "bg-orange-100 text-orange-700",
  complete: "bg-green-100 text-green-700",
  stale: "bg-red-100 text-red-700",
}

const STATUS_LABELS: Record<string, string> = {
  review_parties: "review parties",
  review_enrichment: "review clues",
  expert_council: "expert council",
}

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"
  const label = STATUS_LABELS[status] ?? status.replace("_", " ")
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {label}
    </span>
  )
}
