import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateShippingCompanyDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;
}
