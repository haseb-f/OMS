#!/usr/bin/env bash
# ADR-0018 (M2 gap closure) — the full Production build pipeline, kept in a
# repo script rather than inlined in vercel.json's buildCommand. That field
# is capped at 256 characters by Vercel's own project-config schema; the
# multi-step command (migrate deploy + generate + provision-permissions +
# web build) crosses that limit, which fails config validation before the
# build container even starts — no build log is ever produced, which is
# why several earlier attempts to inline the whole thing here were
# undiagnosable failures. `vercel.json`'s buildCommand stays a short,
# stable call into this script instead.
set -euo pipefail

export DATABASE_URL="$POSTGRES_URL_NON_POOLING"

pnpm --filter api exec prisma migrate deploy
pnpm --filter api exec prisma generate

# Never fails the build — an idempotent, additive-only step (see the
# script's own doc comment). If it errors, the rest of the deploy must
# still proceed; Production stays deployable either way.
pnpm --filter api exec ts-node prisma/provision-permissions.ts \
  || echo "provision-permissions.ts failed (non-fatal) — see above."

if [ -n "${QA_PASSWORD:-}" ]; then
  pnpm --filter api exec ts-node prisma/scripts/ensure-qa-users.ts \
    || echo "ensure-qa-users.ts failed (non-fatal) — see above."
fi

pnpm --filter web run build
