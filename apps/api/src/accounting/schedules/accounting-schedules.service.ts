import { Injectable, Logger } from '@nestjs/common';
import { FixedAssetsService } from '../../fixed-assets/fixed-assets.service';
import { PrepaidExpensesService } from '../../prepaid-expenses/prepaid-expenses.service';

/**
 * Posts every depreciation period and prepaid recognition that has fallen
 * due. Safe to run any number of times: each row flips to POSTED in the
 * same transaction as its JE, the Posting Engine skips a source that
 * already has a posted entry, and a failing row (locked period, missing
 * mapping) is recorded on the row and retried on the next run.
 */
@Injectable()
export class AccountingSchedulesService {
  private readonly logger = new Logger(AccountingSchedulesService.name);

  constructor(
    private readonly fixedAssets: FixedAssetsService,
    private readonly prepaidExpenses: PrepaidExpensesService,
  ) {}

  async runDue(asOf?: string, userId?: string) {
    const depreciation = await this.fixedAssets.runDepreciation(
      { asOf },
      userId,
    );
    const prepaid = await this.prepaidExpenses.recognize({ asOf }, userId);
    const failed = depreciation.failedCount + prepaid.failedCount;
    if (failed > 0) {
      this.logger.warn(
        `Accounting schedules: ${failed} due row(s) could not be posted.`,
      );
    }
    return {
      asOf: depreciation.asOf,
      depreciation: {
        posted: depreciation.postedCount,
        failed: depreciation.failedCount,
        failures: depreciation.failures,
      },
      prepaid: {
        posted: prepaid.postedCount,
        failed: prepaid.failedCount,
        failures: prepaid.failures,
      },
    };
  }
}
