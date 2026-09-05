# syntax=docker/dockerfile:1
# Backend ROADMAP Phase 12. Three build stages so the runner carries no build
# cache and no source tree — only what `node dist/main.js` actually needs.

# Prisma's query engine links against OpenSSL, which the -slim images don't
# ship. It has to be present in *every* stage, not just the runner: `prisma
# generate` picks its engine binary by sniffing the platform at build time,
# and without libssl it resolves a different target than the one the app then
# looks for at startup ("could not locate the Query Engine for runtime
# linux-arm64-openssl-3.0.x").
FROM node:20-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package*.json ./
# The full dependency set, dev included, on purpose: the runner shells out to
# the Prisma CLI for `migrate deploy`, and that CLI is a devDependency.
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma.config.ts resolves DATABASE_URL the moment the CLI loads it, and code
# generation never opens a connection — so a syntactically valid placeholder
# satisfies it here. Build-stage only; the real value arrives from the
# environment at run time and is never baked into an image.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=public"
RUN npx prisma generate && npm run build

FROM base AS runner
ENV NODE_ENV=production
# --chown, not a bare COPY: the Prisma CLI writes into
# node_modules/@prisma/engines when `migrate deploy` runs, so a root-owned
# tree would make the container exit at startup under the non-root USER below.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --chown=node:node prisma.config.ts ./
COPY --chown=node:node package*.json ./
# No compiled output of its own — ts-node reads this directly. Only needed so
# `docker compose exec backend npm run db:seed` (prisma/seed.ts, plain
# ts-node, no path aliases) has compiler options to run against; not read by
# `node dist/main.js` itself.
COPY --chown=node:node tsconfig.json ./
# The image ships no .env — every variable in ROADMAP Phase 13 arrives from
# the environment (docker compose's env_file, or the host's dashboard).
USER node
EXPOSE 4000
# Migrations replay from the container's own CMD (never `db push`, never by
# hand) so a fresh `docker compose up --build` needs no manual step.
CMD ["sh","-c","npx prisma migrate deploy && node dist/main.js"]
