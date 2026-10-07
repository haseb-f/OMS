import { ArrayUnique, IsArray, IsString } from 'class-validator';

/**
 * R14 W2 (spec-2 §A) — a user's complete individual overrides, tri-state:
 * a name in `grants` is an individual GRANT, in `denies` an individual DENY,
 * absent from both = inherit from the job-title template.
 */
export class SetUserPermissionOverridesDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  grants!: string[];

  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  denies!: string[];
}
