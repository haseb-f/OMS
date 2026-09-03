import {
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class CreateSalesTeamDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsUUID()
  departmentId!: string;

  @IsUUID()
  managerId!: string;

  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @IsOptional()
  memberIds?: string[];

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateSalesTeamDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsOptionalUuid()
  departmentId?: string;

  @IsOptionalUuid()
  managerId?: string;

  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @IsOptional()
  memberIds?: string[];

  @IsString()
  @IsOptional()
  notes?: string;
}
