import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { SHIPPING_STATUS_COLORS } from '../../shipping/shipping-status.catalog';

export class CreateShippingStatusDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsIn([...SHIPPING_STATUS_COLORS])
  @IsOptional()
  color?: string;
}
