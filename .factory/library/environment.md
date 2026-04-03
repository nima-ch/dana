# Environment

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| PORT | 3000 | Backend listen port |
| DATA_DIR | /data (Docker) / ./data (local) | SQLite DB + topic data |
| PROXY_BASE_URL | http://127.0.0.1:8317 | CLIProxyAPI LLM proxy URL |
| PROXY_API_KEY | sk-dummy | API key for proxy |
| SEARXNG_URL | http://searxng:8080 | SearXNG search engine URL |
| OAUTH_CALLBACK_PORT | 54545 | OAuth callback port |

## Dependencies

### Backend (app/backend/package.json)
- elysia, @elysiajs/cors, @elysiajs/swagger
- New: cheerio, linkedom, @mozilla/readability, turndown, @types/turndown

### Frontend (app/frontend/package.json)
- React 19, Vite, Tailwind CSS, zustand

## Runtime
- Bun 1.3.11 on Alpine Linux (Docker)
- Node.js-compatible APIs available via Bun

## Docker
- Base image: oven/bun:1-alpine
- Ports: 3000 (app), 8317 (proxy), 8080 (SearXNG), 54545 (OAuth)
- Volume: /data for SQLite + topic data persistence
