# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Backend server port |
| `DATA_DIR` | `/home/nima/dana/data` | Data directory (SQLite DB + topic files) |
| `PROXY_BASE_URL` | `http://127.0.0.1:8317` | CLIProxyAPI base URL |
| `PROXY_API_KEY` | `sk-dummy` | API key for CLIProxyAPI (placeholder, auth via OAuth) |

## External Dependencies

- **CLIProxyAPI**: LLM relay proxy, runs in Docker container on host. Port 8317. Provides unified API for Claude, OpenAI, Gemini. OAuth-based authentication.
- **Bun**: JavaScript runtime. Version 1.3.11. Located at `~/.bun/bin/bun`.
- **SQLite**: Embedded via `bun:sqlite`. No external database process needed.

## Platform Notes

- Running on WSL2 (Ubuntu 24.04) with 32 cores, 15GB RAM
- No sudo access available
- Node.js installed via `fnm` for agent-browser
- Chromium libraries in `~/.local/lib` (for agent-browser validation)
- `LD_LIBRARY_PATH=~/.local/lib` needed for agent-browser

## Package Management

- Both frontend and backend use Bun as package manager
- Frontend: `cd app/frontend && bun install`
- Backend: `cd app/backend && bun install`
