import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

/**
 * Vercel Cron authentication. Vercel sends "Authorization: Bearer
 * <CRON_SECRET>" when that env var is set; without it every cron endpoint
 * refuses to run rather than exposing an unauthenticated trigger.
 * Timing-safe comparison.
 */
export function assertCronAuthorized(authorization: string | undefined): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new ServiceUnavailableException('CRON_SECRET is not configured.');
  }
  const expected = Buffer.from('Bearer ' + secret);
  const received = Buffer.from(authorization ?? '');
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    throw new UnauthorizedException();
  }
}
