import { PartialType } from '@nestjs/mapped-types';
import { CreateKpiTemplateDto } from './create-kpi-template.dto';

export class UpdateKpiTemplateDto extends PartialType(CreateKpiTemplateDto) {}
