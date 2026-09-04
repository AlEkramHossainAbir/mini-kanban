# syntax=docker/dockerfile:1
# Frontend ROADMAP Phase 12. Three build stages so the runner ships only the
# `.next/standalone` output `node server.js` needs — no source tree, no
# `node_modules` dev cache.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# BACKEND_URL MUST arrive as a build ARG, not only through compose's run-time
# env_file:. next.config.mjs reads it while `next build` writes the /api/v1
# rewrite destination into .next/routes-manifest.json, and the standalone
# server serves from that manifest without ever re-reading the environment
# again (verified in frontend ROADMAP Phase 2 — a value supplied only at
# `docker run` time never takes effect; the container 502s on every API call
# instead). Compose passes this via `build: args:`, matching root
# docker-compose.yml.
ARG BACKEND_URL
ENV BACKEND_URL=$BACKEND_URL
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# The image ships no .env. NEXT_PUBLIC_WS_URL is also inlined at build time
# (same Next behaviour as BACKEND_URL above), but its default of
# http://localhost:4000 already matches root docker-compose.yml's `backend`
# port mapping, so local dev needs no extra build ARG for it — only a
# non-localhost deployment (Phase 14) would need to pass it explicitly.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# No `COPY .../public` here, unlike the roadmap's template: this project has
# no public/ directory. DESIGN §8 draws every icon/illustration as inline SVG
# specifically so no static-asset or icon dependency is needed (verified —
# `ls public` 404s in the working tree), and a template COPY of a path that
# doesn't exist fails the build outright.
EXPOSE 3000
CMD ["node","server.js"]
