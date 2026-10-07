import { ArrayUnique, IsArray, IsString } from 'class-validator';

/** R14 W2 (spec-2 §A) — a job title's complete default permission template. */
export class SetJobTitlePermissionsDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  permissionNames!: string[];
}
