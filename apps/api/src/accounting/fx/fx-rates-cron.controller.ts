import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Query,
} from '@nestjs/common';
import { assertCronAuthorized } from '../../common/cron/assert-cron-authorized';
import { FX_CRON_SLOTS, FxSyncService } from './fx-sync.service';

/**
 * Vercel Cron target for the automatic official FX import (twice daily, see
 * vercel.json): the default slot is the daily import; `?slot=late` is the
 * evening catch-up that only fetches when today's rate is still missing. Authenticated exactly like /cron/accounting-schedules: the
 * CRON_SECRET bearer, timing-safe, refusing to run when unset. Respects
 * FxSyncSettings.enabled (disabled ⇒ a SKIPPED run is recorded).
 */
@Controller('cron')
export class FxRatesCronController {
  constructor(private readonly sync: FxSyncService) {}

  @Get('fx-rates')
  async run(
    @Headers('authorization') authorization?: string,
    @Query('slot') slot?: string,
  ) {
    assertCronAuthorized(authorization);
    if (
      slot !== undefined &&
      !(FX_CRON_SLOTS as readonly string[]).includes(slot)
    ) {
      throw new BadRequestException(
        `Unknown slot "${slot}" — expected one of ${FX_CRON_SLOTS.join(', ')}.`,
      );
    }
    const run = await this.sync.runScheduled(
      slot === 'late' ? 'late' : 'primary',
    );
    return {
      id: run.id,
      status: run.status,
      effectiveDate: run.effectiveDate,
      fetchedCount: run.fetchedCount,
      insertedCount: run.insertedCount,
      skippedCount: run.skippedCount,
      error: run.error,
    };
  }
}
