#!/usr/bin/env bash
# Prepares the clean demonstration database for the manual (local Docker Postgres oms-postgres :5434).
#   bash docs/user-manual/build/prepare-db.sh
# Creates oms_r14_manual, migrates, provisions permissions, runs the dev seed with EGP as base currency,
# removes the seed's English/test business records, turns admin@oms.local into the super-admin persona
# admin@oms-demo.local and retires the other seed users. The persona password is generated here and
# stored ONLY in tmp/r14-manual/.env (git-ignored) — it is never printed or committed.
set -euo pipefail
ROOT=D:/Systems/OMS
DB=oms_r14_manual
export DATABASE_URL="postgresql://oms:oms@localhost:5434/${DB}?schema=public"
mkdir -p "$ROOT/tmp/r14-manual"

docker exec oms-postgres psql -U oms -d postgres -c "CREATE DATABASE ${DB}"
cd "$ROOT/apps/api"
pnpm exec prisma migrate deploy
pnpm exec ts-node prisma/provision-permissions.ts
SEED_BASE_CURRENCY=EGP pnpm exec ts-node prisma/seed.ts
docker exec -i oms-postgres psql -U oms -d "$DB" -v ON_ERROR_STOP=1 < "$ROOT/docs/user-manual/build/sql/cleanup-seed-demo.sql"

PW="Demo-$(node -e "console.log(require('crypto').randomBytes(6).toString('base64url'))")9!"
printf 'MANUAL_PW=%s\nAPI=http://localhost:3005\nWEB=http://localhost:3001\nDB=%s\n' "$PW" "$DB" > "$ROOT/tmp/r14-manual/.env"
H=$(node -e "console.log(require('bcryptjs').hashSync(process.argv[1],10))" "$PW")
docker exec oms-postgres psql -U oms -d "$DB" -c "update users set email='admin@oms-demo.local', username='admin', full_name='أحمد سالم', is_super_admin=true, password_hash='$H', must_change_password=false where email='admin@oms.local'; update users set deleted_at=now(), is_active=false where email like '%@oms.local';"
echo "database ${DB} ready; persona password stored in tmp/r14-manual/.env"
