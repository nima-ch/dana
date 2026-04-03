# Architecture

## System Overview

Dana is an intelligence analysis platform with a TypeScript/Bun backend and React frontend, deployed as Docker containers.

## Components

### Backend (app/backend/)
- **Runtime:** Bun on Alpine Linux
- **Framework:** Elysia (HTTP server)
- **Database:** SQLite at `${DATA_DIR}/dana.db`
- **LLM Proxy:** CLIProxyAPI (separate container on port 8317) — routes to Anthropic/OpenAI/Gemini via OAuth

### Frontend (app/frontend/)
- React 19 + Vite + Tailwind CSS
- Compiled at build time, served as static files by the backend

### External Tools (app/backend/src/tools/external/)
- **webSearch.ts** — Web search function, returns `SearchResult[]`
- **httpFetch.ts** — URL content fetcher, returns `FetchResult` with cached markdown
- **searchUtils.ts** — Result scoring/selection utilities (uses SearchResult type)
- **timelineLookup.ts** — Timeline builder (wraps webSearch)

### Agents (app/backend/src/agents/)
Six agents import and call webSearch/httpFetch directly (not via tool-calling protocol):
- DiscoveryAgent, CapabilityResearcher, NewsTracker, FactChecker, SmartClueExtractor, PartyIntelligence

### Tool Registry (app/backend/src/routes/agentTools.ts)
- UI/configuration only — provides REST API for frontend Settings page
- Agents import tools directly, not through registry dispatch

## Data Flow

```
Agent → webSearch(query) → SearchResult[] → httpFetch(url) → FetchResult (markdown) → processClue() (LLM) → ClueProcessorOutput → DB
```

## Key Interfaces

```typescript
interface SearchResult {
  title: string
  url: string
  snippet: string
  date?: string  // YYYY-MM-DD
}

interface FetchResult {
  url: string
  title: string
  raw_content: string  // markdown
  fetched_at: string   // ISO timestamp
  cached: boolean
}
```

## Docker Architecture

- **dana container** — Bun backend + compiled frontend (port 3000)
- **cli-proxy-api container** — LLM proxy (port 8317)
- **searxng container** — Self-hosted meta-search engine (port 8080)
- Inter-container communication via Docker Compose bridge network
- Data persistence via volume mount at /data

## Caching

httpFetch caches responses per-topic at `${DATA_DIR}/topics/${topicId}/sources/cache/${md5(url)}.json` with 48h TTL. Cache includes `cached_at` timestamp for TTL check.

## Search Architecture (Target)

Primary: SearXNG JSON API (`${SEARXNG_URL}/search?q=...&format=json`)
Fallback: Brave HTML scraping (`https://search.brave.com/search?q=...`) parsed with cheerio

## Fetch Architecture (Target)

Primary: Jina Reader API (`https://r.jina.ai/${url}`) — returns clean markdown
Fallback: DIY pipeline (fetch HTML → linkedom DOM → @mozilla/readability → turndown markdown)
