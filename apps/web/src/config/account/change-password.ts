/** Client-side rules for the own-password change form (the API re-validates). */
export const MIN_PASSWORD_LENGTH = 8;

/** The one page every user changes their own password on (a shared route for both audiences). */
export const CHANGE_PASSWORD_ROUTE = "/profile/password";

export type ChangePasswordError = "required" | "tooShort" | "mismatch" | "unchanged";

export function validateChangePassword(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Partial<Record<"currentPassword" | "newPassword" | "confirmPassword", ChangePasswordError>> {
  const errors: Partial<
    Record<"currentPassword" | "newPassword" | "confirmPassword", ChangePasswordError>
  > = {};
  if (!input.currentPassword) errors.currentPassword = "required";
  if (!input.newPassword) errors.newPassword = "required";
  else if (input.newPassword.length < MIN_PASSWORD_LENGTH) errors.newPassword = "tooShort";
  else if (input.newPassword === input.currentPassword) errors.newPassword = "unchanged";
  if (!input.confirmPassword) errors.confirmPassword = "required";
  else if (input.newPassword && input.confirmPassword !== input.newPassword)
    errors.confirmPassword = "mismatch";
  return errors;
}

/**
 * Where a signed-in user must be sent before anything else: the password page
 * while a temporary password is pending, otherwise nowhere (null).
 */
export function pendingPasswordRedirect(
  user: { mustChangePassword?: boolean } | null | undefined,
  pathname: string,
): string | null {
  if (!user?.mustChangePassword) return null;
  return pathname === CHANGE_PASSWORD_ROUTE ? null : CHANGE_PASSWORD_ROUTE;
}
