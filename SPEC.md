# Dana — Specification Document
**Version:** 0.5 | **Date:** 2026-03-22

---

## Changelog

| Version | Date | Changes |
|---|---|---|
| 0.1 | 2026-03-22 | Initial spec |
| 0.2 | 2026-03-22 | Bun/Elysia runtime; live forum conversation UI; versioned knowledge states with incremental forum updates |
| 0.3 | 2026-03-22 | Task-based model assignment (Haiku/Sonnet/Opus per task type) with per-topic settings; GitHub Pages static export per version |
| 0.4 | 2026-03-22 | Tool-pull context model (agents fetch on demand via tools, not full context dumps); dynamic context injection pattern; artifact file outputs per agent; ClueProcessor merges BiasCorrector+SourceSummarizer; expert isolation via structured scenario summary; per-topic write queue |
| 0.5 | 2026-03-22 | Citation chain collapse rule: independent source count based on origin_source, not outlet count; origin_source field added to clue schema and ClueProcessor output; weight challenge acceptance rule defined; contested clue classification moved to ForumOrchestrator write time |

---

## Table of Contents

1. [Vision & Purpose](#1-vision--purpose)
2. [Core Concepts](#2-core-concepts)
3. [System Architecture](#3-system-architecture)
4. [Data Models](#4-data-models)
5. [Knowledge State & Versioning](#5-knowledge-state--versioning)
6. [Processing Pipeline](#6-processing-pipeline)
7. [LLM Agent Design](#7-llm-agent-design)
8. [Tool System](#8-tool-system)
9. [Web Application](#9-web-application)
10. [Storage & File Layout](#10-storage--file-layout)
11. [Topic Lifecycle](#11-topic-lifecycle)
12. [Bias Correction & Reasoning Protocol](#12-bias-correction--reasoning-protocol)
13. [Build Roadmap](#13-build-roadmap)
14. [GitHub Pages Static Export](#14-github-pages-static-export)
14. [GitHub Pages Static Export](#14-github-pages-static-export)

---

## 1. Vision & Purpose

**Dana** is an AI-assisted geopolitical and scenario analysis platform. Given any complex real-world event or question, Dana:

- Automatically identifies and profiles all involved parties and their relationships
- Gathers and bias-corrects raw information into structured clues
- Runs a structured adversarial forum where each party is argued for by an objective representative
- Convenes a multi-disciplinary expert council that synthesizes arguments into ranked probable scenarios
- Outputs a final verdict with probability estimates, indicators to watch, and future trajectory analysis
- **Tracks knowledge over time**: as new clues arrive or events unfold, the analysis updates incrementally without losing the prior reasoning record

The design philosophy is **structured epistemic discipline**: every conclusion is traceable to specific clues and arguments; every argument is stress-tested by counter-parties; every expert opinion is grounded in historic references and domain knowledge. The goal is not to be "right" but to be maximally well-reasoned given available evidence.

---

## 2. Core Concepts

### 2.1 Topic

A **Topic** is the root unit of analysis. It is a natural-language question or event description entered by the user.

Example: *"IRI regime collapse and formation of a new Iranian state after uprising and current war"*

Each topic:
- Has its own isolated folder in the data directory
- Progresses through a defined lifecycle (see §11)
- Maintains a **versioned history of knowledge states** (see §5)
- Produces a **Verdict Report** per knowledge state version

---

### 2.2 Involved Party

An **Involved Party** is any actor (state, organization, individual, movement, media entity, alliance) that materially influences the topic's outcome.

Key attributes:
- **Identity**: name, type (state / non-state / individual / media / economic), description
- **Weight**: a calculated influence score (0–100) based on resources at hand
- **Agenda**: their stated or inferred goal with respect to the topic
- **Means**: the levers of power they can deploy (military, economic, informational, diplomatic, social)
- **Circle**: the network around the party
  - *Visible circle*: publicly known allies, media outlets, proxies, sponsors
  - *Shadow circle*: inferred or documented hidden actors pushing in their favor
- **Stance**: their current observable posture (active, passive, covert, overt)
- **Vulnerabilities**: known weak points (internal divisions, resource constraints, legitimacy problems)

Parties are auto-discovered by the LLM during initial topic analysis and can be manually added, edited, or removed by the user.

---

### 2.3 Clue

A **Clue** is a unit of evidence — a fact, event, document, statement, statistic, or pattern — that is relevant to the topic.

Clues go through a **bias correction pipeline** before being used in reasoning:
1. Raw source is retrieved and stored
2. Source credibility is assessed (provenance, track record, political leaning)
3. Bias flags are applied (pro-party X, state media, unverified, secondary source, etc.)
4. A bias-corrected summary is written
5. Relevance score (0–100) to the topic is computed
6. The clue is tagged by party relevance, timeline position, and domain

A clue can be:
- **Auto-gathered** (via web search, HTTP fetch, news crawl)
- **User-submitted** (manually entered or uploaded)
- **Derived** (synthesized by the LLM from multiple raw clues)

**Clues are versioned.** Every change to a clue's content creates a new version entry. Adding a new clue or updating an existing one increments the topic's **knowledge state version** and flags the analysis as stale, prompting the user to run an incremental update (see §5).

---

### 2.4 Representative

Each Involved Party has exactly one **Representative** — an LLM agent persona configured to argue in favor of that party.

Critical design constraint: Representatives are **advocates, not propagandists**. They:
- Argue using only clues and logical inference — no fabrication
- Acknowledge the strongest counter-arguments against their party before refuting them
- Operate under a **Steelman Protocol**: they present their party's case in its strongest possible form
- Cannot suppress or ignore clues that harm their party — they must address them
- On incremental updates: receive a **briefing** of the prior forum summary and produce only a **position delta** (what changed, what stands, what they now argue differently)

This adversarial-but-honest design surfaces real tensions rather than letting bias hide in unchallenged assertion.

---

### 2.5 Forum

The **General Forum** is the structured debate session where all Representatives speak.

Forum mechanics:
- Speaking order is weighted by party **Weight × Clue Relevance** for each round
- Each representative gets a **Statement**, a **Rebuttal**, and a **Closing**
- The forum produces a **Scenario List**: a set of possible outcomes with arguments for why each might occur
- Scenarios are tagged with which parties benefit, which clues support them, and what conditions would need to be true

**Forum as live conversation**: The forum is rendered in the UI as a real-time debate thread — each representative turn appears as a speech bubble with the representative's identity, cited clues as inline links, and round separators. It streams live during generation and can be replayed afterward.

**Incremental forum update**: When new clues exist since the last forum, a delta session runs. Representatives see the previous forum's summary and produce updated positions. The orchestrator determines if scenarios shift or new ones emerge. The original forum is preserved; the update is appended as a new session with a diff view.

---

### 2.6 Expert Council

The **Expert Council** is an overarching analytical body composed of domain expert personas.

Unlike representatives, experts have no party allegiance. Their role is to:
- Cross-examine the forum output
- Bring in historic analogues and precedent
- Apply domain-specific lenses (geopolitics, psychology, economics, military theory, sociology, legal frameworks, etc.)
- Identify logical weak points and unsupported claims in each scenario
- Assign **probability estimates** to each scenario
- Produce **indicator lists**: what observable events in the near future would confirm or disconfirm each scenario
- Deliver the **Final Verdict**

Expert personas are auto-generated to match the topic's domain profile. The user can add, remove, or configure expert personas manually.

Default expert pool structure:
- Geopolitical Analyst
- Historian (specialization matched to region/era)
- Psychologist / Behavioral Analyst
- Economist / Resource Analyst
- Military / Security Expert
- Sociologist / Cultural Analyst
- Legal / Constitutional Expert (when relevant)
- Media & Information Warfare Expert

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Web Frontend (React + Vite)                   │
│  Dashboard │ Party Editor │ Clue Manager │ Forum Conversation View  │
│  Expert Council View │ Verdict Report │ Version Timeline │ Diff View│
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTP / SSE
┌────────────────────────────▼────────────────────────────────────────┐
│                     Backend API (Bun + Elysia)                      │
│                                                                     │
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────────────┐  │
│  │  Topic Mgr   │  │  Pipeline Orch  │  │  State / Version Mgr │  │
│  └──────┬───────┘  └────────┬────────┘  └──────────────────────┘  │
│         │                   │                                       │
│  ┌──────▼───────────────────▼──────────────────────────────────┐   │
│  │                    Agent Engine                              │   │
│  │                                                             │   │
│  │  DiscoveryAgent │ EnrichmentAgent │ RepresentativeAgent(N)  │   │
│  │  ForumOrchestrator │ ExpertAgent(M) │ VerdictSynthesizer    │   │
│  │  DeltaForumAgent │ DevilsAdvocate                           │   │
│  └──────────────────────────┬───────────────────────────────---┘   │
│                             │                                       │
│  ┌──────────────────────────▼─────────────────────────────────┐    │
│  │                    Tool Layer                               │    │
│  │  WebSearch │ HttpFetch │ ClueProcessor │ TimelineLookup     │    │
│  └──────────────────────────┬───────────────────────────────--┘    │
│                             │                                       │
│  ┌──────────────────────────▼─────────────────────────────────┐    │
│  │              LLM Proxy Client                               │    │
│  │   local claudeapiproxy (OpenAI-compatible /v1/* API)       │    │
│  │   retry policy · per-model rate limiting · direct fallback │    │
│  └──────────────────────────┬───────────────────────────────--┘    │
└────────────────────────────-│───────────────────────────────────────┘
                             │
              ┌──────────────▼──────────────┐
              │   Data Layer (JSON / FS)    │
              │  /data/topics/<topic-id>/   │
              └─────────────────────────────┘
```

### Why Bun?

Bun replaces Node.js as the runtime for all non-frontend code:

| Concern | Node.js | Bun |
|---|---|---|
| HTTP throughput | baseline | ~3–4× faster (native HTTP) |
| File I/O | good | faster (uses system calls directly) |
| Startup time | ~100–300ms | ~5–10ms |
| TypeScript | needs transpile step | native, zero config |
| Package install | npm: slow | bun install: ~30× faster |
| Test runner | jest/vitest | built-in `bun test` |
| SQLite (future) | better-sqlite3 | `bun:sqlite` built-in |

**Elysia** is the Bun-native HTTP framework: ergonomic, type-safe, fast, with built-in SSE and WebSocket support.

---

## 4. Data Models

All data is stored as JSON files under `/data/topics/<topic-slug>/`.

### 4.1 `topic.json`
```jsonc
{
  "id": "iri-collapse-2026",
  "title": "IRI regime collapse and formation of a new Iranian state",
  "description": "Full user-entered description",
  "created_at": "2026-03-22T10:00:00Z",
  "status": "expert_council",
  // draft | discovery | clue_gathering | forum | expert_council | verdict | complete | stale
  // "stale" = analysis complete but new clues exist — awaiting user-triggered update
  "current_version": 3,
  "models": {
    // Each key is a task category. Values come from the available model list
    // fetched live from the local claudeapiproxy at startup.
    "data_gathering":    "claude-haiku-4-5",    // web_search, http_fetch, cache lookups
    "extraction":        "claude-haiku-4-5",    // clue_processor (single-pass extraction + bias correction)
    "enrichment":        "claude-sonnet-4-6",   // EnrichmentAgent, WeightCalculator, DiscoveryAgent
    "delta_updates":     "claude-sonnet-4-6",   // DeltaRepresentativeAgent, delta expert review
    "forum_reasoning":   "claude-opus-4-6",     // RepresentativeAgent, ForumOrchestrator, DevilsAdvocate
    "expert_council":    "claude-opus-4-6",     // ExpertAgent, cross-deliberation
    "verdict":           "claude-opus-4-6"      // VerdictSynthesizer
  },
  "settings": {
    "auto_discover_parties": true,
    "auto_gather_clues": true,
    "clue_search_depth": 3,
    "forum_rounds": 3,
    "expert_count": 6,
    "language": "en",
    "auto_refresh_clues": false,  // if true, clues refresh automatically on schedule
    "refresh_interval_hours": 24
  }
}
```

### 4.2 `parties.json`
```jsonc
[
  {
    "id": "irgc",
    "name": "Islamic Revolutionary Guard Corps",
    "type": "state_military",
    "description": "...",
    "weight": 87,
    "weight_factors": {
      "military_capacity": 90,
      "economic_control": 75,
      "information_control": 70,
      "international_support": 40,
      "internal_legitimacy": 35
    },
    "agenda": "Preserve the Islamic Republic and IRGC's dominant role",
    "means": ["military force", "economic leverage via bonyads", "proxy networks", "intelligence apparatus"],
    "circle": {
      "visible": ["Basij militia", "state TV IRIB", "Ansar Hezbollah"],
      "shadow": ["Russian FSB coordination", "Venezuelan PDVSA financial channels"]
    },
    "stance": "defensive_active",
    "vulnerabilities": ["fuel subsidy dependency", "officer corps loyalty fractures", "sanctions-degraded equipment"],
    "auto_discovered": true,
    "user_verified": false
  }
]
```

### 4.3 `clues.json`

Each clue carries its full version history inline. The `current` field always points to the latest version.

```jsonc
[
  {
    "id": "clue-001",
    "current": 2,
    "added_at": "2026-03-20T12:00:00Z",
    "last_updated_at": "2026-03-22T09:00:00Z",
    "added_by": "auto",       // auto | user
    "versions": [
      {
        "v": 1,
        "date": "2026-03-20T12:00:00Z",
        "title": "IRGC commander replaced following Sistan protests",
        "raw_source": {
          "url": "https://...",
          "fetched_at": "2026-03-20T12:00:00Z",
          "raw_text_file": "sources/raw/clue-001-v1.txt"
          // raw text stored separately to keep clues.json lean
        },
        "source_credibility": {
          "score": 72,
          "notes": "Independent news outlet, minor pro-opposition lean, cross-referenced with Reuters",
          "bias_flags": ["mild_opposition_lean"],
          "origin_source": {
            "url": "https://axios.com/...",   // first publisher of this claim; may equal raw_source.url if not a republication
            "outlet": "Axios",
            "is_republication": false          // true if raw_source is citing/attributing origin_source
          }
        },
        "bias_corrected_summary": "A senior IRGC regional commander was replaced in Sistan-Baluchestan province in February 2026. Multiple independent sources confirm; motivations remain officially unstated.",
        "relevance_score": 85,
        "party_relevance": ["irgc", "opposition_movement"],
        "domain_tags": ["military", "internal_security"],
        "timeline_date": "2026-02-15",
        "clue_type": "event",
        "change_note": "Initial version"
      },
      {
        "v": 2,
        "date": "2026-03-22T09:00:00Z",
        "title": "IRGC commander replaced — follow-up: replaced officer defected",
        "raw_source": {
          "url": "https://...",
          "fetched_at": "2026-03-22T09:00:00Z",
          "raw_text_file": "sources/raw/clue-001-v2.txt"
        },
        "source_credibility": {
          "score": 68,
          "notes": "Opposition media; single source; unconfirmed by state media",
          "bias_flags": ["opposition_media", "unverified"]
        },
        "bias_corrected_summary": "Reports (unconfirmed) suggest the replaced commander subsequently left Iran. If confirmed, this would indicate a significant loyalty fracture in IRGC officer corps.",
        "relevance_score": 92,
        "party_relevance": ["irgc"],
        "domain_tags": ["military", "internal_security", "defection"],
        "timeline_date": "2026-03-18",
        "clue_type": "event",
        "change_note": "New information: possible defection. Updated title, summary, relevance score, bias flags."
      }
    ],
    "status": "verified"  // raw | processing | verified | disputed
  }
]
```

### 4.4 `states.json`

The knowledge state ledger. Each entry is a snapshot of what was known at a point in time and which analysis artifacts belong to it.

```jsonc
[
  {
    "version": 1,
    "label": "Initial analysis",
    "created_at": "2026-03-20T14:00:00Z",
    "trigger": "initial_run",   // initial_run | user_add_clue | user_edit_clue | auto_refresh | user_manual
    "clue_snapshot": {
      "count": 23,
      "ids_and_versions": { "clue-001": 1, "clue-002": 1 }
      // full snapshot: which clue version was active
    },
    "forum_session_id": "forum-session-v1",
    "verdict_id": "verdict-v1",
    "delta_from": null,
    "delta_summary": null
  },
  {
    "version": 2,
    "label": "Clue update: IRGC defection report",
    "created_at": "2026-03-22T09:00:00Z",
    "trigger": "user_edit_clue",
    "clue_snapshot": {
      "count": 24,
      "ids_and_versions": { "clue-001": 2, "clue-002": 1, "clue-024": 1 }
    },
    "forum_session_id": "forum-session-v2",
    "verdict_id": "verdict-v2",
    "delta_from": 1,
    "delta_summary": {
      "new_clues": ["clue-024"],
      "updated_clues": ["clue-001"],
      "affected_parties": ["irgc"],
      "key_change": "Possible IRGC officer defection — updates military stability assessment"
    }
  }
]
```

### 4.5 `representatives.json`
```jsonc
[
  {
    "id": "rep-irgc",
    "party_id": "irgc",
    "persona_prompt": "You are the advocate for the Islamic Revolutionary Guard Corps in this analysis. Your role is to present the strongest reasoned case for the IRGC's position and likely actions, using only verified clues and logical inference. You must acknowledge the strongest arguments against your party before addressing them. You are objective in method, though partisan in focus.",
    "speaking_weight": 87,
    "auto_generated": true
  }
]
```

### 4.6 Forum Session Files

Forum sessions are stored as separate files per version: `forum_session_v1.json`, `forum_session_v2.json`, etc.

```jsonc
// forum_session_v1.json  (full forum)
{
  "session_id": "forum-session-v1",
  "version": 1,
  "type": "full",          // full | delta
  "delta_from_session": null,
  "started_at": "2026-03-20T14:00:00Z",
  "completed_at": "2026-03-20T14:47:00Z",
  "status": "complete",    // running | complete | error
  "rounds": [
    {
      "round": 1,
      "type": "opening_statements",
      "turns": [
        {
          "id": "turn-001",
          "representative_id": "rep-irgc",
          "party_name": "IRGC",
          "party_color": "#8B0000",  // for UI rendering
          "statement": "The Islamic Revolutionary Guard Corps...",
          "clues_cited": ["clue-001", "clue-007"],
          "timestamp": "2026-03-20T14:03:00Z",
          "word_count": 342
        }
      ]
    },
    {
      "round": 2,
      "type": "rebuttals",
      "turns": [ "..." ]
    },
    {
      "round": 3,
      "type": "closings_and_scenarios",
      "turns": [ "..." ]
    }
  ],
  "scenarios": [
    {
      "id": "scenario-a",
      "title": "Controlled transition via elite split",
      "description": "...",
      "proposed_by": "rep-opposition",
      "supported_by": ["rep-usa", "rep-eu"],
      "contested_by": ["rep-irgc", "rep-russia"],
      "clues_cited": ["clue-001", "clue-012"],
      "benefiting_parties": ["moderate_clergy", "reformist_faction"],
      "required_conditions": [
        "IRGC fracture along Sepah/Basij lines",
        "External guarantees for senior officers"
      ],
      "falsification_conditions": [
        "IRGC conducts coordinated nationwide crackdown without internal resistance",
        "Supreme leader designates successor within IRGC"
      ]
    }
  ]
}

// forum_session_v2.json  (delta update)
{
  "session_id": "forum-session-v2",
  "version": 2,
  "type": "delta",
  "delta_from_session": "forum-session-v1",
  "started_at": "2026-03-22T10:00:00Z",
  "completed_at": "2026-03-22T10:18:00Z",
  "status": "complete",
  "context": {
    "prior_forum_summary": "In the v1 forum, representatives debated three main scenarios...",
    "new_clues": ["clue-024"],
    "updated_clues": ["clue-001"],
    "change_significance": "The possible defection of a senior IRGC officer, if confirmed, materially weakens the stability argument for scenario-c."
  },
  "delta_turns": [
    {
      "id": "delta-turn-001",
      "representative_id": "rep-irgc",
      "type": "position_update",
      "prior_position_summary": "IRGC maintains cohesion...",
      "updated_position": "The unconfirmed defection report, while requiring verification, introduces a potential fracture point. The IRGC's formal response has been silence, which is itself informative...",
      "position_delta": "downgrade_confidence",  // upgraded | downgraded | unchanged | new_argument
      "clues_cited": ["clue-001@v2", "clue-024"],
      "timestamp": "2026-03-22T10:05:00Z"
    }
  ],
  "scenario_updates": [
    {
      "scenario_id": "scenario-a",
      "update_type": "strengthened",  // strengthened | weakened | unchanged | new | removed
      "reason": "New defection report provides supporting evidence for elite fracture hypothesis",
      "updated_required_conditions": [ "..." ]
    },
    {
      "scenario_id": "scenario-c",
      "update_type": "weakened",
      "reason": "...",
      "updated_required_conditions": [ "..." ]
    }
  ]
}
```

### 4.7 Expert Council Files

Per version: `expert_council_v1.json`, `expert_council_v2.json`, etc.

```jsonc
{
  "version": 1,
  "verdict_id": "verdict-v1",
  "experts": [
    {
      "id": "exp-geopolitics",
      "name": "Geopolitical Analyst",
      "persona_prompt": "...",
      "domain": "geopolitics",
      "auto_generated": true
    }
  ],
  "deliberations": [
    {
      "expert_id": "exp-geopolitics",
      "scenario_assessments": [
        {
          "scenario_id": "scenario-a",
          "assessment": "...",
          "historic_analogues": ["Iran 1979", "Romania 1989", "Soviet collapse 1991"],
          "weak_points_identified": ["..."],
          "probability_contribution": 0.28
        }
      ],
      "cross_deliberation_response": "..."
    }
  ],
  "final_verdict": {
    "synthesized_at": "2026-03-20T16:00:00Z",
    "scenarios_ranked": [
      {
        "scenario_id": "scenario-a",
        "probability": 0.34,
        "confidence": "medium",
        "key_drivers": ["..."],
        "watch_indicators": [
          "IRGC public loyalty statements decline",
          "Clerical establishment distancing from supreme leader",
          "Significant urban middle-class protest re-emergence"
        ],
        "near_future_trajectories": {
          "90_days": "...",
          "6_months": "...",
          "1_year": "..."
        }
      }
    ],
    "final_assessment": "...",
    "confidence_note": "..."
  }
}
```

---

## 5. Knowledge State & Versioning

This is one of Dana's core differentiators: the analysis is not a one-shot output but a **living document** that evolves as new information arrives.

### 5.1 What Triggers a New State

A new knowledge state version is created whenever:

| Trigger | Type | Auto or Manual |
|---|---|---|
| Initial analysis completes | `initial_run` | auto |
| User adds a new clue | `user_add_clue` | manual |
| User edits an existing clue | `user_edit_clue` | manual |
| Automatic clue refresh detects changed sources | `auto_refresh` | auto (if enabled) |
| User manually triggers "Refresh Clues" | `user_manual` | manual |

**Adding or editing a clue does NOT immediately run a new analysis.** Instead, the topic status transitions to `stale` and the UI shows a notification banner.

### 5.2 Staleness Banner

When a topic is `stale`, the UI shows:

```
┌──────────────────────────────────────────────────────────────────┐
│ 2 new clues and 1 updated clue since last analysis (v1, Mar 20) │
│ Key change: possible IRGC officer defection                      │
│                                          [View Changes] [Update] │
└──────────────────────────────────────────────────────────────────┘
```

"View Changes" opens a diff view of what clues changed and what their bias-corrected summaries say. "Update" triggers the incremental update pipeline.

### 5.3 Incremental Update Pipeline

The update does NOT re-run the full pipeline. It runs a targeted delta:

```
Step 1: CLUE DELTA SUMMARY
  - Identify new and changed clues since last version
  - Generate a brief "what changed" narrative for agent context

Step 2: DELTA FORUM SESSION
  - Each representative receives:
      [prior forum summary (condensed)]
      [new/changed clues with bias-corrected summaries]
      [instruction: update your position — what stands, what changes, why]
  - Representatives produce position_update turns (shorter than original statements)
  - ForumOrchestrator synthesizes scenario_updates: which scenarios strengthen/weaken/new/removed

Step 3: DELTA EXPERT REVIEW
  - Each expert receives:
      [prior verdict summary]
      [delta forum output]
      [instruction: revise probability estimates based on new information]
  - Experts produce updated probability estimates with delta reasoning

Step 4: VERDICT UPDATE
  - VerdictSynthesizer produces updated verdict incorporating deltas
  - Watch indicators list is updated/extended
  - New version saved to states.json
```

This makes update sessions fast (a fraction of the initial run cost) because agents only need to reason about what changed, not re-argue everything from scratch.

### 5.4 Version Navigation in UI

The Topic View header always shows the current version and a version picker:

```
[Topic: IRI Collapse]  v3 ▼  [compared to: v2 ▼]  [← Previous]  [Update Now]
```

In version compare mode, the UI shows a side-by-side or inline diff:
- Clue changes (new, updated, removed)
- Scenario probability changes (with delta arrows: +8%, -12%, etc.)
- New watch indicators
- Representative position deltas (what they changed their mind about and why)

### 5.5 Clue Versioning Details

When a clue is updated:
- The old version data is preserved in `versions[]`
- `current` pointer is incremented
- References to a clue in forum sessions use `clue-id@version` notation for historical accuracy (e.g., `clue-001@v1` in the v1 forum, `clue-001@v2` in the v2 forum)
- The UI shows a version tag on clue cards with a "History" button to view all past versions

---

## 6. Processing Pipeline

### 6.1 Initial Pipeline (6 Stages)

```
Stage 1: DISCOVERY
  Input:  topic.json
  Output: parties.json (initial), clues.json (seed clues), states.json (v0 marker)
  Agent:  DiscoveryAgent
  - LLM reads topic, generates initial party list with weight estimates
  - Generates initial search queries for clue gathering
  - Searches execute, top-level clues seeded

Stage 2: ENRICHMENT
  Input:  parties.json (initial)
  Output: parties.json (enriched), clues.json (expanded, bias-corrected)
  Agent:  EnrichmentAgent
  - For each party: fetch detailed profiles, verify means, map circles
  - Timeline construction: order existing clues chronologically
  - Additional targeted searches per party
  - Bias correction pipeline runs on all clues

Stage 3: WEIGHT CALCULATION
  Input:  parties.json (enriched), clues.json (verified)
  Output: parties.json (weighted), representatives.json
  Agent:  WeightCalculator
  - LLM scores each party on 5 weight dimensions
  - Speaking weights computed for forum ordering
  - Representative personas auto-generated

Stage 4: GENERAL FORUM
  Input:  parties.json (weighted), clues.json (index), representatives.json
  Output: forum_session_v<N>.json, logs/run-<id>/representative_<party>_r<N>.json (per rep per round)
  Agent:  ForumOrchestrator + RepresentativeAgents
  - Each RepresentativeAgent receives: lean context snapshot (party index + clue index + injected role prompt)
  - Representatives pull full clue detail via get_clue, prior turns via get_prior_turns as needed
  - Each representative writes turn artifact via write_artifact before next rep begins
  - ForumOrchestrator reads completed turn artifacts via read_artifact to sequence rounds
  - Round 1: Opening statements (weighted order)
  - Round 2: Rebuttals — each rep calls get_prior_turns(round=1) to read others before responding
  - Round 3: Closings + scenario proposals
  - Devil's Advocate pass: reads scenario list via get_scenario_list, stress-tests leading scenario
  - ForumOrchestrator reads all round artifacts and writes consolidated forum_session_v<N>.json
  - ForumOrchestrator computes contested/uncontested clue classification and writes pre-computed scenario_summary field into forum_session_v<N>.json — this is the only point where this classification is made
  - All turns stream to UI in real-time via SSE as artifact writes complete

Stage 5: EXPERT COUNCIL
  Input:  forum_session_v<N>.json (structured summary only), clues.json (index), parties.json
  Output: expert_council_v<N>.json (deliberations), logs/run-<id>/expert_<domain>.json (per expert)
  Agent:  ExpertAgents (parallel, isolated subagents)
  - Each expert receives: lean context snapshot + structured scenario summary via get_scenario_summary
  - Experts do NOT receive raw forum transcript — only scenario definitions + contested/uncontested clue lists
  - Experts pull full clue detail via get_clue for any clue they wish to assess
  - Experts can trigger additional web searches for historic analogues
  - Each expert writes artifact via write_artifact (includes scenario assessments + weight_challenges)
  - Cross-expert deliberation round: experts read each other's artifacts via read_artifact
  - VerdictSynthesizer reads all expert artifacts and applies accepted weight_challenges

Stage 6: VERDICT SYNTHESIS
  Input:  expert_council_v<N>.json (deliberations)
  Output: expert_council_v<N>.json (final_verdict), states.json (v1 entry)
  Agent:  VerdictSynthesizer
  - Aggregates expert probability contributions
  - Writes final narrative assessment
  - Compiles watch indicator list
  - Produces timeline trajectories
  - Commits state v1 to states.json
  - Sets topic status to "complete"
```

### 6.2 Incremental Update Pipeline (4 Steps)

Triggered when topic status is `stale` and user clicks Update:

```
Step 1: CLUE DELTA SUMMARY
  Input:  states.json (last version), clues.json (current)
  Output: delta_context object (in memory)
  - Diff current clue versions against last state snapshot
  - Generate change narrative for agent briefings

Step 2: DELTA FORUM SESSION
  Input:  delta_context, representatives.json
  Output: forum_session_v<N+1>.json (type: delta), logs/run-<id>/delta_representative_<party>.json (per rep)
  Agent:  DeltaRepresentativeAgents + ForumOrchestrator
  - Each DeltaRepresentativeAgent receives: lean context snapshot + delta_context summary
  - Agent calls get_prior_turns to read its own prior position, get_clue for new/updated clues
  - Writes position_update artifact via write_artifact
  - ForumOrchestrator reads all delta artifacts via read_artifact, writes scenario_updates

Step 3: DELTA EXPERT REVIEW
  Input:  delta forum session (structured scenario update summary), clues.json (index)
  Output: expert_council_v<N+1>.json (partial — delta only), logs/run-<id>/delta_expert_<domain>.json
  Agent:  ExpertAgents (parallel, isolated)
  - Each expert receives: prior verdict summary + scenario update summary (not raw delta forum)
  - Expert pulls updated clue versions via get_clue as needed
  - Writes revised probability estimate artifact via write_artifact

Step 4: VERDICT UPDATE
  Input:  all delta outputs
  Output: expert_council_v<N+1>.json (updated verdict), states.json (new version)
  Agent:  VerdictSynthesizer
  - Merges prior verdict with deltas
  - Sets topic status back to "complete"
```

---

## 7. LLM Agent Design

All agents share a common base structure and communicate through the local claude API proxy.

### 7.1 Agent Base Contract

Every agent receives:
- **System prompt**: static base (role, constraints, output format) + **dynamically injected context snapshot** at call time
- **Tool access**: narrow subset of tools appropriate to that agent's role — agents pull full data on demand, they are not pre-loaded with it
- **Output contract**: agent writes a structured artifact JSON file; orchestrator reads it — no inline context accumulation

Every agent must:
1. Reason step-by-step before producing output (Chain-of-Thought in system prompt)
2. Cite clue IDs (with version) for every factual claim
3. Assign a self-assessed confidence level to each conclusion
4. Flag any gaps in evidence that affected its reasoning

### 7.2 Dynamic Context Injection

Context is injected at call time via a `buildAgentContext()` function, not stored statically. The injected snapshot is deliberately lean — agents pull full detail via tools when they need it.

```typescript
// backend/src/agents/contextBuilder.ts

interface AgentContextSnapshot {
  current_version: number
  party_index: { id: string; name: string; weight: number }[]   // index only — no full profiles
  clue_index: { id: string; title: string; timeline_date: string; party_relevance: string[] }[]  // titles only
  forum_summary?: string    // condensed paragraph, not full transcript
  prior_verdict_summary?: string
}

function buildAgentContext(agentType: AgentType, topicId: string): AgentContextSnapshot {
  return {
    current_version: stateManager.getCurrentVersion(topicId),
    party_index: partyStore.getIndex(topicId),          // ~10 tokens per party
    clue_index: clueStore.getIndex(topicId),            // ~15 tokens per clue
    forum_summary: agentType !== 'forum' 
      ? forumStore.getCondensedSummary(topicId)         // ~200 tokens total
      : undefined,
    prior_verdict_summary: agentType === 'delta'
      ? verdictStore.getSummary(topicId)
      : undefined,
  }
}
```

**Key principle**: The clue index costs ~15 tokens per clue. An agent that needs 5 clues fetches them via `get_clue` — paying for only those 5 in full, not all 30. This mirrors how a good engineer reads code: `Grep` and `Read` specific files rather than loading the entire repo into context.

### 7.3 Artifact File Outputs

Every agent writes a structured JSON artifact file instead of returning data inline to the orchestrator. The orchestrator reads artifact files via `read_artifact`. This eliminates context accumulation across agent calls.

```
logs/run-<run-id>/
  discovery_output.json
  enrichment_output.json
  weight_calculation.json
  representative_<party-id>_r<round>.json    ← one file per rep per round
  forum_orchestrator_r<round>.json
  expert_<domain>.json                        ← one file per expert
  verdict_synthesis.json
  delta_representative_<party-id>.json
  delta_expert_<domain>.json
  delta_verdict.json
```

ForumOrchestrator does not receive all representative outputs as context — it calls `read_artifact("representative_irgc_r1")`, `read_artifact("representative_opposition_r1")`, etc. and reads them sequentially. The orchestrator's context at synthesis time is: its own artifact reader calls + the scenario consolidation it is currently writing.

### 7.4 Agent Definitions

| Agent | Role | Task Category | Default Model | Tools | Key Constraints |
|---|---|---|---|---|---|
| `DiscoveryAgent` | Identify parties and seed clues | `enrichment` | Sonnet | WebSearch, HttpFetch, WriteArtifact | Must generate ≥5 parties; no assumed facts |
| `EnrichmentAgent` | Deepen profiles, expand clues | `enrichment` | Sonnet | WebSearch, HttpFetch, TimelineLookup, GetClue, WriteArtifact | Runs ClueProcessor on every clue |
| `ClueProcessor` | Extract + bias-correct a single clue from raw HTML | `extraction` | Haiku | none | Single-pass: extraction + bias correction together; no invention |
| `WeightCalculator` | Score party influence | `enrichment` | Sonnet | GetPartyProfile, WriteArtifact | Must show working per dimension |
| `RepresentativeAgent` | Argue for one party | `forum_reasoning` | Opus | GetClue, GetPartyProfile, GetPriorTurns, GetScenarioList, WriteArtifact | Steelman; cite clues; acknowledge counter-evidence |
| `DeltaRepresentativeAgent` | Update position given new clues | `delta_updates` | Sonnet | GetClue, GetPriorTurns, ReadArtifact, WriteArtifact | Must reference prior position; explain what changed and why |
| `ForumOrchestrator` | Sequence forum, synthesize scenarios | `forum_reasoning` | Opus | ReadArtifact, WriteArtifact | Reads rep artifacts; deduplicates scenarios; all parties addressed |
| `DevilsAdvocate` | Stress-test leading scenario | `forum_reasoning` | Opus | GetClue, GetScenarioList, WriteArtifact | Must produce ≥3 genuine falsification arguments |
| `ExpertAgent` | Domain analysis, probabilities | `expert_council` | Opus | GetClue, GetScenarioSummary, WebSearch, HttpFetch, WriteArtifact | Receives scenario list + clue index only — not raw forum; must cite historic analogues |
| `VerdictSynthesizer` | Final report | `verdict` | Opus | ReadArtifact, WriteArtifact | Reads all expert artifacts; probabilities sum ≤1.0; applies weight challenges |

### 7.5 Expert Isolation

Experts receive a **structured scenario summary**, not the raw forum transcript. This prevents anchoring on representative rhetoric.

The scenario summary is computed and written by `ForumOrchestrator` at the end of Stage 4 — it is a pre-computed field in the forum session file, not derived at read time. This ensures all experts see an identical, stable snapshot regardless of when they call `get_scenario_summary`.

```jsonc
// Stored in forum_session_vN.json by ForumOrchestrator — read by get_scenario_summary
"scenario_summary": {
  "scenarios": [
    {
      "id": "scenario-a",
      "title": "Controlled transition via elite split",
      "key_clues": ["clue-001", "clue-012"],
      "required_conditions": ["IRGC fracture along Sepah/Basij lines"],
      "falsification_conditions": ["IRGC conducts coordinated crackdown without internal resistance"]
    }
  ],
  "contested_clues": [
    {
      "clue_id": "clue-001",
      "cited_by": ["rep-irgc", "rep-opposition"],
      "conflict": "IRGC rep cited as evidence of stability; opposition rep cited as evidence of fracture"
    }
  ],
  "uncontested_clues": ["clue-007", "clue-019"]
}
```

**Contested clue definition**: A clue is contested if it was cited by ≥2 different parties **with conflicting interpretations** in the forum session. ForumOrchestrator determines this when consolidating scenarios after Round 3 — it is the only agent with full visibility of how each party used each clue across all turns. `get_scenario_summary` simply reads the pre-computed `scenario_summary` field; it performs no classification logic.

The expert then uses `get_clue` to read the full detail of any clue they want to assess. They derive probabilities from clues + scenario definitions — not from who argued what in the forum.

**Weight challenges**: Expert artifacts may include a `weight_challenges` array where experts flag party weight scores they consider miscalibrated based on clue evidence. `VerdictSynthesizer` applies challenges according to a defined acceptance rule (see below) and logs every decision in the verdict artifact for traceability.

```jsonc
// expert_geopolitics.json — weight_challenges section
"weight_challenges": [
  {
    "party_id": "irgc",
    "dimension": "economic_control",
    "original_score": 75,
    "suggested_score": 55,
    "reasoning": "Bonyad revenues fell 40% since 2024 sanctions",
    "clues_cited": ["clue-015"]
  }
]
```

**Weight challenge acceptance rule**: A challenge is accepted if:
- ≥2 experts flag the same party + dimension, OR
- 1 expert flags it AND no expert explicitly defends the original score

A challenge is rejected if any expert explicitly argues the original score is correct. VerdictSynthesizer records each challenge decision in `verdict_synthesis.json`:

```jsonc
"weight_challenge_decisions": [
  {
    "party_id": "irgc",
    "dimension": "economic_control",
    "original_score": 75,
    "applied_score": 55,
    "status": "accepted",       // accepted | rejected
    "reason": "2 experts flagged (exp-economics, exp-geopolitics); none defended original",
    "flagged_by": ["exp-economics", "exp-geopolitics"],
    "defended_by": []
  }
]
```

This makes weight adjustments fully traceable in the final report.

### 7.6 Anti-Bias Mechanisms

1. **Devil's Advocate Pass**: Before forum closes, dedicated agent attempts to falsify the most probable scenario
2. **Source Diversity Check**: No single **origin source** or political viewpoint accounts for >30% of clue weight. Outlet count is irrelevant — diversity is measured by distinct `origin_source` values. A claim reported by 10 outlets all tracing back to one wire report counts as 1 origin source.
3. **Steelman Protocol**: Every representative articulates the strongest opposing view before refuting it
4. **Expert Isolation**: Experts receive a structured scenario summary, not raw forum arguments — preventing anchoring on representative rhetoric
5. **Weight Challenges**: Experts can formally challenge party weight scores with clue-backed reasoning
6. **Confidence Calibration**: Probability estimates flagged if aggregate confidence exceeds what evidence warrants

### 7.7 LLM Proxy Client Resilience

The proxy client (`proxyClient.ts`) is the single point of LLM access. It must be robust since forum sessions are long-running.

```typescript
interface LLMClientConfig {
  primary: { baseUrl: string; type: "proxy" }       // local claudeapiproxy (OpenAI-compatible)
  fallback?: { baseUrl: string; apiKey: string; type: "direct" }  // direct Anthropic API
  retryPolicy: { maxAttempts: 3; backoffMs: [1000, 5000, 15000] }
  timeoutMs: 120_000
}
```

Rate limiting is applied per model tier using a token bucket, since Opus has tighter rate limits than Haiku:

```typescript
const rateLimiters = {
  "claude-opus-4-6":   new TokenBucket({ rps: 2,  burst: 5  }),
  "claude-sonnet-4-6": new TokenBucket({ rps: 5,  burst: 10 }),
  "claude-haiku-4-5":  new TokenBucket({ rps: 20, burst: 40 }),
}
```

The proxy contract is OpenAI-compatible (`/v1/chat/completions`, `/v1/models`), making the direct API a drop-in fallback with no code changes in agents.

---

## 8. Tool System

Tools fall into two categories: **external tools** (web/network access, used by discovery/enrichment agents) and **internal tools** (data access within a topic, used by reasoning agents). Reasoning agents (Representatives, Experts, Orchestrators) only have access to internal tools — they never call the web directly.

### 8.1 External Tools

#### `web_search`
- **Input**: `query: string`, `num_results: number (1-10)`, `date_filter?: string`
- **Implementation**: HTTP request to search endpoint; parse HTML results for titles, snippets, URLs
- **Output**: `[{ title, url, snippet, date }]`

#### `http_fetch`
- **Input**: `url: string`
- **Implementation**: Fetch URL, strip HTML/JS, extract main content body using readability heuristics
- **Output**: `{ url, title, raw_content, fetched_at, cached: boolean }`
- **Caching**: Results cached to `sources/cache/<url-hash>.json`; cache TTL configurable (default 48h)
- **Note**: Returns raw extracted content only. Summarization and bias correction are handled by `ClueProcessor`.

#### `timeline_lookup`
- **Input**: `entity: string`, `event_type: string`, `date_range: { from, to }`
- **Implementation**: Combines web_search with date filters, orders results chronologically
- **Output**: `[{ date, event, source_url, relevance }]`

### 8.2 Internal Tools (Agent Data Access)

These tools give reasoning agents on-demand access to topic data without pre-loading full context. They are the mechanism behind the tool-pull context model (§7.2).

#### `get_clue`
- **Input**: `clue_id: string`, `version?: number` (defaults to current)
- **Implementation**: Read `clues.json`, return full clue object at requested version
- **Output**: full clue object including bias_corrected_summary, source_credibility, bias_flags, versions
- **Usage**: Representatives and Experts call this for each clue they want to cite. They receive the clue index (~15 tokens/clue) upfront and fetch full detail only for clues they actually use.

#### `get_party_profile`
- **Input**: `party_id: string`
- **Implementation**: Read `parties.json`, return full party object
- **Output**: full party object including weight_factors, circle, vulnerabilities

#### `get_prior_turns`
- **Input**: `round?: number`, `party_id?: string`, `session_id?: string`
- **Implementation**: Read forum session file, filter and return matching turns
- **Output**: `[{ id, representative_id, party_name, statement, clues_cited, round, type }]`
- **Usage**: Representatives use this to read what others have said before constructing their own turn. Keeps each agent's context to only the turns they actually need.

#### `get_scenario_list`
- **Input**: `session_id: string`
- **Implementation**: Read forum session file, return scenarios array only
- **Output**: `[{ id, title, required_conditions, falsification_conditions, key_clues }]`
- **Usage**: Used by DevilsAdvocate and ExpertAgents. Experts receive scenario definitions without representative arguments.

#### `get_scenario_summary`
- **Input**: `topic_id: string`, `version: number`
- **Implementation**: Reads the pre-computed `scenario_summary` field from `forum_session_vN.json`. Does NOT compute or classify anything at read time — the summary is written by `ForumOrchestrator` at the end of Stage 4 and is immutable thereafter.
- **Output**: structured scenario summary object (scenarios, contested_clues, uncontested_clues — see §7.5)
- **Usage**: ExpertAgent entry point. All parallel expert subagents read the same pre-computed snapshot; no race condition risk. Ensures experts derive probabilities from clues, not from forum rhetoric.

#### `write_artifact`
- **Input**: `run_id: string`, `artifact_name: string`, `data: object`
- **Implementation**: Write JSON to `logs/run-<run-id>/<artifact_name>.json`; per-topic write queue ensures no concurrent write conflicts
- **Output**: `{ path, written_at }`

#### `read_artifact`
- **Input**: `run_id: string`, `artifact_name: string`
- **Implementation**: Read JSON from `logs/run-<run-id>/<artifact_name>.json`
- **Output**: parsed artifact object

### 8.3 Processing Tools

#### `clue_processor`
- **Input**: `raw_html: string`, `source_url: string`, `topic_context: string`
- **Implementation**: Single LLM call (Haiku) that performs extraction + bias correction in one pass. Replaces the former separate `source_summarize` + `BiasCorrector` pipeline.
- **Output**:
  ```jsonc
  {
    "extracted_content": "...",
    "bias_corrected_summary": "...",
    "bias_flags": ["mild_opposition_lean"],
    "source_credibility_score": 72,
    "credibility_notes": "...",
    "origin_source": {
      "url": "https://...",       // first publisher of the claim; may equal input URL if not a republication
      "outlet": "Axios",
      "is_republication": false   // true if the fetched page is citing/attributing another outlet as origin
    },
    "key_points": ["..."],
    "date_references": ["2026-02-15"],
    "relevance_score": 85
  }
  ```
- **Rationale**: Bias correction has full access to raw content — not a pre-summarized version. One LLM call instead of two. Origin source is identified here so the citation chain collapse rule (§12.1) can be applied at corroboration-check time.

#### `store_clue`
- **Input**: `topic_id`, clue data (conforms to clue schema)
- **Implementation**: Appends to `clues.json` via per-topic write queue; deduplication check (URL + timeline_date)
- **Output**: `{ clue_id, version, status }`

---

## 9. Web Application

### 9.1 Technology Stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Bun | ~3-4× faster I/O and HTTP than Node.js; native TS; built-in tooling |
| Backend framework | Elysia | Bun-native, type-safe, built-in SSE, minimal overhead |
| Frontend framework | React + Vite | Fast dev, component model suits card-based UI |
| Styling | Tailwind CSS | Utility-first, no config needed |
| State management | Zustand | Lightweight, no boilerplate |
| Real-time updates | SSE (Elysia built-in) | Streams pipeline progress and forum turns to UI |
| Data storage | JSON files on filesystem | No DB setup; per-topic isolation |

### 9.2 Page Structure

#### Dashboard (`/`)
- Grid of **Topic Cards**, one per topic
- Card shows: title, status badge, current version, party count, last updated, staleness indicator
- "New Topic" button → topic creation dialog
- Global model selector (default for new topics)

#### Topic View (`/topic/:id`)

**Header bar**:
```
[Topic title]   v3 ▼  [Compared to: v2 ▼]  [← Prev]  [→ Next]  [Update Now ●]
```
- Version picker: drop-down of all states with date and trigger type
- "Compare to" picker enables diff mode across any two versions
- "Update Now" button appears with a dot indicator when topic is stale

**Left sidebar**: stage navigator
`Discovery → Enrichment → Forum → Expert Council → Verdict`

Each panel:

---

**Discovery & Parties Panel**
- Auto-discovered parties as cards
- Card: name, type, weight badge (with breakdown on hover), agenda summary, circle tags
- Circle diagram: visible allies as solid nodes, shadow circle as dashed nodes
- Actions: Edit, Add manually, Remove, Re-run discovery
- Clue count badge per party (clicks filter the Clues panel)

---

**Clues Panel**
- Filterable/searchable list with filters: party, domain, type, date range, bias level
- Clue card:
  - Title + timeline date
  - Source credibility score (color-coded: green 80+, yellow 50–79, red <50)
  - Bias flags as chips
  - Bias-corrected summary
  - Version badge ("v2" with History button showing all prior versions)
  - "New since v1" or "Updated since v1" tag in diff mode
- Add clue manually (opens form with all fields)
- "Refresh Clues" button — re-runs auto-gather on existing search queries

---

**Forum Panel — Conversation View**

This is the primary innovation in the UI. The forum is rendered as a live debate conversation, not a report.

Layout:
```
┌─────────────────────────────────────────────────────────────────┐
│ Round 1: Opening Statements              [Round ▼] [Filter ▼]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 🔴 IRGC Representative          [10:03 AM]  Round 1/3   │  │
│  │                                                          │  │
│  │  The Islamic Revolutionary Guard Corps controls the      │  │
│  │  dominant military and economic infrastructure of the    │  │
│  │  Iranian state. Per [clue-001], the replacement of...    │  │
│  │                                                          │  │
│  │  Clues cited: [clue-001] [clue-007]                      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 🟢 Opposition Movement              [10:07 AM]           │  │
│  │                                                          │  │
│  │  While the IRGC's material capacity is well-documented,  │  │
│  │  the critical variable is cohesion under sustained...    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│ ─────────────────── Round 2: Rebuttals ──────────────────────  │
│                                                                 │
│  ...                                                            │
│                                                                 │
│ ─────────────────── Scenarios Emerging ─────────────────────── │
│                                                                 │
│  ┌── Scenario A: Controlled transition via elite split ──────┐  │
│  │  Proposed by: Opposition Rep                              │  │
│  │  Supported: 🟢 🔵 🟡   Contested: 🔴 🟣                   │  │
│  │  Key clues: [clue-001] [clue-012]                         │  │
│  │  [View Details]                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Features:
- **Live streaming**: during a run, turns appear one by one as the LLM generates them
- **Replay mode**: if viewing a completed session, a scrub bar lets the user replay the debate chronologically
- **Clue inline links**: clicking `[clue-001]` opens a clue detail sidebar without leaving the forum
- **Delta indicator**: in diff mode, delta turns show a "Δ v2" badge and a brief diff of the position change
- **Filter bar**: filter by representative, round, or scenario

---

**Expert Council Panel**
- Expert cards with domain badge and auto/user badge
- Add/remove experts; edit persona prompt
- Deliberation view: tabs per expert showing their scenario assessments
- Cross-deliberation thread: a chat-like view of experts responding to each other
- Probability bar charts per scenario (aggregated from expert contributions)
- In diff mode: delta arrows on probabilities (e.g., `34% → 41% ↑`)

---

**Verdict Panel**
- Ranked scenario cards with probability bars
- Each card: title, probability + confidence, key drivers, watch indicators (checkable)
- Timeline trajectories accordion (90d / 6m / 1y)
- Final narrative assessment
- Version comparison: side-by-side or inline diff of two verdicts
- Export: Markdown or PDF

---

### 9.3 Real-Time Streaming

All pipeline stages stream progress via SSE (Elysia's built-in `context.streamSSE`):

```
// Progress events
data: {"type":"progress","stage":"clue_gathering","pct":0.42,"msg":"Fetching source 5 of 12..."}

// Forum turn events (stream each turn as it completes)
data: {"type":"forum_turn","turn":{"id":"turn-007","representative_id":"rep-irgc","statement":"...","clues_cited":["clue-001"]}}

// Stage complete
data: {"type":"stage_complete","stage":"forum","session_id":"forum-session-v1"}
```

The frontend subscribes to the SSE endpoint for the active topic and renders forum turns in real time as they arrive.

### 9.4 Model Selection

Models are assigned **per task category**, not per stage. This is the key efficiency design: high-frequency low-cognition work (fetching, extracting, bias-correcting) uses cheap fast models; high-stakes reasoning (forum, expert council, verdict) uses the most capable model.

#### Task Categories and Defaults

| Task Category | What runs in it | Default Model | Rationale |
|---|---|---|---|
| `data_gathering` | `web_search`, `http_fetch`, cache reads | `claude-haiku-4-5` | Pure retrieval; no reasoning needed |
| `extraction` | `ClueProcessor` (single-pass extraction + bias correction) | `claude-haiku-4-5` | Structured extraction; high volume; Haiku is fast and cheap |
| `enrichment` | `DiscoveryAgent`, `EnrichmentAgent`, `WeightCalculator` | `claude-sonnet-4-6` | Needs context understanding; not full reasoning |
| `delta_updates` | `DeltaRepresentativeAgent`, delta expert review | `claude-sonnet-4-6` | Incremental reasoning; Sonnet is sufficient for position deltas |
| `forum_reasoning` | `RepresentativeAgent`, `ForumOrchestrator`, `DevilsAdvocate` | `claude-opus-4-6` | Adversarial multi-party reasoning; needs the best model |
| `expert_council` | `ExpertAgent`, cross-deliberation | `claude-opus-4-6` | Complex synthesis; historic analogues; probability estimation |
| `verdict` | `VerdictSynthesizer` | `claude-opus-4-6` | Final authoritative output; no compromises |

#### Model Source: Live from claudeapiproxy

On backend startup, Dana queries the local claudeapiproxy's model list endpoint to populate the available model options. The settings UI shows only models actually available — no hardcoded list.

```typescript
// backend/src/llm/proxyClient.ts
async function fetchAvailableModels(): Promise<ModelInfo[]> {
  const res = await fetch(`${PROXY_BASE_URL}/v1/models`)
  return res.json()  // [{ id, name, context_window, ... }]
}
```

#### Per-Topic Model Settings UI

In topic settings, each task category has its own model dropdown:

```
┌─────────────────────────────────────────────────────────────┐
│ Model Assignment                          [Reset to Defaults]│
├─────────────────────────────────────────────────────────────┤
│ Data Gathering      [claude-haiku-4-5        ▼]             │
│ Extraction          [claude-haiku-4-5        ▼]             │
│ Enrichment          [claude-sonnet-4-6       ▼]             │
│ Delta Updates       [claude-sonnet-4-6       ▼]             │
│ Forum Reasoning     [claude-opus-4-6         ▼]             │
│ Expert Council      [claude-opus-4-6         ▼]             │
│ Verdict             [claude-opus-4-6         ▼]             │
└─────────────────────────────────────────────────────────────┘
```

All dropdowns are populated from the live model list. Settings are saved to `topic.json` under the `models` key (see §4.1). A global default profile can be set in app settings and inherited by new topics.

---

## 10. Storage & File Layout

```
/data/
  topics/
    iri-collapse-2026/
      topic.json                    # metadata, settings, current version
      parties.json                  # all parties
      clues.json                    # all clues with version histories
      representatives.json          # representative personas
      states.json                   # knowledge state ledger
      forum_session_v1.json         # full forum session (initial)
      forum_session_v2.json         # delta session
      expert_council_v1.json        # expert deliberations + verdict v1
      expert_council_v2.json        # delta expert update + verdict v2
      sources/
        raw/
          clue-001-v1.txt           # raw fetched content per clue version
          clue-001-v2.txt
        cache/
          <url-hash>.json           # HTTP fetch cache (48h TTL)
      logs/
        pipeline.log                # full pipeline execution log
        agent_<run-id>.jsonl        # per-run agent input/output traces
        run-<run-id>/
          checkpoint.json           # resume state: { stage, step, completed_turn_ids }
          discovery_output.json
          enrichment_output.json
          weight_calculation.json
          representative_<party-id>_r<round>.json   # one per rep per round
          forum_orchestrator_r<round>.json
          expert_<domain>.json                       # one per expert
          verdict_synthesis.json
          delta_representative_<party-id>.json       # delta runs only
          delta_expert_<domain>.json
          delta_verdict.json
      exports/
        v1/
          index.html                # self-contained static report for state v1
          data.json                 # all data needed by the static page (embedded)
        v2/
          index.html
          data.json

/exports/                           # GitHub Pages build output (generated)
  <topic-slug>/
    v1/index.html
    v2/index.html
    index.html                      # version index page for this topic
  index.html                        # root index listing all published topics

/app/
  frontend/                         # React + Vite
    src/
      components/
        Forum/
          ConversationView.tsx      # live debate thread
          TurnBubble.tsx            # single representative turn
          ScenarioCard.tsx
          DeltaBadge.tsx
        Clues/
        Parties/
        Verdict/
      stores/                       # Zustand stores
      hooks/
        useSSE.ts                   # SSE subscription hook
  backend/                          # Bun + Elysia
    src/
      routes/
        topics.ts
        pipeline.ts
        stream.ts                   # SSE endpoints
      agents/
        DiscoveryAgent.ts
        EnrichmentAgent.ts
        RepresentativeAgent.ts
        DeltaRepresentativeAgent.ts
        ForumOrchestrator.ts
        DevilsAdvocate.ts
        ExpertAgent.ts
        VerdictSynthesizer.ts
        contextBuilder.ts           # buildAgentContext() — dynamic context injection
      tools/
        external/
          webSearch.ts
          httpFetch.ts
          timelineLookup.ts
        internal/
          getClue.ts                # on-demand clue fetch by id+version
          getPartyProfile.ts
          getPriorTurns.ts
          getScenarioList.ts
          getScenarioSummary.ts     # structured scenario summary for experts
          writeArtifact.ts          # per-topic write queue + artifact file write
          readArtifact.ts
        processing/
          clueProcessor.ts          # single-pass extraction + bias correction (Haiku)
          storeClue.ts
      pipeline/
        initialPipeline.ts
        deltaUpdatePipeline.ts
        stateManager.ts             # version/state management logic
        writeQueue.ts               # per-topic serialized write queue
        checkpointManager.ts        # resume logic: read/write checkpoint.json per run
      llm/
        proxyClient.ts              # wraps local claudeapiproxy; retry + rate limiting per model tier
```

---

## 11. Topic Lifecycle

```
                     new clue / edit clue
                     ┌──────────────────────────────────────┐
                     │                                      ▼
DRAFT ──► DISCOVERY ──► ENRICHMENT ──► FORUM ──► EXPERT_COUNCIL ──► COMPLETE
           (auto)         (auto)        (auto)       (auto)
              │              │             │             │
            user           user          user          user
           can edit       can edit      view live     add/remove
           parties        clues         convo         experts
                          add clues     (streaming)

                               COMPLETE ──► STALE ──► (user clicks Update)
                                                │
                                                ▼
                                         DELTA PIPELINE ──► COMPLETE (v+1)
```

Every stage is:
- **Resumable**: interrupted runs pick up where they left off
- **Re-runnable**: user can force re-run any stage; prior output is archived as the previous version
- **Editable**: user can manually edit parties, clues, or expert personas between stages

---

## 12. Bias Correction & Reasoning Protocol

### 12.1 Clue Bias Correction Process

For every raw clue fetched:

1. **Origin source identification**: Who first published this claim? If the fetched outlet is republishing, attributing, or citing another source, trace to the originating report. Record as `origin_source` in the clue's credibility metadata. All downstream outlets citing that same origin count as **one independent source**, not many.
2. **Provenance check**: Origin source's known political affiliation/funding?
3. **Corroboration check**: Reported by ≥1 **independent** origin source of different political lean? Two outlets both citing the same wire report or original story do not count as independent corroboration.
4. **Language bias scan**: Loaded language present? If yes, rewrite neutrally.
5. **Temporal context**: Recent? Potentially outdated?
6. **Selectivity check**: Cherry-picked data point or part of a broader pattern?

Output: `bias_corrected_summary` + `bias_flags[]` + `origin_source`.

**Citation chain collapse rule**: The independent source count for any claim is the number of distinct `origin_source` values across all clues that report it — not the number of outlets. Example: BBC citing Axios, Guardian citing BBC, and The Atlantic citing Axios all trace to Axios as origin. Independent source count = 1.

### 12.2 Forum Reasoning Rules

Built into all representative system prompts:

- **Rule 1 — Evidence Primacy**: Every claim tied to a clue ID. Unsupported claims labeled "inference" or "assumption."
- **Rule 2 — Steelman Obligation**: State the strongest version of the opposing view before refuting it.
- **Rule 3 — No Emotional Appeals**: Emotional/social factors referenced as *data* only, not rhetoric.
- **Rule 4 — Falsifiability**: Every scenario argument must include a condition that, if observed, would falsify it.
- **Rule 5 — Delta Honesty** (delta sessions only): Representatives must clearly state what they have changed their position on and why. Positions maintained unchanged must be explicitly re-affirmed, not assumed.

### 12.3 Expert Council Protocol

- Must cite ≥1 historical analogue when assigning a probability
- Probability estimates include confidence level: `high / medium / low`
- Low confidence is valid and encouraged — overconfidence is a bug
- Experts may request additional clue searches during deliberation

---

## 13. Build Roadmap

### Phase 1 — Foundation
1. Initialize project: `bun create` for backend (Elysia), Vite for frontend
2. Implement `TopicManager`: CRUD topics, JSON file operations with Bun file APIs
3. Implement LLM proxy client: wraps local claudeapiproxy, model selection, streaming; retry policy + per-model-tier rate limiting
4. Implement external tool layer: `web_search`, `http_fetch`, `timeline_lookup`
5. Implement `ClueProcessor`: single-pass extraction + bias correction (Haiku); replaces separate SourceSummarizer + BiasCorrector
6. Implement `store_clue` with per-topic write queue (`writeQueue.ts`)
7. Implement `DiscoveryAgent`: topic → initial parties + seed clues; writes discovery artifact
8. Wire SSE streaming endpoint (Elysia `streamSSE`)
9. Build Dashboard UI: topic card grid, new topic dialog
10. Build basic Topic View skeleton with stage navigator

### Phase 2 — Clue Pipeline & Versioning
11. Implement internal tool layer: `get_clue`, `get_party_profile`, `write_artifact`, `read_artifact`
12. Implement `buildAgentContext()`: dynamic lean context injection for all agent calls
13. Implement `EnrichmentAgent`: party deepening + clue expansion via ClueProcessor; writes enrichment artifact
14. Implement `WeightCalculator` agent; writes weight_calculation artifact
15. Implement `StateManager`: states.json, version snapshot logic, staleness detection
16. Implement `checkpointManager`: write/read checkpoint.json per run; pipeline resume on interruption
17. Build Clues Panel UI: list, filter, bias flags, version history button, diff badges
18. Build Party Editor UI: full CRUD, weight visualization
19. Build staleness banner + "View Changes" diff modal

### Phase 3 — Forum as Live Conversation
20. Implement `get_prior_turns` and `get_scenario_list` internal tools
21. Implement `RepresentativeAgent` with steelman protocol; tool-pull context model; writes turn artifact per round
22. Implement `ForumOrchestrator`: reads rep artifacts via read_artifact; round sequencing; writes consolidated forum session
23. Implement `DevilsAdvocate` pass; writes falsification artifact
24. Build Forum Conversation View: streaming turns, round separators, scenario cards
25. Implement SSE forum turn events; frontend `useSSE` hook (stream as artifact writes complete)
26. Add clue inline links (click → clue detail sidebar)
27. Add replay scrub bar for completed sessions
28. Add delta turn rendering with position diff badges

### Phase 4 — Expert Council & Verdict
29. Implement `get_scenario_summary` internal tool: structured scenario summary (no raw forum rhetoric)
30. Implement `ExpertAgent` as isolated parallel subagents; tool-pull model; writes expert artifact including weight_challenges
31. Implement cross-expert deliberation round via read_artifact
32. Implement `VerdictSynthesizer`: reads all expert artifacts; applies weight challenges; writes verdict artifact
33. Build Expert Council Panel: tabs per expert, cross-deliberation thread, weight challenge indicators
34. Build Verdict Panel: probability bars, watch indicators, trajectories

### Phase 5 — Incremental Updates
35. Implement `DeltaRepresentativeAgent`: tool-pull delta position update; writes delta rep artifact
36. Implement delta expert review with get_scenario_summary (delta variant)
37. Implement delta verdict synthesis
38. Wire full incremental update pipeline
39. Build version picker + compare mode in topic header
40. Build version diff views (clues, scenarios, probabilities, verdict)

### Phase 6 — Model Assignment & Settings
41. Query claudeapiproxy `/v1/models` on startup; expose as `/api/models` to frontend
42. Build per-task model assignment UI (7 dropdowns populated from live model list)
43. Wire task category → model lookup in `proxyClient.ts`; all agents read model from topic config
44. Add global default model profile in app settings; new topics inherit it

### Phase 7 — Static Export & GitHub Pages
45. Build `data.json` assembler: snapshot all topic data for a given version
46. Build static HTML template + vanilla JS renderer (expect ~600 lines for full forum + diff + tabs)
47. Wire "Export as Static Page" button in Verdict Panel
48. Build version index page template
49. Build root topic index page template
50. Implement GitHub API publisher: push files to gh-pages branch
51. Add GitHub Pages config to topic settings (repo, branch, base path, token)
52. Add "Publish to GitHub Pages" button with confirmation + published URL display
53. Build compare view on version index page (side-by-side two versions)

---

## 14. GitHub Pages Static Export

### 14.1 Concept

Any completed knowledge state version can be **published as a static HTML page** to a GitHub Pages repository. The page is fully self-contained — no backend, no API calls — and contains all the data, forum conversations, and the verdict report for that specific version. Multiple versions of the same topic are published as separate pages, reachable via a version index.

This serves several purposes:
- **Shareable**: send a URL to anyone; no Dana installation needed to read the analysis
- **Archival**: the report is frozen at the state's date — a permanent record of what was known and concluded at that moment
- **Versioned timeline**: the GitHub Pages site for a topic shows all versions chronologically, making the evolution of the analysis visible

---

### 14.2 Static Page Structure

Each published version generates a **single self-contained `index.html`** with all data embedded as a JSON blob in a `<script>` tag. A small vanilla JS renderer hydrates the page client-side — no React, no build step needed to view it.

```
https://<user>.github.io/<repo>/<topic-slug>/v1/      ← State v1 report
https://<user>.github.io/<repo>/<topic-slug>/v2/      ← State v2 report
https://<user>.github.io/<repo>/<topic-slug>/         ← Version index for topic
https://<user>.github.io/<repo>/                      ← All topics index
```

The version index page (`/<topic-slug>/index.html`) lists all published versions with:
- Version number and label
- Date published
- What triggered the update (initial run / clue added / clue updated / manual refresh)
- Key change summary (from `states.json` delta_summary)
- Link to that version's report

---

### 14.3 Static Page Content

Each version report page includes all of:

| Section | Content |
|---|---|
| Topic header | Title, description, version, date, model config used |
| Parties | All parties with weight, agenda, means, circles |
| Clues | All clues active in this version with bias-corrected summaries and source credibility |
| Forum conversation | Full debate transcript, round by round, with representative turns rendered as a conversation thread |
| Delta note (if v2+) | What changed since the previous version and why |
| Expert Council | Each expert's scenario assessments with historic analogues |
| Verdict | Ranked scenarios with probabilities, watch indicators, trajectories |

The page is **read-only** — no editing. Navigation tabs mirror the app's panel structure. The forum conversation is rendered as the same chat-thread layout as in the live app.

---

### 14.4 `data.json` Embedded Payload

```jsonc
{
  "meta": {
    "topic_id": "iri-collapse-2026",
    "topic_title": "IRI Regime Collapse...",
    "version": 2,
    "state_date": "2026-03-22T09:00:00Z",
    "trigger": "user_edit_clue",
    "delta_summary": { "..." },
    "exported_at": "2026-03-22T13:00:00Z"
  },
  "parties": [ "..." ],
  "clues": [
    // only current version of each clue as of this state snapshot
    // previous clue versions omitted to keep payload lean
  ],
  "forum_sessions": [
    // all sessions up to and including this version
    // v1: full session; v2+: prior sessions summarized, latest session full
  ],
  "expert_council": { "..." },
  "verdict": { "..." }
}
```

---

### 14.5 Export & Publish Workflow

**Exporting (local)**

The user clicks "Export v2 as Static Page" in the Verdict Panel. The backend:
1. Reads all relevant JSON files for that version
2. Assembles the `data.json` payload
3. Renders the static HTML template with the data embedded
4. Writes to `data/topics/<slug>/exports/v<N>/index.html`
5. Returns a local preview URL

**Publishing to GitHub Pages**

In topic settings, the user can configure a GitHub Pages target:
```jsonc
"github_pages": {
  "enabled": true,
  "repo": "username/dana-reports",    // target GitHub repo
  "branch": "gh-pages",
  "base_path": "/iri-collapse-2026"   // subfolder in the repo
}
```

The backend uses the GitHub API (token stored locally in `.env`) to:
1. Push the generated `index.html` + `data.json` to the specified repo/branch/path
2. Update the topic's version index page
3. Update the root index page

**UI flow in the app:**

```
Verdict Panel footer:
  [Export v2 as Static Page]  [Publish to GitHub Pages →]

After publish:
  ✓ Published: https://username.github.io/dana-reports/iri-collapse-2026/v2/
                                                         [Copy link] [Open]
```

---

### 14.6 Version Index Page Design

The version index (`/<topic-slug>/index.html`) shows a timeline:

```
IRI Regime Collapse Analysis
──────────────────────────────────────────────────────

  v1 · Mar 20, 2026 · Initial analysis
       23 clues · 8 parties · 5 experts
       → [View Report]

  v2 · Mar 22, 2026 · Updated: IRGC defection report   ← newest
       24 clues · 8 parties · 5 experts
       Key change: Possible IRGC officer defection —
       military stability assessment revised
       Scenario A: 28% → 34% ↑   Scenario C: 31% → 24% ↓
       → [View Report]  [Compare v1 vs v2]
```

---

### 14.7 Static Renderer

The static page uses ~200 lines of vanilla JS (no framework, no dependencies) to:
- Parse the embedded `data.json`
- Render tabs: Parties / Clues / Forum / Expert Council / Verdict
- Render the forum as a conversation thread (same visual style as the app)
- Inline highlight clue citations as tooltips (hover shows bias-corrected summary)
- Show a delta banner if the page is v2+
- Render probability bars as simple CSS width percentages

This keeps the static page self-contained with zero external dependencies — it works offline, in any browser, forever.

---

Before adding any agent or modifying prompts:
- [ ] Does the agent cite clue IDs (with version) for every claim?
- [ ] Does the agent acknowledge counter-evidence?
- [ ] Is the output schema validated (no free-form verdict)?
- [ ] Has the steelman protocol been tested with a known-biased input?
- [ ] Are probability estimates normalized and confidence-flagged?
- [ ] In delta agents: is prior position explicitly referenced?

## Appendix B — Design Principles

1. **Traceability over speed**: Every conclusion traces to a clue. No black-box outputs.
2. **Structure over brilliance**: Pipeline structure catches bias any single model would miss.
3. **Humility by design**: Low confidence is valid and required. Overconfidence is a bug.
4. **Living analysis**: The world changes. The analysis must change with it, without losing history.
5. **User in the loop**: Automation handles the tedious; the user steers the important.
6. **Minimal infrastructure**: JSON files and a local LLM proxy. No cloud dependencies.
