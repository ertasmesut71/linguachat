# ═══════════════════════════════════════════════
# LinguaChat — Production Dockerfile
# ═══════════════════════════════════════════════

# ─── Stage 1: Dependencies ───
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
COPY client/package.json ./client/
RUN npm install --production=false
RUN cd client && npm install

# ─── Stage 2: Generate Prisma client ───
FROM deps AS prisma
COPY server/db/prisma/schema.prisma ./server/db/prisma/
RUN npx prisma generate --schema=server/db/prisma/schema.prisma

# ─── Stage 3: Build client ───
FROM prisma AS builder
COPY client/ ./client/
RUN cd client && npx vite build

# ─── Stage 4: Production ───
FROM node:20-alpine AS runner
RUN apk add --no-cache tini ffmpeg
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Production dependencies — sharp needs its native platform binary,
# so we cannot use --ignore-scripts here.
COPY package.json ./
RUN npm install --production

# Prisma client + schema (needed for migrations at runtime)
COPY --from=prisma /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=prisma /app/node_modules/@prisma ./node_modules/@prisma
COPY server/db/prisma/ ./server/db/prisma/

# Server source
COPY server/ ./server/

# Built client
COPY --from=builder /app/client/dist ./client/dist

# Entrypoint script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Data directory
RUN mkdir -p /app/server/data/uploads /app/logs && chown -R node:node /app

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["./docker-entrypoint.sh"]
