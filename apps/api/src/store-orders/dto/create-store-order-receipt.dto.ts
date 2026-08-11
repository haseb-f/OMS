import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Same "paste a URL" convention as every other attachment in this app — no real file-upload pipeline exists yet. */
export class CreateStoreOrderReceiptDto {
  @IsString()
  @IsNotEmpty()
  fileUrl!: string;

  @IsString()
  @IsOptional()
  fileName?: string;

  /** Links the receipt to the specific Payment it evidences, when known (e.g. attached right after recording that payment). */
  @IsOptionalUuid()
  paymentId?: string;
}
