import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { BULK_LIMITS } from '../../common/bulk/bulk-limits';

export class BulkChangeLeadStatusDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_LIMITS.leadStatusChangeMax)
  @IsUUID('4', { each: true })
  leadIds!: string[];

  @IsString()
  statusCode!: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
