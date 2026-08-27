import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  TransactionAccountingTreatment,
  TransactionDirection,
  TransactionMatchingTarget,
} from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';
import { IsOptionalEnum } from '../../common/decorators/is-optional-enum.decorator';

/**
 * Custom Transaction Type creation — `code` is never accepted from the
 * client (generated server-side, same `USR_<random>` convention as
 * `ShippingStatusesService.create`); `direction` is fixed at creation and
 * never contradicted per-transaction later (spec section 6).
 */
export class CreateTransactionTypeDto {
  @IsString()
  @IsNotEmpty()
  nameAr!: string;

  @IsString()
  @IsOptional()
  nameEn?: string;

  @IsEnum(TransactionDirection)
  direction!: TransactionDirection;

  @IsOptionalEnum(TransactionMatchingTarget)
  matchingTarget?: TransactionMatchingTarget;

  @IsOptionalEnum(TransactionAccountingTreatment)
  defaultAccountingTreatment?: TransactionAccountingTreatment;

  @IsOptionalUuid()
  defaultAccountId?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
