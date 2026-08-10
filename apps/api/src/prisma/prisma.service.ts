import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * pg-connection-string (the driver behind @prisma/adapter-pg) changed what
 * `sslmode=require` means: it now aliases to `verify-full`'s full chain
 * validation instead of libpq's traditional "encrypt only" semantics, which
 * breaks against Supabase's pooler certificate chain ("self-signed
 * certificate in certificate chain"). `uselibpqcompat=true` restores the
 * standard libpq behavior `sslmode=require` has always documented — the
 * same encrypted-but-unverified posture Supabase's own connection strings
 * were already written for — without disabling verification outright.
 * https://www.postgresql.org/docs/current/libpq-ssl.html
 */
function withLibpqSslCompat(connectionString: string | undefined) {
  if (!connectionString || connectionString.includes('uselibpqcompat')) {
    return connectionString;
  }
  const separator = connectionString.includes('?') ? '&' : '?';
  return `${connectionString}${separator}uselibpqcompat=true`;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: withLibpqSslCompat(process.env.DATABASE_URL),
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
