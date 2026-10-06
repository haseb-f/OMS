/**
 * R13 scripts — one READ-ONLY database client. Every session is opened with
 * `default_transaction_read_only=on`, so a script can never write (PostgreSQL
 * rejects any INSERT/UPDATE/DELETE/DDL). The local main development database
 * `oms` is refused outright, and a non-local host needs `--allow-remote`
 * (owner-run, read-only reconciliation only).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function describeDatabase(url: string): {
  host: string;
  database: string;
} {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
  };
}

export function assertAllowedDatabase(
  url: string | undefined,
  options: { allowRemote: boolean },
): { host: string; database: string } {
  if (!url) {
    throw new Error(
      'DATABASE_URL is required (pass it explicitly — the .env default is never used).',
    );
  }
  const target = describeDatabase(url);
  if (target.database === 'oms' && LOCAL_HOSTS.has(target.host)) {
    throw new Error(
      'Refusing the local main database "oms" — point DATABASE_URL at a clone (e.g. oms_r13).',
    );
  }
  if (!LOCAL_HOSTS.has(target.host) && !options.allowRemote) {
    throw new Error(
      `Refusing non-local host "${target.host}" without --allow-remote (read-only owner run only).`,
    );
  }
  return target;
}

export function readOnlyClient(url: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url,
      options: '-c default_transaction_read_only=on',
    }),
  });
}

/** `--name=value` / `--flag` argument reader. */
export function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found?.slice(prefix.length);
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
