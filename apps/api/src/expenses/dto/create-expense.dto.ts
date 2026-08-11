import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class CreateExpenseDto {
  @IsDateString()
  date!: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsOptionalUuid()
  costCenterId?: string;

  @IsOptionalUuid()
  paymentMethodId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
