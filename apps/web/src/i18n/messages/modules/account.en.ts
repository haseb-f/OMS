/** account namespace (en) — own-account self-service (change password), shared by internal and agent users. */
const accountEn = {
  changePassword: {
    menu: "Change password",
    title: "Change password",
    description: "Set a new password for your account.",
    forcedTitle: "Set your own password",
    forcedDescription:
      "You signed in with a temporary password. Choose your own password to continue.",
    currentPassword: "Current (temporary) password",
    newPassword: "New password",
    confirmPassword: "Confirm new password",
    hint: "At least 8 characters, different from the current password.",
    submit: "Change password",
    success: "Your password was changed.",
    failed: "Could not change the password.",
    errors: {
      required: "This field is required.",
      tooShort: "The new password must be at least 8 characters.",
      mismatch: "The two new passwords do not match.",
      unchanged: "The new password must differ from the current one.",
    },
  },
};

export default accountEn;
