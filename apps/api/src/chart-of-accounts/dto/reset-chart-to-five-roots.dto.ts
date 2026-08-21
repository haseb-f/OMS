import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * Explicit confirmation required for the destructive
 * "reset Chart of Accounts to five roots" apply path.
 */
export class ResetChartToFiveRootsDto {
  /**
   * Must be exactly `RESET_CHART_TO_FIVE_ROOTS` for apply.
   * Preview/dry-run may omit this.
   */
  @IsString()
  @IsOptional()
  confirm?: string;

  @Transform(({ value }: { value: unknown }) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  @IsOptional()
  dryRun?: boolean;
}

export const RESET_CHART_CONFIRM_TOKEN = 'RESET_CHART_TO_FIVE_ROOTS';
