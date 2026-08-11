import { IsOptional, IsString } from 'class-validator';
import { BaseQuantityMovementDto } from './base-quantity-movement.dto';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class ReleaseDto extends BaseQuantityMovementDto {
  /** Sales Foundation (TASK-037) — same optional reference pair as ReserveDto. */
  @IsString()
  @IsOptional()
  referenceType?: string;

  @IsOptionalUuid()
  referenceId?: string;
}
