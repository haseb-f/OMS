/**
 * Extracts the column(s) a Prisma P2002 unique-constraint violation was
 * raised on.
 *
 * Prisma reports this in two different shapes depending on how the client is
 * constructed. The classic engine puts the columns on `meta.target`, but this
 * API runs on the `@prisma/adapter-pg` driver adapter, which instead nests
 * the Postgres error under `meta.driverAdapterError` and leaves `meta.target`
 * undefined:
 *
 *   { modelName: 'User',
 *     driverAdapterError: {
 *       cause: { kind: 'UniqueConstraintViolation',
 *                constraint: { fields: ['email'] } } } }
 *
 * Reading only `meta.target` therefore silently degraded every duplicate
 * error to the generic "value", so the message never named the offending
 * field and the frontend could not highlight the right input.
 */

interface UniqueConstraintCause {
  constraint?: { fields?: unknown; index?: unknown } | string;
}

function asStringArray(value: unknown): string[] | null {
  if (typeof value === 'string' && value) return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value;
  }
  return null;
}

/** Turns a constraint/index name such as `users_email_key` into `email`. */
function fieldFromConstraintName(name: string): string | null {
  const parts = name.split('_').filter(Boolean);
  if (parts.length < 3) return null;
  return parts.slice(1, -1).join('_') || null;
}

/** Every column named by the violated constraint, in declaration order. Empty when the shape is unrecognized. */
export function uniqueFieldsFromPrismaError(meta: unknown): string[] {
  if (typeof meta !== 'object' || meta === null) return [];
  const record = meta as Record<string, unknown>;

  const target = asStringArray(record.target);
  if (target) {
    // A single string here is a constraint name, not a column name.
    if (target.length === 1 && record.target === target[0]) {
      const derived = fieldFromConstraintName(target[0]);
      return derived ? [derived] : target;
    }
    return target;
  }

  const driverError = record.driverAdapterError as
    { cause?: UniqueConstraintCause } | undefined;
  const constraint = driverError?.cause?.constraint;
  if (typeof constraint === 'string') {
    const derived = fieldFromConstraintName(constraint);
    return derived ? [derived] : [constraint];
  }
  if (typeof constraint === 'object' && constraint !== null) {
    const fields = asStringArray(constraint.fields);
    if (fields) return fields;
    const index = asStringArray(constraint.index);
    if (index?.length === 1) {
      const derived = fieldFromConstraintName(index[0]);
      return derived ? [derived] : index;
    }
  }
  return [];
}

/** The primary conflicting column, falling back to `value` when Prisma gives us nothing usable. */
export function uniqueFieldFromPrismaError(meta: unknown): string {
  return uniqueFieldsFromPrismaError(meta)[0] ?? 'value';
}
