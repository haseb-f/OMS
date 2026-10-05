import { IsOptional, Matches } from 'class-validator';
import type { Prisma } from '@prisma/client';

const OWNER_PATTERN =
  /^(COMPANY|AGENT|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * `owner` query of the stock reads (api-contract §5): `COMPANY` (company-owned
 * stock), `AGENT` (any agent's stock) or one agent id. Omitted = everything,
 * with the owner shown on every row.
 */
export class OwnerFilterQueryDto {
  @IsOptional()
  @Matches(OWNER_PATTERN, {
    message: 'owner must be COMPANY, AGENT or an agent id.',
  })
  owner?: string;
}

/** The `ownerAgentId` condition of an `owner` filter (undefined = no filter). */
export function ownerAgentCondition(
  owner?: string,
): Prisma.StringNullableFilter | null | undefined {
  if (!owner) return undefined;
  const value = owner.toUpperCase();
  if (value === 'COMPANY') return null;
  if (value === 'AGENT') return { not: null };
  return { equals: owner.toLowerCase() };
}
