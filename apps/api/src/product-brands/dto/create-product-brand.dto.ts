import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateProductBrandDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;
}
