# User Testing

Testing surface, required testing skills/tools, and resource cost classification.

---

## Validation Surface

**Primary surface:** Browser UI
**Tool:** agent-browser v0.17.1
**Setup:** Backend on port 3000, Frontend on port 5173 (Vite dev server), CLIProxyAPI on port 8317

**Testing approach:**
- Navigate to pages, interact with UI elements, take screenshots
- Verify visual state, data display, navigation flows
- LLM calls are mocked for validation (no real API costs)
- Existing database with 4 topics provides real test data

**Environment prerequisites:**
- Node.js available (installed via fnm)
- Chromium installed via `bunx playwright install chromium`
- `LD_LIBRARY_PATH=/home/nima/.local/lib` must be set
- agent-browser binary at `/home/nima/.factory/bin/agent-browser`

**Mock data:**
- 4 existing topics in SQLite database at `/home/nima/dana/data/dana.db`
- Topics have parties, clues, forum sessions, expert councils, verdicts
- No separate fixture setup needed — live database is the test fixture

## Validation Concurrency

**Machine resources:** 15GB RAM, 32 CPU cores, ~12GB available
**Per agent-browser instance:** ~350MB RAM (daemon + Chrome + renderer)
**Dev server overhead:** ~200MB (Vite + Bun backend)

**Max concurrent validators: 5**
- 5 instances × 350MB = 1.75GB
- Plus dev server ~200MB + system overhead ~2GB
- Total: ~4GB of 12GB available headroom
- Conservative limit with 70% headroom rule

**Isolation notes:**
- Each agent-browser instance gets its own Chrome session
- API calls go to the same backend (shared state via SQLite)
- SSE subscriptions are per-topic, so parallel tests on different topics are safe
- Tests on the same topic may have state conflicts — isolate by topic
