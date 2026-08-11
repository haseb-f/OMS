import type { ValidationError } from 'class-validator';
import type { ErrorFieldDetail } from './error-response.types';

/**
 * Flattens class-validator's nested `ValidationError[]` (one entry per
 * property, with `children` for nested DTOs) into the flat `field`/
 * `constraints` shape `ErrorResponseBody.fields` carries to the frontend —
 * dotted paths for nested fields (e.g. `items.0.productId`).
 */
export function formatValidationErrors(
  errors: ValidationError[],
  prefix = '',
): ErrorFieldDetail[] {
  const out: ErrorFieldDetail[] = [];
  for (const error of errors) {
    const field = prefix ? `${prefix}.${error.property}` : error.property;
    if (error.constraints) {
      out.push({ field, constraints: Object.values(error.constraints) });
    }
    if (error.children?.length) {
      out.push(...formatValidationErrors(error.children, field));
    }
  }
  return out;
}
