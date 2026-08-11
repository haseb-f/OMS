/**
 * The one error envelope every API response uses — lets the frontend map a
 * `code` to a friendly, localized message instead of ever showing a raw
 * class-validator/Prisma string. `fields` carries per-field detail for
 * VALIDATION_ERROR/DUPLICATE so the frontend can point at the exact input.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'PERMISSION_ERROR'
  | 'NOT_FOUND'
  | 'DUPLICATE'
  | 'SERVER_ERROR'
  | 'DATABASE_ERROR'
  | 'DEPENDENCY_ERROR';

export interface ErrorFieldDetail {
  field: string;
  constraints: string[];
}

export interface ErrorResponseBody {
  code: ErrorCode;
  message: string;
  fields?: ErrorFieldDetail[];
}
