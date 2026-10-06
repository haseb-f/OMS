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

# R13 (2026-10-06) — database changes run ONLY for the Production deployment.
# Preview builds shared the Production database, so `migrate deploy` from a
# branch Preview applied unreleased (and later edited) migrations to
# Production (repaired by 20261007140000_r13_repair_preview_applied_migrations).
# Only an explicit `preview` / `development` VERCEL_ENV skips them; an unset
# value still migrates, so a Production build can never skip its migrations.
case "${VERCEL_ENV:-production}" in
  preview | development)
    echo "VERCEL_ENV=${VERCEL_ENV} — skipping prisma migrate deploy and data scripts (Production database untouched)."
    pnpm --filter api exec prisma generate
    ;;
  *)
    pnpm --filter api exec prisma migrate deploy
    pnpm --filter api exec prisma generate

    # Never fails the build — an idempotent, additive-only step (see the
    # script's own doc comment). If it errors, the rest of the deploy must
    # still proceed; Production stays deployable either way.
    pnpm --filter api exec ts-node prisma/provision-permissions.ts \
      || echo "provision-permissions.ts failed (non-fatal) — see above."

    # O3 (one phone number = one customer) — keys existing partner numbers;
    # idempotent and additive, duplicates are only reported. Non-fatal, same
    # rule as above.
    pnpm --filter api exec ts-node prisma/scripts/backfill-partner-phone-keys.ts \
      || echo "backfill-partner-phone-keys.ts failed (non-fatal) — see above."

    if [ -n "${QA_PASSWORD:-}" ]; then
      pnpm --filter api exec ts-node prisma/scripts/ensure-qa-users.ts \
        || echo "ensure-qa-users.ts failed (non-fatal) — see above."
    fi
    ;;
esac

pnpm --filter web run build
