import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { PartnerStatus } from '@prisma/client';
import { CreateInvestorDto } from './create-investor.dto';

export class UpdateInvestorDto extends PartialType(CreateInvestorDto) {
  @IsEnum(PartnerStatus)
  @IsOptional()
  status?: PartnerStatus;
}
