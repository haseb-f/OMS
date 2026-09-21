import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional } from 'class-validator';

/**
 * Email is optional on every party (customer, supplier, investor): a blank
 * field means "no email", never an invalid one. Blank normalizes to `null`
 * (so an update can clear a stored email); a provided value is trimmed and
 * must be a valid address.
 */
export function IsOptionalEmail() {
  return applyDecorators(
    Transform(({ value }: { value: unknown }): unknown => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    }),
    IsOptional(),
    IsEmail(),
  );
}
