import {
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateSyncSourceDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  spreadsheetUrl?: string;

  @IsOptional()
  @IsObject()
  columnMapping?: Record<string, string>;

  @IsOptional()
  @IsObject()
  configMetadata?: Record<string, unknown>;
}
