import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * An optional foreign-key field driven by a frontend `<Select>` — those
 * default to `""` (no option chosen), never `null`/`undefined`. Plain
 * `@IsOptional() @IsUUID()` only skips validation for `null`/`undefined`,
 * so an untouched dropdown fails with a raw "must be a UUID" error on every
 * submit. An empty string is never a legitimate UUID value (unlike an
 * ordinary optional string, "" here can only ever mean "not selected"), so
 * normalizing it to `undefined` before validation is always safe and never
 * loses a real value the way stripping "" on a free-text field would.
 */
export function IsOptionalUuid() {
  return applyDecorators(
    Transform(({ value }: { value: unknown }): unknown =>
      value === '' ? undefined : value,
    ),
    IsOptional(),
    IsUUID(),
  );
}
