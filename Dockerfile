# Multi-stage build for the 911records.org Next.js app (web/). Build context
# is web/ (see docker-compose.yml); this file lives at the repo root per
# docs/PLAN.md workstream B1 so it sits beside docker-compose.yml.
#
# node:22-alpine: the app's only DB driver is `pg` (pure JS, no native
# addon), so there's no need for glibc + build tools the way a native module
# like better-sqlite3 would have required — this app has no local data
# dependency at all (see docs/PLAN.md's HA note: two Dokploy replicas, no
# bind mount; derived data comes from Postgres, files from the `files`
# service over HTTP).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SITE_URL=https://911records.org
# NEXT_PUBLIC_GA_ID's default is deliberately NON-EMPTY, the live measurement
# id, because for this flag UNSET MUST MEAN UNCHANGED (see ~/Code/prospect's
# issue #982, the pattern this follows). A `||` fallback in lib/analytics.ts
# would mean the field an operator types into Dokploy reaches nothing and the
# tracker can never be turned off; the default lives here instead, so the
# switch is reachable without being thrown. Empty (or `off`) means no tag at
# all — see web/lib/analytics.ts.
#
# The non-empty default is also why docker-compose.yml passes this one
# through as the BARE `NEXT_PUBLIC_GA_ID:` form and not `${NEXT_PUBLIC_GA_ID:-}`
# like NEXT_PUBLIC_SITE_URL above: `:-` renders an explicit empty string that
# would OVERRIDE this default and silently turn analytics off. See the
# comment in docker-compose.yml.
ARG NEXT_PUBLIC_GA_ID=G-7143D6VVVR
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_GA_ID=$NEXT_PUBLIC_GA_ID \
    NEXT_TELEMETRY_DISABLED=1
# Build-time DB access is not required: every page here is force-dynamic, so
# next build never queries Postgres. A dummy value just keeps `pg` from
# throwing on module init if some import path evaluates it eagerly.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# Reported by /api/health as `commit`. Never guessed: unset must read as
# unset (see app/api/health/route.ts), not as a build the promote logic
# mistakes for something it isn't.
ARG GIT_SHA=
ENV GIT_SHA=$GIT_SHA
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
CMD ["node", "server.js"]
