import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class CreateTaxDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  rate!: number;

  @IsBoolean()
  @IsOptional()
  inclusive?: boolean;

  @IsString()
  @IsOptional()
  description?: string;

  @IsOptionalUuid()
  outputAccountId?: string;

  @IsOptionalUuid()
  inputAccountId?: string;
}
