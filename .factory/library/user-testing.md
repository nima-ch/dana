# User Testing

## Validation Surface

This mission's testing surface is API-level only (no browser UI testing needed):
- **bun test** — Unit/integration tests with real HTTP calls
- **curl** — HTTP probes from host and from within Docker containers
- **docker compose exec** — Commands executed inside containers

## Validation Concurrency

- **Max concurrent validators:** 5
- **Rationale:** API-level testing is lightweight. Each bun test instance uses ~100MB RAM. SearXNG container adds ~200MB. Machine has 9.5GB available RAM, 32 CPU cores. 5 concurrent validators = ~500MB additional, well within budget.

## Testing Requirements

- SearXNG container must be running for search tests
- Jina Reader API (r.jina.ai) must be reachable for fetch tests
- Brave search (search.brave.com) must be reachable for fallback tests
- Tests use temp directories under /tmp/ for cache isolation
- Tests set process.env.DATA_DIR to temp dirs to avoid touching real data

## Known Constraints

- Brave search may rate-limit if too many tests run rapidly
- Jina Reader free tier has ~20 RPM without API key
- SearXNG startup takes a few seconds on first boot

## Flow Validator Guidance: api-level

- Use only API-level validation surfaces for this milestone: `bun test`, host `curl`, and `docker compose exec`.
- Reuse the shared `docker compose` stack at `http://localhost:3000` and `http://localhost:8080`; do not start alternate app instances on new ports.
- Avoid mutating shared app state beyond temporary `/data` persistence markers and temp cache directories under `/tmp`.
- Prefer serial execution for commands that restart containers (`docker compose down` / `up`) because they interrupt every other validator.
- Container-internal probes should use `bun -e` for HTTP fetches because `curl` is not installed in the Dana container.
