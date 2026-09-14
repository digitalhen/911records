# Multi-stage build for the 911records.nyc Next.js app (web/). Build context
# is web/ (see docker-compose.yml); this file lives at the repo root per
# docs/PLAN.md workstream B1 so it sits beside docker-compose.yml.
#
# node:22-bookworm-slim, not alpine: better-sqlite3 is a native addon and
# needs glibc + build tools to compile against the Node headers reliably.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SITE_URL=https://911records.nyc
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# Reported by /api/health as `commit`. Never guessed: unset must read as
# unset (see app/api/health/route.ts), not as a build the promote logic
# mistakes for something it isn't.
ARG GIT_SHA=
ENV GIT_SHA=$GIT_SHA
RUN groupadd -r app && useradd -r -g app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
CMD ["node", "server.js"]
