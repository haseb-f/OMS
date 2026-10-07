# W1 — Entry experience, session lifecycle, shared UI

## 1. Home landing and sidebar

Current: `resolvePostLoginPath(next, userType)` → `/` (company) or `/agent` (agent) unless a safe `next`;
sidebar accordion defaults collapsed and login clears `oms.sidebar.expandedModule`.

- Keep. `next` is honoured only when it came from (a) the proxy redirect of a signed-out deep link or
  (b) the in-app session-expiry redirect (R6 A.4). The logout redirect never carries `next`.
- On Home (no active child route) no group is expanded; verify both portals.
- Test: unit tests for `resolvePostLoginPath` and the logout redirect.

## 2. Session policy (browser restart → sign in again)

Current: one stateless JWT in a non-httpOnly cookie `oms_token`; `rememberMe` → 30-day persistent cookie
and 30-day token; no revocation; internal tokens not re-checked after deactivation.

Target:

- Remove "remember me" (UI and API: the DTO field is ignored, token lifetime never extended).
- Cookie is a session cookie only (no `max-age`/`expires`).
- Server sessions: `UserSession (id, userId, createdAt, lastSeenAt, expiresAt, revokedAt, revokedReason,
userAgentHash)`; JWT carries `sid`. `JwtAuthGuard` rejects a token whose session is missing, revoked,
  idle > `SESSION_IDLE_MINUTES` (default 120) or past `expiresAt` (= JWT exp, `JWT_ACCESS_TTL`). Session
  lookups cached per process 15 s; `lastSeenAt` written at most once a minute.
- The guard also rejects internal users that are inactive/locked (same live check agent tokens get).
- `POST /auth/logout` revokes the session (server-side). Password reset by an admin / own password change
  revokes the user's other sessions.
- Browser-restart detection (best effort): a per-tab `sessionStorage` marker plus a `BroadcastChannel`
  handshake — a page load with no marker asks open tabs; if none answers within 400 ms the cookie is
  treated as a restored browser session and the user is signed out (server revoke). New tabs opened while
  another tab is alive are accepted. Never relies on `unload`/`beforeunload`.
- Honest limitation (documented in the guide and the release record): browsers with "continue where you
  left off" may restore session cookies and per-tab `sessionStorage`; then the handshake cannot tell a
  restart from a reload. The idle timeout (2 h) and absolute expiry still end the session server-side.
- Tests: guard unit tests (revoked / idle / expired / inactive user), logout revoke, browser script
  (Playwright: two tabs share the session; reload keeps it; new context = restart → login).

## 3. Semantic dropdown-item colours

- `DropdownMenuItem` gains `tone?: "neutral" | "info" | "success" | "warning" | "destructive"` (destructive
  keeps the existing `variant` alias). Tokens: `--menu-tone-*` defined in `src/theme/tokens.css` for
  light/dark with ≥ 4.5:1 contrast; hover/focus/selected use the same hue on a tinted background;
  disabled stays muted for every tone; icon inherits the colour.
- `RowAction` and `HeaderActions` gain `tone`; a shared `actionTone(kind)` map gives the consistent
  semantics: create/approve/confirm/post/deliver/activate → success; hold/suspend/reopen/review → warning;
  delete/cancel/archive/reject/void → destructive; view/print/export/copy/edit → neutral; info → info.
- Status menus (status filters, status-change menus) colour each option by its `StatusTone`.
- Never applied to catalogue selectors (products, customers, countries, suppliers …): `SearchableSelect`,
  `EntityCombobox`, pickers stay neutral (guarded by a spec test).
- Menus scroll within `max-height: var(--menu-max-height)` with keyboard navigation.

## 4. Required fields

- `FieldLabel required` → visible asterisk in `--destructive` (not muted), `aria-hidden`, plus the control
  gets `aria-required="true"` via the shared field wrappers; a legend "* حقل مطلوب" in `Form` footers.
- Conditional requirement: field wrappers accept `required` as a boolean computed from watched values.
- Audit the main create/edit forms against server DTO validation: store order create, customer, product,
  supplier, purchase order, sales order/invoice, user, employee, warehouse, chart of account, expense,
  company partner (W5). Mismatches fixed on the form side (never loosen server validation).
- Server field errors map onto the field (existing `fields[]`), entered data kept.

## 5. Password reset and compact user dialog

- `ResetPasswordField` uses `PasswordInput` with `generatable`, `copyable`, reveal/hide; copy shows a toast.
- Employee account tab gets "إعادة تعيين كلمة المرور" calling `POST /employees/:id/reset-password`
  (permission `employees.manage_account`, fallback `settings.manage`) → `UsersService.resetPassword`.
- Generator = `packages/shared/password-policy.ts` (`generatePassword`), server policy unchanged (8–200).
- Passwords never logged; the reset response never echoes a supplied password.
- `UserEditorModal` → `formCard` narrow width, single-column on mobile, two-column ≥ md.
