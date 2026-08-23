import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  SHIPPING_STATUS_COLORS,
  SHIPPING_SYNC_BEHAVIORS,
} from '../../shipping/shipping-status.catalog';

export class CreateShippingStatusDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsIn([...SHIPPING_STATUS_COLORS])
  @IsOptional()
  color?: string;

  @IsString()
  @IsIn([...SHIPPING_SYNC_BEHAVIORS])
  @IsOptional()
  syncBehavior?: string;

  /** Requires the safe default-replacement flow when another active status is already default — see `ShippingStatusesService.create`. */
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
