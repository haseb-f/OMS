/**
 * R14 W2 — migration parity proof for job-title templates + individual
 * overrides (spec-2 §A "every user's effective set is byte-identical
 * before/after") and the shipping.assign_carrier / *.manage_permissions grants.
 *
 *   # before `prisma migrate deploy` (old resolver formula, inline copy):
 *   pnpm --dir apps/api exec ts-node scripts/r14/w2-permission-parity.ts --mode=before --out=<before.json>
 *   # after the migration (new formula: computeEffectivePermissions):
 *   pnpm --dir apps/api exec ts-node scripts/r14/w2-permission-parity.ts --mode=after --out=<after.json>
 *   # compare (no database access):
 *   pnpm --dir apps/api exec ts-node scripts/r14/w2-permission-parity.ts --mode=compare --before=<before.json> --after=<after.json>
 *
 * Read-only sessions on a local clone only (never the main `oms` database).
 * `compare` exits 1 unless, for every user, after − before ⊆ the three new
 * permissions (each granted only to its intended holders) and before − after = ∅.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import {
  arg,
  assertAllowedDatabase,
  readOnlyClient,
} from '../r13/read-only-db';
import {
  isAgentPortalPermission,
  withAuthorizationImpliedPermissions,
  withSettingsDomainGrants,
} from '../../src/permissions/permission-catalog';
import { computeEffectivePermissions } from '../../src/permissions/effective-permissions';

type Snapshot = Record<string, string[]>;

interface UserRow {
  id: string;
  user_type: string;
  agent_role: string | null;
  job_title_id: string | null;
}

/** Exact copy of the pre-R14 resolver formula (permissions-resolver.service.ts @3330fe8e). */
function legacyEffective(user: UserRow, stored: string[]): Set<string> {
  if (user.user_type === 'AGENT') {
    return new Set(
      stored.filter(
        (name) =>
          isAgentPortalPermission(name) &&
          (name !== 'agent.team.manage' || user.agent_role === 'ADMIN'),
      ),
    );
  }
  return new Set(
    withSettingsDomainGrants(
      withAuthorizationImpliedPermissions(
        stored.filter((name) => !isAgentPortalPermission(name)),
      ),
    ),
  );
}

function groupBy<T extends { key: string; name: string }>(rows: T[]) {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.key) ?? [];
    list.push(row.name);
    map.set(row.key, list);
  }
  return map;
}

async function snapshot(mode: 'before' | 'after'): Promise<Snapshot> {
  const url = process.env.DATABASE_URL;
  assertAllowedDatabase(url, { allowRemote: false });
  const prisma = readOnlyClient(url!);
  try {
    const users = await prisma.$queryRawUnsafe<UserRow[]>(
      `SELECT id::text, user_type::text, agent_role::text, job_title_id::text
         FROM users ORDER BY id`,
    );
    const result: Snapshot = {};
    if (mode === 'before') {
      const rows = await prisma.$queryRawUnsafe<
        { key: string; name: string }[]
      >(
        `SELECT up.user_id::text AS key, p.name
           FROM user_permissions up JOIN permissions p ON p.id = up.permission_id`,
      );
      const stored = groupBy(rows);
      for (const user of users) {
        result[user.id] = [
          ...legacyEffective(user, stored.get(user.id) ?? []),
        ].sort();
      }
      return result;
    }
    const grants = groupBy(
      await prisma.$queryRawUnsafe<{ key: string; name: string }[]>(
        `SELECT up.user_id::text AS key, p.name
           FROM user_permissions up JOIN permissions p ON p.id = up.permission_id
          WHERE up.effect = 'GRANT'`,
      ),
    );
    const denies = groupBy(
      await prisma.$queryRawUnsafe<{ key: string; name: string }[]>(
        `SELECT up.user_id::text AS key, p.name
           FROM user_permissions up JOIN permissions p ON p.id = up.permission_id
          WHERE up.effect = 'DENY'`,
      ),
    );
    const templates = groupBy(
      await prisma.$queryRawUnsafe<{ key: string; name: string }[]>(
        `SELECT jtp.job_title_id::text AS key, p.name
           FROM job_title_permissions jtp JOIN permissions p ON p.id = jtp.permission_id`,
      ),
    );
    for (const user of users) {
      const isAgentUser = user.user_type === 'AGENT';
      result[user.id] = [
        ...computeEffectivePermissions({
          isAgentUser,
          agentRole: user.agent_role,
          template:
            !isAgentUser && user.job_title_id
              ? (templates.get(user.job_title_id) ?? [])
              : [],
          grants: grants.get(user.id) ?? [],
          denies: denies.get(user.id) ?? [],
        }),
      ].sort();
    }
    return result;
  } finally {
    await prisma.$disconnect();
  }
}

/** New permission → the effective permissions that qualified a user for it. */
const NEW_GRANTS: Record<string, string[]> = {
  'shipping.assign_carrier': ['shipping.edit', 'shipping.manage'],
  'job-titles.manage_permissions': ['settings.manage'],
  'users.manage_permissions': ['settings.manage'],
};
/** Section keys a new grant implies (e.g. shipping.assign_carrier → shipping.view). */
const IMPLIED_BY_NEW = new Set(['shipping.view']);

function compare(before: Snapshot, after: Snapshot): number {
  let failures = 0;
  let identical = 0;
  let changed = 0;
  const gainedCounts: Record<string, number> = {};
  const userIds = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const id of userIds) {
    const b = new Set(before[id] ?? []);
    const a = new Set(after[id] ?? []);
    const lost = [...b].filter((name) => !a.has(name));
    const gained = [...a].filter((name) => !b.has(name));
    if (lost.length === 0 && gained.length === 0) {
      identical += 1;
      continue;
    }
    changed += 1;
    if (lost.length > 0) {
      failures += 1;
      console.error(`FAIL ${id}: lost ${lost.join(', ')}`);
    }
    for (const name of gained) {
      gainedCounts[name] = (gainedCounts[name] ?? 0) + 1;
      const qualifying = NEW_GRANTS[name];
      const ok = qualifying
        ? qualifying.some((source) => b.has(source))
        : IMPLIED_BY_NEW.has(name) && gained.some((g) => NEW_GRANTS[g]);
      if (!ok) {
        failures += 1;
        console.error(`FAIL ${id}: unexpected gain ${name}`);
      }
    }
  }
  // Every qualifying holder must have received each new grant.
  for (const [name, sources] of Object.entries(NEW_GRANTS)) {
    for (const id of Object.keys(before)) {
      const b = new Set(before[id]);
      if (sources.some((s) => b.has(s)) && !(after[id] ?? []).includes(name)) {
        failures += 1;
        console.error(`FAIL ${id}: qualifying holder missing ${name}`);
      }
    }
  }
  console.log(
    JSON.stringify(
      {
        users: userIds.size,
        identical,
        changedOnlyByNewGrants: changed - failures,
        gainedCounts,
        failures,
      },
      null,
      2,
    ),
  );
  return failures;
}

async function main() {
  const mode = arg('mode');
  if (mode === 'compare') {
    const before = JSON.parse(readFileSync(arg('before')!, 'utf8')) as Snapshot;
    const after = JSON.parse(readFileSync(arg('after')!, 'utf8')) as Snapshot;
    process.exitCode = compare(before, after) > 0 ? 1 : 0;
    return;
  }
  if (mode !== 'before' && mode !== 'after') {
    throw new Error('--mode=before|after|compare is required');
  }
  const result = await snapshot(mode);
  writeFileSync(arg('out')!, JSON.stringify(result, null, 1));
  console.log(
    `${mode}: ${Object.keys(result).length} users, ${Object.values(result).reduce((n, list) => n + list.length, 0)} effective permission entries`,
  );
}

void main();
