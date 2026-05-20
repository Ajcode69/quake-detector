# ── Stage 1: Base image with system dependencies ────────────
FROM node:20-alpine AS base
RUN apk add --no-cache openssl postgresql-client
WORKDIR /app

# ── Stage 2: Builder to compile node_modules and Prisma ─────
FROM base AS builder
COPY package.json package-lock.json prisma.config.ts ./
COPY shared/db/schema ./shared/db/schema
# Install all dependencies including devDependencies (needed for Prisma CLI)
RUN npm ci
# Set a dummy DATABASE_URL so prisma configuration does not crash during client generation
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npx prisma generate

# ── Stage 3: Ingestion service runner ───────────────────────
FROM base AS ingestion
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY shared ./shared
COPY apps/ingestion ./apps/ingestion
CMD ["node", "apps/ingestion/src/index.js"]

# ── Stage 4: API Express HTTP service runner ────────────────
FROM base AS api
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY shared ./shared
COPY apps/api ./apps/api
EXPOSE 3000
CMD ["node", "apps/api/src/index.js"]

# ── Stage 5: Cron background worker service runner ──────────
FROM base AS cron
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY shared ./shared
COPY apps/api ./apps/api
CMD ["node", "apps/api/src/cron.js"]

# ── Stage 6: Frontend web builder ───────────────────────────
FROM node:20-alpine AS web-builder
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json ./apps/web/
RUN cd apps/web && npm ci
COPY apps/web ./apps/web
# Accept build-time API URL
ARG VITE_API_URL="http://localhost:3000"
ENV VITE_API_URL=$VITE_API_URL
RUN cd apps/web && npm run build

# ── Stage 7: Frontend web runner (Nginx) ────────────────────
FROM nginx:alpine AS web
COPY --from=web-builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
