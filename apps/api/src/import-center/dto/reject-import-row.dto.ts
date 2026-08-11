import { IsEnum, IsString, MaxLength, ValidateIf } from 'class-validator';

/** Fixed set the UI presents as a dropdown — "Other" requires `note`. */
export enum ImportRowRejectionReasonCode {
  DUPLICATE_ORDER = 'DUPLICATE_ORDER',
  INVALID_PHONE = 'INVALID_PHONE',
  INVALID_CUSTOMER_DATA = 'INVALID_CUSTOMER_DATA',
  MISSING_REQUIRED_DATA = 'MISSING_REQUIRED_DATA',
  CUSTOMER_CANCELLED = 'CUSTOMER_CANCELLED',
  INVALID_ORDER = 'INVALID_ORDER',
  OTHER = 'OTHER',
}

/** Reject one/many needs-review rows — a reason is always required, matching the "must provide a reason before rejection completes" rule. */
export class RejectImportRowDto {
  @IsEnum(ImportRowRejectionReasonCode)
  reasonCode!: ImportRowRejectionReasonCode;

  @ValidateIf(
    (dto: RejectImportRowDto) =>
      dto.reasonCode === ImportRowRejectionReasonCode.OTHER,
  )
  @IsString()
  @MaxLength(500)
  note?: string;
}
