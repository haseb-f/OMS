import { PartialType } from '@nestjs/mapped-types';
import { CreateLandedCostDocumentDto } from './create-landed-cost-document.dto';

/** Only permitted while the document is DRAFT — enforced in the service, not here. */
export class UpdateLandedCostDocumentDto extends PartialType(
  CreateLandedCostDocumentDto,
) {}
