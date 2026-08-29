import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsOptional, IsUUID } from 'class-validator';

/** Accepts `A`, `A,B`, or `['A','B']` from query strings. */
export function toEnumList(value: unknown): string[] | undefined {
  if (value == null || value === '') return undefined;
  const parts = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const cleaned = parts
    .map(String)
    .map((part) => part.trim())
    .filter(Boolean);
  return cleaned.length ? cleaned : undefined;
}

export function TransformEnumList(): PropertyDecorator {
  return Transform(({ value }) => toEnumList(value));
}

export function prismaEnumFilter<T extends string>(
  value: T | T[] | undefined,
): T | { in: T[] } | undefined {
  if (value == null) return undefined;
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];
  return { in: list };
}

export function IsOptionalUuidList() {
  return applyDecorators(
    TransformEnumList(),
    IsOptional(),
    IsUUID(undefined, { each: true }),
  );
}
