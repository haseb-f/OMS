import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ShippingMethodType } from '@prisma/client';

export class CreateShippingMethodDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(ShippingMethodType)
  type!: ShippingMethodType;

  @IsString()
  @IsOptional()
  description?: string;
}
