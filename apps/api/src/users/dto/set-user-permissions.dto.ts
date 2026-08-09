import { ArrayUnique, IsArray, IsString } from 'class-validator';

/** Replaces the user's entire direct permission grant set — the Permission Matrix always saves the full checked list, never a delta. */
export class SetUserPermissionsDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  permissionNames!: string[];
}
