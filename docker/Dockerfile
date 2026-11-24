# 5e Manager — SERVER (web app + WebSocket multiplayer + pannello /admin + account con libreria schede)
#
# Build:  docker build -f docker/Dockerfile -t 5emanager-server:latest .
# Run:    vedi docker/docker-compose.yml (HTTP/LAN); per HTTPS metti il tuo reverse proxy davanti alla 3001 (docs/DOCKER.md §2)
#
# Variabili d'ambiente principali:
#   PORT (default 3001), HOST (default 0.0.0.0)
#   DND5E_DATA_DIR    -> /data (volume persistente: campagne, account, schede in libreria)
#   DND5E_STATIC_DIR  -> /app/apps/web/dist (web app buildata dentro l'immagine)
#   DND5E_ADMIN_TOKEN -> protegge /admin, /api/setup e self-update. Se MANCA, l'entrypoint
#                        ne genera uno sicuro (log + /data/admin-token.txt, chmod 600)
#   GITHUB_TOKEN      -> opzionale, solo se il repo GitHub fosse privato (check update)

FROM node:22-alpine AS build
WORKDIR /app
# manifest dei workspace (necessari a npm ci), poi sorgenti complete
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/data-srd/package.json packages/data-srd/
COPY packages/server/package.json packages/server/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY packages ./packages
COPY apps/web ./apps/web
RUN npm run build -w @dnd5e/web

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
COPY docker/entrypoint.sh /app/docker/entrypoint.sh
RUN chmod +x /app/docker/entrypoint.sh
ENV PORT=3001
ENV HOST=0.0.0.0
ENV DND5E_STATIC_DIR=/app/apps/web/dist
ENV DND5E_DATA_DIR=/data
EXPOSE 3001
VOLUME ["/data"]
# /api/info risponde {app:"5emanager",...}: usato anche dalla scansione LAN delle app
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:${PORT:-3001}/api/info >/dev/null 2>&1 || exit 1
# entrypoint: genera DND5E_ADMIN_TOKEN se mancante (setup iniziale), poi avvia il server
CMD ["sh", "/app/docker/entrypoint.sh"]
