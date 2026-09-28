import { describe, expect, it } from "vitest";
import { pendingPasswordRedirect, validateChangePassword } from "./change-password";

describe("change password", () => {
  it("validates the form", () => {
    expect(
      validateChangePassword({ currentPassword: "", newPassword: "", confirmPassword: "" }),
    ).toEqual({
      currentPassword: "required",
      newPassword: "required",
      confirmPassword: "required",
    });
    expect(
      validateChangePassword({
        currentPassword: "Temp#123",
        newPassword: "short",
        confirmPassword: "short",
      }),
    ).toEqual({ newPassword: "tooShort" });
    expect(
      validateChangePassword({
        currentPassword: "Temp#1234",
        newPassword: "Temp#1234",
        confirmPassword: "Temp#1234",
      }),
    ).toEqual({ newPassword: "unchanged" });
    expect(
      validateChangePassword({
        currentPassword: "Temp#123",
        newPassword: "NewPass#1",
        confirmPassword: "NewPass#2",
      }),
    ).toEqual({ confirmPassword: "mismatch" });
    expect(
      validateChangePassword({
        currentPassword: "Temp#123",
        newPassword: "NewPass#1",
        confirmPassword: "NewPass#1",
      }),
    ).toEqual({});
  });

  it("forces a pending temporary password before any other page", () => {
    expect(pendingPasswordRedirect({ mustChangePassword: true }, "/agent")).toBe(
      "/profile/password",
    );
    expect(pendingPasswordRedirect({ mustChangePassword: true }, "/profile/password")).toBeNull();
    expect(pendingPasswordRedirect({ mustChangePassword: false }, "/agent")).toBeNull();
    expect(pendingPasswordRedirect(null, "/")).toBeNull();
  });
});
