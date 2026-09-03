import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';
import { CreateUserDto } from './create-user.dto';

/** Password changes never travel through Edit — see the dedicated Reset Password / Force Password Change actions. */
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, [
    'password',
    'generatePassword',
    'departmentId',
  ] as const),
) {
  @IsOptionalUuid()
  departmentId?: string;
}
