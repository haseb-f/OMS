import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * Agents milestone error shape — `{ code, message }` with the bilingual
 * "عربي — English" message convention used across OMS business errors.
 */
function body(code: string, ar: string, en: string, extra?: object) {
  return { code, message: `${ar} — ${en}`, ...(extra ?? {}) };
}

export const agentUnprocessable = (
  code: string,
  ar: string,
  en: string,
  extra?: object,
) => new UnprocessableEntityException(body(code, ar, en, extra));

export const agentConflict = (
  code: string,
  ar: string,
  en: string,
  extra?: object,
) => new ConflictException(body(code, ar, en, extra));

export const agentBadRequest = (
  code: string,
  ar: string,
  en: string,
  extra?: object,
) => new BadRequestException(body(code, ar, en, extra));

export const agentForbidden = (
  code: string,
  ar: string,
  en: string,
  extra?: object,
) => new ForbiddenException(body(code, ar, en, extra));

export const agentNotFoundError = (what: string, whatAr: string) =>
  new NotFoundException(
    body('NOT_FOUND', `${whatAr} غير موجود`, `${what} not found.`),
  );
