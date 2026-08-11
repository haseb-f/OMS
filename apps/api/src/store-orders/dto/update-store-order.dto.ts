import { IsOptional, IsString } from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/**
 * Deliberately narrow — `items`/`customerId`/`externalOrderId` are never
 * editable after creation (they drive payment-status math and dedup
 * identity). Only operational metadata can change post-creation.
 */
export class UpdateStoreOrderDto {
  @IsString()
  @IsOptional()
  notes?: string;

  @IsOptionalUuid()
  employeeId?: string;

  @IsString()
  @IsOptional()
  sourceChannel?: string;
}
