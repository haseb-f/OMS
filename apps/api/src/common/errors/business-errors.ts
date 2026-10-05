import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * Business-rule failures of the R13 product / inventory / costing modules: the
 * `{ code, message }` body the AllExceptionsFilter passes through unchanged
 * (plus optional structured details), so the web can translate by `code`.
 */
export type BusinessErrorDetails = Record<string, unknown>;

/** 422 — the request is well formed but breaks a business rule. */
export function unprocessable(
  code: string,
  message: string,
  details: BusinessErrorDetails = {},
) {
  return new UnprocessableEntityException({ code, message, ...details });
}

/** 409 — the request conflicts with the current state of the record. */
export function conflict(
  code: string,
  message: string,
  details: BusinessErrorDetails = {},
) {
  return new ConflictException({ code, message, ...details });
}

/** 404 — the record does not exist (or is not visible). */
export function notFound(
  code: string,
  message: string,
  details: BusinessErrorDetails = {},
) {
  return new NotFoundException({ code, message, ...details });
}
