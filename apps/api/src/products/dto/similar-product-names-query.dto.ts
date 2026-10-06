import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** `GET /products/similar-names` — a non-blocking duplicate-name hint typed from the product form. */
export class SimilarProductNamesQueryDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  name?: string;

  /** The product being edited — never reported as its own look-alike. */
  @IsOptionalUuid()
  excludeId?: string;

  /** Same-category matches rank first. */
  @IsOptionalUuid()
  categoryId?: string;
}
