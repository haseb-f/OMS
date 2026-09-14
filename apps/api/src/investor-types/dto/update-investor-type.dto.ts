import { PartialType } from '@nestjs/mapped-types';
import { CreateInvestorTypeDto } from './create-investor-type.dto';

export class UpdateInvestorTypeDto extends PartialType(CreateInvestorTypeDto) {}
