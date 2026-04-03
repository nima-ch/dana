---
name: implementation-worker
description: Full-stack worker for Docker infrastructure, TypeScript tool replacement, and test updates
---

# Implementation Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features involving:
- Docker infrastructure (docker-compose.yml, SearXNG configuration, Dockerfile changes)
- TypeScript tool implementations (webSearch.ts, httpFetch.ts replacements)
- npm dependency management
- Test file updates (externalTools.test.ts)
- File deletion (manage.sh)

## Required Skills

None — all work uses standard file editing tools and shell commands.

## Work Procedure

### 1. Understand the Feature

Read the feature description, preconditions, expectedBehavior, and verificationSteps thoroughly. Read `AGENTS.md` for mission boundaries. Read `.factory/library/architecture.md` for system context.

### 2. Read Existing Code

Before writing anything, read all files you will modify AND all files that import from those files. Understand the current interfaces, types, and calling patterns.

### 3. Write Tests First (TDD)

For TypeScript features:
1. Read the existing test file (`app/backend/tests/externalTools.test.ts`) to understand conventions
2. Write failing tests that cover the feature's expectedBehavior
3. Run `cd app/backend && bun test tests/externalTools.test.ts` to confirm tests fail (red)
4. If tests require infrastructure (SearXNG container), verify it's running first

For Docker features:
- Tests are verification commands (docker compose config, curl, etc.) — run them to establish baseline

### 4. Implement

Write the implementation to make tests pass. Key guidelines:
- **Preserve interfaces exactly** — `SearchResult` and `FetchResult` types must not change
- **Preserve function signatures exactly** — no new required parameters
- **Use fallback pattern** — try primary, catch error, try secondary, throw if both fail
- **Read env vars** — use `process.env.SEARXNG_URL` for SearXNG endpoint
- **Handle errors gracefully** — network failures, timeouts, corrupted cache, empty responses
- **Install dependencies** — add to package.json with `bun add <package>`

### 5. Verify (Green)

Run tests again to confirm they pass:
```bash
cd /home/nima/dana/app/backend && bun test tests/externalTools.test.ts
```

Then run the full test suite to check for regressions:
```bash
cd /home/nima/dana/app/backend && bun test
```

### 6. Manual Verification

For search/fetch features:
- Run a quick manual test: `cd /home/nima/dana/app/backend && bun -e "import { webSearch } from './src/tools/external/webSearch'; webSearch('test').then(r => console.log(JSON.stringify(r, null, 2)))"`
- Verify results look correct (valid URLs, non-empty snippets)

For Docker features:
- Run `docker compose config` to validate compose file
- Run `docker compose up -d` and verify containers start
- Test inter-container connectivity with `docker compose exec`

### 7. Commit

Commit with a clear message describing what was changed.

## Example Handoff

```json
{
  "salientSummary": "Replaced webSearch.ts with SearXNG primary + Brave fallback. Installed cheerio for HTML parsing. Tests pass: 8 test cases covering SearXNG results, Brave fallback, interface preservation, date extraction, and error handling.",
  "whatWasImplemented": "Rewrote webSearch.ts to use SearXNG JSON API (SEARXNG_URL env var) as primary search engine with Brave HTML scraping as fallback. Added cheerio dependency for Brave HTML parsing. Preserved SearchResult interface and function signature exactly. All 8 consumer files compile without changes.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "cd app/backend && bun test tests/externalTools.test.ts", "exitCode": 0, "observation": "12 tests pass, 0 fail" },
      { "command": "cd app/backend && bun test", "exitCode": 0, "observation": "All 45 tests pass across 17 files" },
      { "command": "bun -e \"import { webSearch } from './src/tools/external/webSearch'; webSearch('test').then(r => console.log(r.length))\"", "exitCode": 0, "observation": "Returns 5 results with valid URLs and snippets" }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      {
        "file": "app/backend/tests/externalTools.test.ts",
        "cases": [
          { "name": "SearXNG returns results with correct shape", "verifies": "VAL-SEARCH-001" },
          { "name": "respects numResults parameter", "verifies": "VAL-SEARCH-002" },
          { "name": "falls back to Brave when SearXNG unreachable", "verifies": "VAL-SEARCH-004" },
          { "name": "throws when both engines fail", "verifies": "VAL-SEARCH-008" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature depends on SearXNG container but it's not running and you can't start it
- Consumer files need changes that contradict the "no consumer changes" requirement
- New npm packages fail to install in the Bun/Alpine environment
- Docker compose configuration requires changes to existing container (cli-proxy-api) that's out of scope
- Existing tests fail for reasons unrelated to this feature
