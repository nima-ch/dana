---
name: implementation-worker
description: Full-stack worker for frontend (React/shadcn/ui/Tailwind) and backend (Bun/Elysia) features
---

# Implementation Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features involving:
- React frontend components (shadcn/ui, Tailwind CSS v4, Zustand state)
- Bun/Elysia backend API endpoints
- SQLite database schema changes or queries
- SSE streaming
- Full-stack features spanning frontend + backend

## Required Skills

- **agent-browser**: For manual verification of UI features. Invoke when the feature has user-facing UI to verify. Use to navigate pages, interact with elements, take screenshots, and verify visual state.

## Work Procedure

### 1. Understand the Feature

Read the feature description, preconditions, expectedBehavior, and verificationSteps from features.json. Read `mission.md`, `AGENTS.md`, `.factory/library/architecture.md`, and any relevant `.factory/library/` files. Understand what this feature builds and how it fits into the system.

### 2. Investigate Existing Code

Before writing anything, read the existing code that this feature touches:
- For frontend: read existing components in `app/frontend/src/`, the API client at `app/frontend/src/api/client.ts`, stores in `app/frontend/src/stores/`, and relevant pages.
- For backend: read existing routes in `app/backend/src/routes/`, database queries in `app/backend/src/db/queries/`, agents in `app/backend/src/agents/`.
- Match existing patterns, naming conventions, and code style.

### 3. Write Tests First (Red Phase)

Write failing tests BEFORE implementation:
- **Backend tests**: Add to `app/backend/tests/` using `bun:test`. Test new API endpoints, database queries, business logic.
- **Frontend**: If the feature has complex logic (state management, data transformation), add tests. For pure UI components, skip unit tests — verify via agent-browser instead.
- Run tests to confirm they fail: `cd /home/nima/dana/app/backend && /home/nima/.bun/bin/bun test tests/<new-test-file>.ts`

### 4. Implement

Write the implementation to make tests pass:

**Frontend patterns:**
- Use shadcn/ui components from `@/components/ui/` — check what's installed before using. If a component isn't installed, install it: `cd /home/nima/dana/app/frontend && bunx --bun shadcn@latest add <component>`
- Use `cn()` from `@/lib/utils` for conditional classes
- Use `@/` path aliases for imports
- Follow existing component patterns in `app/frontend/src/components/`
- Use Zustand stores for shared state, local useState for component-local state
- Use the `api` object from `@/api/client.ts` for REST calls
- Use `useSSE` hook from `@/hooks/useSSE.ts` for real-time events
- Tailwind v4: use semantic color tokens (`bg-background`, `text-foreground`, `border-border`, etc.) — never hardcode colors
- Dark mode: CSS variables handle theming automatically via `.dark` class. No manual dark: prefixes needed for semantic tokens.

**Backend patterns:**
- Add routes in `app/backend/src/routes/` following existing Elysia patterns
- Add database queries in `app/backend/src/db/queries/` following existing prepared statement patterns
- Register new routes in `app/backend/src/index.ts`
- Use `bun:sqlite` for database operations
- SSE: use `emit()` and `subscribe()` from `routes/stream.ts`

### 5. Run Tests (Green Phase)

Run all tests to confirm they pass:
```
cd /home/nima/dana/app/backend && /home/nima/.bun/bin/bun test tests/topicManager.test.ts tests/storeClue.test.ts tests/stream.test.ts tests/internalTools.test.ts tests/contextBuilder.test.ts tests/stateManager.test.ts tests/forumTools.test.ts tests/pipeline.test.ts tests/expertAgent.test.ts tests/deltaPipeline.test.ts
```
Plus any new test files you created.

### 6. Typecheck and Lint

```
cd /home/nima/dana/app/frontend && /home/nima/.bun/bin/bun run build
cd /home/nima/dana/app/frontend && /home/nima/.bun/bin/bun run lint
```

Fix all errors before proceeding.

### 7. Manual Verification with agent-browser

For features with UI:
1. Start services if not running (check ports first):
   ```
   # Check if backend is running
   curl -sf http://localhost:3000/health || (cd /home/nima/dana/app/backend && DATA_DIR=/home/nima/dana/data PROXY_BASE_URL=http://127.0.0.1:8317 PORT=3000 /home/nima/.bun/bin/bun run src/index.ts > /home/nima/dana/.logs/backend.log 2>&1 &)
   # Check if frontend is running
   curl -sf http://localhost:5173 || (cd /home/nima/dana/app/frontend && /home/nima/.bun/bin/bun run dev > /home/nima/dana/.logs/frontend.log 2>&1 &)
   ```
2. Invoke the `agent-browser` skill
3. Navigate to relevant pages
4. Verify each expectedBehavior visually
5. Take screenshots as evidence
6. Record each check in `interactiveChecks`

### 8. Commit

Commit all changes with a descriptive message. Include test files, implementation files, and any config changes.

## Example Handoff

```json
{
  "salientSummary": "Implemented Settings page shell with 4-tab navigation (Providers, Prompts, Agents, Pipeline). Added /settings and /settings/:tab routes with lazy loading. Verified all tabs render correctly via agent-browser. Typecheck and lint pass.",
  "whatWasImplemented": "Settings page component with shadcn/ui Tabs, route configuration in main.tsx with React.lazy, sidebar Settings link, tab-specific content panels (placeholder content for tabs not yet implemented).",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "cd /home/nima/dana/app/frontend && bun run build", "exitCode": 0, "observation": "TypeScript compilation and Vite build successful, no errors" },
      { "command": "cd /home/nima/dana/app/frontend && bun run lint", "exitCode": 0, "observation": "No lint errors" },
      { "command": "cd /home/nima/dana/app/backend && bun test tests/topicManager.test.ts tests/storeClue.test.ts tests/stream.test.ts tests/internalTools.test.ts tests/contextBuilder.test.ts tests/stateManager.test.ts tests/forumTools.test.ts tests/pipeline.test.ts tests/expertAgent.test.ts tests/deltaPipeline.test.ts", "exitCode": 0, "observation": "All 47 existing tests pass" }
    ],
    "interactiveChecks": [
      { "action": "Navigate to http://localhost:5173/settings", "observed": "Settings page loads with Providers & Models tab active. 4 tabs visible in navigation." },
      { "action": "Click 'System Prompts' tab", "observed": "Tab switches to show prompt editor placeholder content. URL updates to /settings/prompts." },
      { "action": "Click 'Agents & Tools' tab", "observed": "Tab switches correctly. URL updates to /settings/agents." },
      { "action": "Navigate directly to http://localhost:5173/settings/pipeline", "observed": "Settings page loads with Pipeline tab active (deep linking works)." },
      { "action": "Click sidebar 'Settings' link from Dashboard", "observed": "Navigates to /settings. Sidebar highlights Settings link." }
    ]
  },
  "tests": {
    "added": []
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature depends on a backend API that doesn't exist yet (and isn't part of this feature)
- shadcn/ui component behaves unexpectedly and needs architectural decision
- Existing tests break due to unrelated changes
- Database schema change conflicts with existing data
- Feature scope significantly exceeds what's described
