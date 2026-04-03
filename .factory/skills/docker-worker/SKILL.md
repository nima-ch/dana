---
name: docker-worker
description: Worker for Docker deployment, containerization, and infrastructure features
---

# Docker Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features involving:
- Dockerfile creation and optimization
- Docker Compose configuration
- Static file serving configuration
- Process management inside containers
- Health checks and startup scripts
- Volume mounts and data persistence
- Production build optimization

## Required Skills

None. Docker features are verified via CLI commands (docker build, docker run, curl).

## Work Procedure

### 1. Understand the Feature

Read the feature description, preconditions, expectedBehavior, and verificationSteps. Read `mission.md`, `AGENTS.md`, `.factory/library/architecture.md`. Understand the deployment architecture.

### 2. Investigate Existing Setup

- Read `app/frontend/package.json` for build commands
- Read `app/backend/src/index.ts` for server setup
- Check what ports are used: backend (3000), frontend (5173), CLIProxyAPI (8317)
- Check the .env file for environment variables
- Read the existing manage.sh for process management patterns

### 3. Implement

**Dockerfile patterns:**
- Use multi-stage builds: stage 1 for building frontend, stage 2 for production
- Base image: `oven/bun:1-alpine` for small size
- Copy only necessary files (use .dockerignore)
- Install CLIProxyAPI binary from GitHub releases
- Set proper WORKDIR, ENV, EXPOSE directives

**Static file serving:**
- Configure Elysia to serve files from `app/frontend/dist/`
- SPA fallback: serve index.html for non-API, non-static routes
- Set proper MIME types and cache headers

**Process management:**
- Use a shell entrypoint script to start CLIProxyAPI + Elysia
- CLIProxyAPI must start first (background process)
- Elysia runs as main process (foreground)
- Handle SIGTERM for graceful shutdown (trap + forward to children)

**Volume mounts:**
- Data directory (SQLite + topic files) mounted at /data
- CLIProxyAPI credentials at /root/.cli-proxy-api

### 4. Build and Test

```bash
# Build the image
docker build -t dana .

# Run the container
docker run -d --name dana-test -p 8080:3000 -p 8317:8317 -v dana-test-data:/data dana

# Verify
curl -sf http://localhost:8080/health
curl -sf http://localhost:8080  # Should return index.html
curl -sf http://localhost:8080/api/topics  # API should work

# Check static file serving
curl -sf http://localhost:8080/assets/index-*.js  # JS bundle exists

# Check SPA routing
curl -sf http://localhost:8080/topic/test-id  # Should return index.html

# Check image size
docker images dana --format '{{.Size}}'

# Cleanup
docker stop dana-test && docker rm dana-test
docker volume rm dana-test-data
```

### 5. Verify Graceful Shutdown

```bash
docker run -d --name dana-shutdown-test -p 8080:3000 dana
# Let it start
sleep 5
# Graceful stop
time docker stop dana-shutdown-test
# Should stop within 10 seconds
docker rm dana-shutdown-test
```

### 6. Commit

Commit Dockerfile, .dockerignore, entrypoint script, and any backend changes for static serving.

## Example Handoff

```json
{
  "salientSummary": "Created multi-stage Dockerfile bundling Bun backend, React build, and CLIProxyAPI. Container starts on port 3000 (mapped to 8080), serves frontend at / and API at /api/*. Image size: 380MB. Graceful shutdown within 5 seconds.",
  "whatWasImplemented": "Dockerfile (2-stage: build frontend + production), .dockerignore, entrypoint.sh (starts CLIProxyAPI then Elysia with SIGTERM handling), backend static file serving middleware with SPA fallback.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "docker build -t dana .", "exitCode": 0, "observation": "Build completed in 45s, no errors" },
      { "command": "docker images dana --format '{{.Size}}'", "exitCode": 0, "observation": "Image size: 380MB (under 500MB target)" },
      { "command": "curl -sf http://localhost:8080/health", "exitCode": 0, "observation": "Returns {status: 'ok'}" },
      { "command": "curl -sf http://localhost:8080", "exitCode": 0, "observation": "Returns index.html with React app" },
      { "command": "curl -sf http://localhost:8080/api/topics", "exitCode": 0, "observation": "Returns JSON array of topics" },
      { "command": "curl -sf http://localhost:8080/topic/nonexistent", "exitCode": 0, "observation": "Returns index.html (SPA fallback works)" },
      { "command": "time docker stop dana-test", "exitCode": 0, "observation": "Stopped in 3 seconds (graceful shutdown)" }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": []
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- CLIProxyAPI binary not available for the target architecture
- Port conflicts that can't be resolved within mission boundaries
- Docker build fails due to missing system dependencies
- Image size significantly exceeds 500MB target
