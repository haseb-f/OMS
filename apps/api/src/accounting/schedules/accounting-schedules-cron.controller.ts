import { Controller, Get, Headers } from '@nestjs/common';
import { assertCronAuthorized } from '../../common/cron/assert-cron-authorized';
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
    assertCronAuthorized(authorization);
    return this.schedules.runDue();
  }
}
