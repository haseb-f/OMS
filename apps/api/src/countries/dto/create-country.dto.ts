import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * ISO format checks (alpha-2 `code`, alpha-3 `iso3`) and duplicate checks
 * (archived rows included) live in `CountriesService` so they return one
 * clear, localized message instead of a generic "Validation failed.".
 */
export class CreateCountryDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  nameEn?: string;

  @IsString()
  @IsOptional()
  iso3?: string;
}
