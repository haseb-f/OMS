import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { TextDirection } from '@prisma/client';

export class CreateLanguageDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  nativeName?: string;

  @IsEnum(TextDirection)
  @IsOptional()
  direction?: TextDirection;
}
