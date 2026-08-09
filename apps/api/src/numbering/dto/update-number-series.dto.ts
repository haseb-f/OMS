import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateNumberSeriesDto } from './create-number-series.dto';

/** `documentType` is the stable key every module calls generateNumber() with — never editable after creation. */
export class UpdateNumberSeriesDto extends PartialType(
  OmitType(CreateNumberSeriesDto, ['documentType'] as const),
) {}
