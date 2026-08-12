import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

const SYNC_SOURCE_TYPES = [
  'LEADS',
  'STORE_ORDERS',
  'CASH_FLOW',
  'SHIPPING_UPDATES',
] as const;
export type SyncSourceTypeInput = (typeof SYNC_SOURCE_TYPES)[number];

export class CreateSyncSourceDto {
  @IsIn(SYNC_SOURCE_TYPES)
  sourceType!: SyncSourceTypeInput;

  /** Module name (Leads/Store Orders) or provider name (Cash Flow — "Al Rajhi", "Tabby", ...). */
  @IsString()
  @IsNotEmpty()
  label!: string;

  /** Any Google Sheets share/edit URL — same format `Upload from Google Sheets` already accepts. */
  @IsString()
  @IsNotEmpty()
  spreadsheetUrl!: string;

  /** `{ [handlerFieldKey]: sourceColumnHeader }` — the same shape `SetMappingDto.columnMapping` uses. */
  @IsObject()
  columnMapping!: Record<string, string>;

  @IsOptional()
  @IsObject()
  configMetadata?: Record<string, unknown>;
}
