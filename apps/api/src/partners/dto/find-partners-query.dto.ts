import { IsEnum, IsOptional } from 'class-validator';
import { PartnerRoleType, PartnerSource, PartnerStatus } from '@prisma/client';
import { MasterDataQueryDto } from '../../master-data/dto/master-data-query.dto';
import { TransformEnumList } from '../../common/query/enum-list';

/** `role` is the key filter every Customers/Suppliers page-as-a-view passes (e.g. `role=CUSTOMER`) — Partners WHERE that role is assigned, never a separate registry (spec section 9/10). */
export class FindPartnersQueryDto extends MasterDataQueryDto {
  @TransformEnumList()
  @IsEnum(PartnerRoleType, { each: true })
  @IsOptional()
  role?: PartnerRoleType[];

  @TransformEnumList()
  @IsEnum(PartnerStatus, { each: true })
  @IsOptional()
  status?: PartnerStatus[];

  @TransformEnumList()
  @IsEnum(PartnerSource, { each: true })
  @IsOptional()
  source?: PartnerSource[];
}
