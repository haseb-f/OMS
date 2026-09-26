import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ status: "authenticated", permissions: [] as string[] }));
const usersList = vi.hoisted(() => vi.fn());

vi.mock("@/providers/user-context", () => ({
  useUserContext: () => ({
    status: auth.status,
    hasPermission: (key: string) => auth.permissions.includes(key),
  }),
}));
vi.mock("@/services/users-service", () => ({ usersService: { list: usersList } }));

import { useUsersListState, USERS_LIST_PERMISSION } from "./use-reference-data";
import {
  ANONYMOUS_FINGERPRINT,
  identityFingerprint,
  setIdentityFingerprint,
} from "@/lib/client-data-scope";

const ADMIN = identityFingerprint({
  userId: "admin",
  companyId: "c1",
  permissions: [USERS_LIST_PERMISSION],
});
const AGENT = identityFingerprint({
  userId: "agent",
  companyId: "c1",
  permissions: ["sales.orders.view"],
});

const switchTo = (fingerprint: string) =>
  act(() => {
    setIdentityFingerprint(fingerprint);
  });

afterEach(() => cleanup());

beforeEach(() => {
  usersList.mockReset();
  usersList.mockResolvedValue([]);
  switchTo(ANONYMOUS_FINGERPRINT);
});

describe("useUsersListState", () => {
  it("returns [] and sends no request when the viewer cannot list users", () => {
    auth.permissions = [];
    switchTo(AGENT);
    const { result } = renderHook(() => useUsersListState());
    expect(result.current.users).toEqual([]);
    expect(result.current.canList).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(usersList).not.toHaveBeenCalled();
  });

  it("admin rows cached under identity A are never returned after switching to B", async () => {
    auth.permissions = [USERS_LIST_PERMISSION];
    usersList.mockResolvedValueOnce([{ id: "u1", fullName: "Admin", email: "admin@x" }]);
    switchTo(ADMIN);
    const { result, rerender } = renderHook(() => useUsersListState());
    await waitFor(() => expect(result.current.users).toHaveLength(1));

    auth.permissions = [];
    switchTo(AGENT);
    rerender();
    expect(result.current.users).toEqual([]);
    expect(usersList).toHaveBeenCalledTimes(1);
  });

  it("refetches for a new identity that may list users instead of reusing A's rows", async () => {
    auth.permissions = [USERS_LIST_PERMISSION];
    usersList
      .mockResolvedValueOnce([{ id: "u1", fullName: "A-view", email: "a@x" }])
      .mockResolvedValueOnce([{ id: "u2", fullName: "B-view", email: "b@x" }]);
    switchTo(ADMIN);
    const { result } = renderHook(() => useUsersListState());
    await waitFor(() => expect(result.current.users[0]?.fullName).toBe("A-view"));

    switchTo(
      identityFingerprint({
        userId: "admin2",
        companyId: "c2",
        permissions: [USERS_LIST_PERMISSION],
      }),
    );
    await waitFor(() => expect(result.current.users[0]?.fullName).toBe("B-view"));
    expect(usersList).toHaveBeenCalledTimes(2);
  });

  it("a disabled hook returns [] even while the same scope has rows cached", async () => {
    auth.permissions = [USERS_LIST_PERMISSION];
    usersList.mockResolvedValueOnce([{ id: "u1", fullName: "Admin", email: "admin@x" }]);
    switchTo(ADMIN);
    const first = renderHook(() => useUsersListState());
    await waitFor(() => expect(first.result.current.users).toHaveLength(1));
    auth.permissions = []; // permission revoked, fingerprint not yet updated (defense in depth)
    const second = renderHook(() => useUsersListState());
    expect(second.result.current.users).toEqual([]);
  });
});
