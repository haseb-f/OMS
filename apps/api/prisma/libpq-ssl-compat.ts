/**
 * pg-connection-string treats `sslmode=require` as `verify-full`, which
 * fails against Supabase's pooler chain. `uselibpqcompat=true` restores
 * libpq encrypt-only semantics. Duplicated into PrismaService as well
 * because Nest scripts cannot always import this file from `src/`.
 */
export function withLibpqSslCompat(connectionString: string | undefined) {
  if (!connectionString || connectionString.includes('uselibpqcompat')) {
    return connectionString;
  }
  const separator = connectionString.includes('?') ? '&' : '?';
  return `${connectionString}${separator}uselibpqcompat=true`;
}
