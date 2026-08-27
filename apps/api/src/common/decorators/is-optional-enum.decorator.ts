import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';

/**
 * An optional enum field driven by a frontend `<Select>` — those default to
 * `""` (no option chosen), never `null`/`undefined`, same reasoning as
 * `IsOptionalUuid`. Plain `@IsOptional() @IsEnum(...)` only skips validation
 * for `null`/`undefined`, so an untouched dropdown fails with a raw "must be
 * one of the following values" error on every submit.
 */
export function IsOptionalEnum(entity: object) {
  return applyDecorators(
    Transform(({ value }: { value: unknown }): unknown =>
      value === '' ? undefined : value,
    ),
    IsOptional(),
    IsEnum(entity),
  );
}
