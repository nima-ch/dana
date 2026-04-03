import { useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { api } from "@/api/client"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

interface RankedScenario {
  scenario_id: string
  title: string
  probability: number
  confidence: "high" | "medium" | "low"
  key_drivers: string[]
  watch_indicators: string[]
  near_future_trajectories: {
    "90_days": string
    "6_months": string
    "1_year": string
  }
}

interface FinalVerdict {
  synthesized_at: string
  scenarios_ranked: RankedScenario[]
  final_assessment: string
  confidence_note: string
}

const confidenceClasses: Record<RankedScenario["confidence"], string> = {
  high: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  low: "bg-rose-500/15 text-rose-400 border-rose-500/30",
}

export function VerdictPanel({ topicId, version }: { topicId: string; version?: number }) {
  const [verdict, setVerdict] = useState<FinalVerdict | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedScenario, setExpandedScenario] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    const fetcher = version ? api.verdict.getVersion(topicId, version) : api.verdict.get(topicId)
    fetcher.then(setVerdict).catch(() => setVerdict(null)).finally(() => setLoading(false))
  }, [topicId, version])

  const rankedScenarios = useMemo(() => {
    return [...(verdict?.scenarios_ranked ?? [])].sort((a, b) => b.probability - a.probability)
  }, [verdict])

  if (loading) return <div className="py-12 text-center text-sm text-muted-foreground">Loading verdict…</div>
  if (!verdict) return <EmptyState />

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Analysis</p>
          <h2 className="text-xl font-semibold">Scenario probabilities</h2>
          <CardDescription>Ranked outcome assessment for this analysis version.</CardDescription>
        </div>
        <Badge variant="outline" className="border-border/70 text-muted-foreground">Synthesized {new Date(verdict.synthesized_at).toLocaleString()}</Badge>
      </div>

      <div className="space-y-3">
        {rankedScenarios.map((scenario, index) => {
          const expanded = expandedScenario === scenario.scenario_id
          return (
            <Card key={scenario.scenario_id} className="gap-0 overflow-hidden">
              <button className="w-full text-left" onClick={() => setExpandedScenario(expanded ? null : scenario.scenario_id)}>
                <CardHeader className="gap-3 border-b border-border/60">
                  <div className="flex items-start gap-4">
                    <div className="min-w-10 text-3xl font-semibold text-muted-foreground">#{index + 1}</div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="truncate text-base">{scenario.title || scenario.scenario_id}</CardTitle>
                          <CardDescription className="mt-1 text-xs">{scenario.scenario_id}</CardDescription>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-semibold text-foreground">{Math.round(scenario.probability * 100)}%</div>
                          <Badge variant="outline" className={cn("mt-1 capitalize", confidenceClasses[scenario.confidence])}>{scenario.confidence} confidence</Badge>
                        </div>
                      </div>

                      <div className="h-2 rounded-full bg-muted">
                        <div className="h-2 rounded-full bg-blue-500" style={{ width: `${scenario.probability * 100}%` }} />
                      </div>

                      {scenario.key_drivers.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {scenario.key_drivers.map((driver) => <Badge key={driver} variant="secondary" className="bg-blue-500/10 text-blue-300">{driver}</Badge>)}
                        </div>
                      )}
                    </div>
                    <div className="pt-1 text-muted-foreground">{expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</div>
                  </div>
                </CardHeader>
              </button>

              {expanded && (
                <CardContent className="space-y-4 py-5">
                  {scenario.watch_indicators.length > 0 && (
                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Watch indicators</h3>
                      <ul className="space-y-2">
                        {scenario.watch_indicators.map((indicator) => <li key={indicator} className="flex items-start gap-2 text-sm text-foreground"><span className="mt-1 h-2 w-2 rounded-full bg-primary" />{indicator}</li>)}
                      </ul>
                    </section>
                  )}

                  <Separator />

                  <section className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Timeline trajectories</h3>
                    <div className="grid gap-3 md:grid-cols-3">
                      {(["90_days", "6_months", "1_year"] as const).map((period) => {
                        const label = period === "90_days" ? "90 Days" : period === "6_months" ? "6 Months" : "1 Year"
                        const text = scenario.near_future_trajectories?.[period]
                        if (!text) return null
                        return <TimelineCard key={period} label={label} text={text} />
                      })}
                    </div>
                  </section>
                </CardContent>
              )}
            </Card>
          )
        })}
      </div>

      <Card className="gap-0">
        <CardHeader className="border-b border-border/60">
          <CardTitle className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Final assessment</CardTitle>
          <CardDescription className="text-base text-foreground">{verdict.final_assessment}</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-amber-100">
            <p className="text-xs uppercase tracking-[0.2em] text-amber-300">Confidence note</p>
            <p className="mt-2 text-sm leading-6 text-amber-50">{verdict.confidence_note}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function TimelineCard({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <p className="mt-2 text-sm leading-6 text-foreground/90 whitespace-pre-line">{text}</p>
    </div>
  )
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="text-lg font-semibold">No verdict available yet.</div>
        <p className="max-w-md text-sm text-muted-foreground">Scenario probabilities and the final assessment will appear here once analysis completes.</p>
      </CardContent>
    </Card>
  )
}
