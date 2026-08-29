import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreatePartnerDto } from './create-partner.dto';

/** Roles are managed exclusively via POST /partners/:id/roles and DELETE /partners/:id/roles/:role — never through a plain field update (spec section 44: role changes get their own audit entries). */
export class UpdatePartnerDto extends PartialType(
  OmitType(CreatePartnerDto, ['roles'] as const),
) {}
