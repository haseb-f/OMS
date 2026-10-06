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

  /**
   * R13b (O-2) — false when the input tax cannot be reclaimed; on a fixed
   * asset purchase line it is then capitalized into the asset cost.
   * Defaults to true.
   */
  @IsBoolean()
  @IsOptional()
  isRecoverable?: boolean;

  @IsString()
  @IsOptional()
  description?: string;

  @IsOptionalUuid()
  outputAccountId?: string;

  @IsOptionalUuid()
  inputAccountId?: string;
}
