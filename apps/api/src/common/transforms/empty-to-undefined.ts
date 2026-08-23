import type { TransformFnParams } from 'class-transformer';

/** Treat blank strings as omitted optional fields so `@IsOptional` can pass. */
export function emptyToUndefined({ value }: TransformFnParams): unknown {
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}

export function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}
