import { applyDecorators } from '@nestjs/common';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * R13 B2 — optional client-generated idempotency key (one per opened form,
 * e.g. `crypto.randomUUID()`). Repeating a create with the same key returns
 * the first document; the same key with a different payload is a 409.
 */
export function IsIdempotencyKey() {
  return applyDecorators(
    IsOptional(),
    IsString(),
    MaxLength(100),
    Matches(/^[A-Za-z0-9_-]+$/, {
      message: 'idempotencyKey may contain only letters, digits, "-" and "_".',
    }),
  );
}
