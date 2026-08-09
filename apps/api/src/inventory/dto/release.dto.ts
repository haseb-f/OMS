import { IsOptional, IsString, IsUUID } from 'class-validator';
import { BaseQuantityMovementDto } from './base-quantity-movement.dto';

export class ReleaseDto extends BaseQuantityMovementDto {
  /** Sales Foundation (TASK-037) — same optional reference pair as ReserveDto. */
  @IsString()
  @IsOptional()
  referenceType?: string;

  @IsUUID()
  @IsOptional()
  referenceId?: string;
}
