import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';

/** Agents whose figures one cross-agent overview call returns (a list page at most). */
export const AGENTS_OVERVIEW_MAX_IDS = 50;

export class AgentsOverviewQueryDto {
  /** Comma-separated (or repeated) agent ids — the agents shown on the caller's list page. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(AGENTS_OVERVIEW_MAX_IDS)
  @IsUUID('all', { each: true })
  @IsOptional()
  ids?: string[];
}
