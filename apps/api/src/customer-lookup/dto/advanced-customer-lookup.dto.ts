import { IsString, MaxLength } from 'class-validator';

export class AdvancedCustomerLookupDto {
  /** A phone number (>= 7 digits) or a name fragment (>= 3 characters). */
  @IsString()
  @MaxLength(200)
  query!: string;
}
