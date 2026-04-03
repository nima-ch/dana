# syntax=docker/dockerfile:1.7

FROM eceasy/cli-proxy-api:latest AS proxy

FROM oven/bun:1-alpine AS builder
WORKDIR /app

COPY app/frontend/package.json app/frontend/bun.lock app/frontend/
RUN cd app/frontend && bun install --frozen-lockfile

COPY app/frontend/ app/frontend/
RUN cd app/frontend && bun run build

FROM oven/bun:1-alpine
WORKDIR /app
ENV PORT=3000 DATA_DIR=/data PROXY_BASE_URL=http://127.0.0.1:8317

COPY --from=proxy /CLIProxyAPI/CLIProxyAPI /usr/local/bin/CLIProxyAPI
RUN chmod +x /usr/local/bin/CLIProxyAPI

COPY app/backend/package.json app/backend/bun.lock app/backend/
RUN cd app/backend && bun install --frozen-lockfile --production

COPY app/backend/ app/backend/
COPY --from=builder /app/app/frontend/dist /app/app/frontend/dist
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000 8317
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD curl -sf http://127.0.0.1:${PORT:-3000}/api/topics || exit 1
STOPSIGNAL SIGTERM
VOLUME ["/data"]

CMD ["/app/entrypoint.sh"]
