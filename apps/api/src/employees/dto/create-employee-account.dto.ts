import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';
import { HR_ROLE_PRESET_KEYS } from '../hr-role-presets';
import type { HrRolePresetKey } from '../hr-role-presets';

/** Wizard Step 4 — إنشاء حساب دخول (Part D/E). Only read when `createLoginAccount` is true. */
export class CreateEmployeeAccountDto {
  @IsEmail()
  loginEmail!: string;

  @IsIn(HR_ROLE_PRESET_KEYS)
  role!: HrRolePresetKey;

  @IsString()
  @IsOptional()
  username?: string;
}
