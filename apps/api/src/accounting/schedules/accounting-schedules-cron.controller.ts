import {
  Controller,
  Get,
  Headers,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { AccountingSchedulesService } from './accounting-schedules.service';

/**
 * Vercel Cron target. Vercel sends "Authorization: Bearer <CRON_SECRET>"
 * when that env var is set; without it the endpoint refuses to run rather
 * than exposing an unauthenticated posting trigger.
 */
@Controller('cron')
export class AccountingSchedulesCronController {
  constructor(private readonly schedules: AccountingSchedulesService) {}

  @Get('accounting-schedules')
  run(@Headers('authorization') authorization?: string) {
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
    return this.schedules.runDue();
  }
}
