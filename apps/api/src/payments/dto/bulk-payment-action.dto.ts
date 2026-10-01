import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { BULK_LIMITS } from '../../common/bulk/bulk-limits';

/** `POST payments/bulk/confirm` — duplicates are ignored (each id runs once). */
export class BulkConfirmPaymentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_LIMITS.paymentBulkActionMax)
  @IsUUID('all', { each: true })
  ids!: string[];
}

/** `POST payments/bulk/reject` — one shared reason, saved on every rejected declaration. */
export class BulkRejectPaymentsDto extends BulkConfirmPaymentsDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'A rejection reason is required.' })
  @MaxLength(500)
  rejectionReason!: string;
}
