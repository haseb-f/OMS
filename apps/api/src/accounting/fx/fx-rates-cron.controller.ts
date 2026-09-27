import { Controller, Get, Headers } from '@nestjs/common';
import { assertCronAuthorized } from '../../common/cron/assert-cron-authorized';
import { FxSyncService } from './fx-sync.service';

/**
 * Vercel Cron target for the automatic official FX import (twice daily, see
 * vercel.json). Authenticated exactly like /cron/accounting-schedules: the
 * CRON_SECRET bearer, timing-safe, refusing to run when unset. Respects
 * FxSyncSettings.enabled (disabled ⇒ a SKIPPED run is recorded).
 */
@Controller('cron')
export class FxRatesCronController {
  constructor(private readonly sync: FxSyncService) {}

  @Get('fx-rates')
  async run(@Headers('authorization') authorization?: string) {
    assertCronAuthorized(authorization);
    const run = await this.sync.runScheduled();
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
