# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS web-builder
WORKDIR /src

COPY package.json package-lock.json ./
COPY apps/platform-web/package.json apps/platform-web/package.json
COPY apps/play-frontend-dev/package.json apps/play-frontend-dev/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/play-bridge/package.json packages/play-bridge/package.json
RUN npm ci

COPY apps/platform-web apps/platform-web
COPY packages/contracts packages/contracts
COPY packages/play-bridge packages/play-bridge
RUN npm run build:web

FROM golang:1.24-bookworm AS server-builder
WORKDIR /src/apps/platform-server

COPY apps/platform-server/go.mod apps/platform-server/go.sum ./
RUN go mod download

COPY apps/platform-server ./
ARG TARGETOS=linux
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH:-$(go env GOARCH)} go build -tags nodynamic -trimpath -ldflags="-s -w" -o /out/platform-server ./cmd/platform-server

FROM alpine:3.22 AS runtime
RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app
COPY --from=server-builder /out/platform-server /app/platform-server
COPY --from=web-builder /src/apps/platform-web/dist /app/public

RUN mkdir -p /data

ENV TSIAN_ADDR=:8080 \
    TSIAN_DB_PATH=/data/tsian.db \
    TSIAN_DATA_DIR=/data \
    TSIAN_STATIC_DIR=/app/public \
    TSIAN_COOKIE_SECURE=true \
    TSIAN_MOCK_AUTH=false

EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/app/platform-server"]
