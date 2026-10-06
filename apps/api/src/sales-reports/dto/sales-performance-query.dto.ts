import { IsIn, IsOptional, Matches } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `GET /sales-reports/performance` (and the agent-portal copy). */
export class SalesPerformanceQueryDto {
  /** Inclusive business date (Africa/Cairo), "YYYY-MM-DD". Default: 1st of this month. */
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  /** Inclusive business date (Africa/Cairo), "YYYY-MM-DD". Default: today. */
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  /** Valid-order count (default) or valid amount within `currency`. */
  @IsOptional()
  @IsIn(['count', 'amount'])
  rankBy?: 'count' | 'amount';

  /** Order currency code (e.g. EGP) — required when rankBy=amount. */
  @IsOptional()
  @Matches(/^[A-Za-z0-9]{2,12}$/, {
    message: 'currency must be a currency code',
  })
  currency?: string;
}
