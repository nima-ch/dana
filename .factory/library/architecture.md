# Dana — System Architecture

Dana is an AI-powered geopolitical scenario analysis platform. Users create **topics** (geopolitical questions), and the system researches, debates, and scores possible outcomes through a multi-stage AI pipeline.

---

## High-Level Components

```
┌──────────────┐       REST / SSE        ┌──────────────────┐     OpenAI-compat     ┌─────────────┐
│   Frontend   │ ◄─────────────────────► │     Backend      │ ──────────────────►   │ CLIProxyAPI  │
│  React 19    │   localhost:5173 (dev)   │  Bun + Elysia    │   localhost:8317      │ (LLM proxy)  │
│  Vite + TW4  │                         │  localhost:3000   │                       │  Docker ctr  │
└──────────────┘                         └────────┬─────────┘                       └─────────────┘
                                                  │
                                                  ▼
                                          ┌──────────────┐
                                          │    SQLite     │
                                          │  {DATA_DIR}/  │
                                          │   dana.db     │
                                          │  (WAL mode)   │
                                          └──────────────┘
```

### Backend (Bun + Elysia, port 3000)

The single backend process handles REST API, SSE streaming, database access, and AI pipeline orchestration.

- **Routes** — CRUD endpoints under `/api/*` for topics, parties, clues, forum sessions, expert verdicts, settings, and pipeline control. A Swagger UI is served at `/docs`.
- **Database** — SQLite via `bun:sqlite` in WAL mode with foreign keys. ~16 tables covering topics, parties, clues (versioned), forum sessions/turns, scenarios, verdicts, versions, settings, and checkpoints. The database is the single source of truth for all persistent state.
- **LLM Client** — `proxyClient.ts` sends all LLM requests to CLIProxyAPI (an external Docker container exposing an OpenAI-compatible API at port 8317). No LLM calls are ever made directly; the proxy handles provider routing and auth.
- **Prompt System** — 35+ Markdown prompt templates loaded by `promptLoader.ts` with `{variable}` placeholder substitution. Templates are cached after first load.
- **SSE Event Bus** — An in-memory pub-sub system keyed by topic ID. Backend code calls `emit(topicId, event)`, and all SSE clients subscribed to that topic receive the event. Event types include thinking traces, progress updates, forum turns, weight results, verdicts, and errors.
- **Pipeline** — Orchestrates the analysis lifecycle (see below). Supports checkpointing via JSON files for resumability.

### Frontend (React 19 + Vite 8 + TailwindCSS 4, port 5173)

A single-page app with two routes:

- `/` — Dashboard: list of topics with creation dialog and global settings.
- `/topic/:id` — Topic workspace: the main analysis view with parties, clues, forum conversation, and expert verdict panels.

Key patterns:
- **API client** (`api/client.ts`) wraps all REST calls to the backend.
- **SSE hook** (`hooks/useSSE.ts`) subscribes to `/api/topics/:id/stream` for real-time pipeline events.
- **Zustand store** manages the topic list. Topic-level data is fetched per-page via the API client.

### CLIProxyAPI (External, port 8317)

A Docker container that provides an OpenAI-compatible HTTP API. All LLM interactions route through it. It handles provider selection, authentication, and model routing. The backend never calls LLM providers directly.

---

## Data Model (Key Entities)

- **Topic** — A geopolitical question with status, model configuration, and version counter.
- **Party** — A stakeholder (state or non-state actor) linked to a topic, with weight, agenda, means, and stance.
- **Clue** — A piece of evidence or intelligence, versioned. Can be auto-discovered or user-added.
- **Forum Session / Turns** — A structured multi-agent debate where party representatives argue about scenarios.
- **Scenario** — A possible outcome with probability scores.
- **Verdict** — The final scored assessment synthesized from forum debate.
- **Version** — Snapshots marking completed analysis runs.

---

## Pipeline (Analysis Lifecycle)

Each topic progresses through a 5-stage pipeline:

```
Discovery → Enrichment → Weight Calculation → Forum → Scenario Scoring
```

| Stage | What Happens | Key Agents |
|-------|-------------|------------|
| **Discovery** | Researches the topic, identifies parties and initial clues via web search | DiscoveryAgent |
| **Enrichment** | Deep-dives on each party and clue: capability research, news tracking, fact checking | EnrichmentAgent, CapabilityResearcher, NewsTracker, FactChecker |
| **Weight Calc** | Computes relative influence weights for each party | WeightCalculator |
| **Forum** | Multi-agent debate: party representatives argue scenarios under a supervisor, with a devil's advocate | ForumOrchestrator, ForumSupervisor, RepresentativeAgent, DevilsAdvocate |
| **Scoring** | Objectively scores scenarios based on forum output and evidence | ScenarioScorer |

**Topic status** transitions through: `draft → discovery → enrichment → forum → expert_council → complete → stale`

**Resumability:** Each stage writes a checkpoint on completion. If the pipeline is restarted, completed stages are skipped. A delta pipeline handles incremental updates when new clues arrive after initial analysis.

**Model mapping:** Task categories map to models with a priority chain: global defaults → per-topic overrides → per-agent overrides.

---

## Data Flow

1. **User action** → Frontend calls a REST endpoint on the backend.
2. **Backend** processes the request: reads/writes SQLite, may trigger pipeline stages.
3. **Pipeline stages** call LLM via `proxyClient.ts` → CLIProxyAPI, use external tools (web search, HTTP fetch), and store results in SQLite.
4. **Real-time updates** flow back via SSE: the backend emits events per topic, and the frontend's SSE hook receives them to update the UI live.

---

## Key Invariants

- **SQLite is the single source of truth** for all data. No external databases.
- **All LLM calls go through `proxyClient.ts` → CLIProxyAPI.** Never direct to a provider.
- **SSE events are scoped per topic** via an in-memory subscriber map. No cross-topic leakage.
- **Prompts are Markdown templates** loaded and cached by `promptLoader.ts` with `{var}` substitution.
- **Pipeline is resumable** via checkpoint JSON files. Completed stages are skipped on restart.
- **Model configuration cascades:** global defaults → per-topic overrides → per-agent overrides.
