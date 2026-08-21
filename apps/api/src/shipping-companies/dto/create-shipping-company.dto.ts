import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ShippingMethodType } from '@prisma/client';

export class CreateShippingCompanyDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(ShippingMethodType)
  @IsOptional()
  type?: ShippingMethodType;

  @IsString()
  @IsOptional()
  description?: string;
}
