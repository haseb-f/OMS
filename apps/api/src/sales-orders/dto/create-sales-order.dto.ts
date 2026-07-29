import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { OrderItemInputDto } from './order-item-input.dto';

/**
 * "Create Order From Paid Lead" — the only creation path (decision: business
 * operations, not generic CRUD). currencyId/customerName/mobileNumber/
 * countryId/city/address/salesEmployeeId are NOT inputs here — they are
 * snapshotted from the Lead by the service (decision #13).
 * paymentVerifiedById is likewise not an input — snapshotted from the Lead's
 * most recent VERIFIED Payment, if any (TASK-012 decision #4).
 */
export class CreateSalesOrderDto {
  @IsUUID()
  leadId!: string;

  @IsUUID()
  costCenterId!: string;

  @IsUUID()
  projectId!: string;

  /** Mandatory — decision #6. */
  @IsUUID()
  paymentMethodId!: string;

  /** Mandatory — decision #7. */
  @IsUUID()
  warehouseId!: string;

  /** Operational user who created the order — decision #4. No auth exists, so client-supplied. */
  @IsUUID()
  @IsOptional()
  createdById?: string;

  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  @ArrayMinSize(1)
  items!: OrderItemInputDto[];
}
