# Session policy (R14 W1, decision D1-1)

What signs a user out, and what does not. Applies to company users and agent users alike; the
Investor Portal keeps its own token and is out of scope.

## Server side (authoritative)

| Item              | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session record    | Every successful `POST /auth/login` creates a `user_sessions` row (`id`, `user_id`, `created_at`, `last_seen_at`, `expires_at`, `revoked_at`, `revoked_reason`, `user_agent_hash` = SHA-256 of the User-Agent, never the raw header). The access token carries its id as `sid`.                                                                                                                                                                             |
| Absolute expiry   | `expires_at` = the token's own `exp` = `SESSION_ABSOLUTE_HOURS` (default **12 h**, max 24) after login — independent of `JWT_ACCESS_TTL` (Production: 15 m, measured 2026-10-07), because every request is checked against the server session anyway. "Remember me" is gone: the login DTO still accepts `rememberMe` from old clients but ignores it — the lifetime is never extended.                                                                     |
| Idle timeout      | `SESSION_IDLE_MINUTES` (default **120**). A request after a longer gap is refused (401 `SESSION_IDLE`) and the session is revoked (`IDLE`).                                                                                                                                                                                                                                                                                                                 |
| Per-request check | `JwtAuthGuard` refuses (401) a token without `sid` (all pre-R14 tokens → everyone signs in once after the release), an unknown session or one of another user (`SESSION_MISSING`), a revoked one (`SESSION_REVOKED`), an expired one (`SESSION_EXPIRED`), and a deleted / inactive / locked user (`ACCOUNT_UNAVAILABLE`) — internal users now get the same live account check agent users had. Agent tokens additionally keep their live affiliation check. |
| Cost              | Session rows are cached per API process for 15 s; `last_seen_at` is written at most once a minute per session. A revocation made by the same process applies immediately; one made by another process (another serverless instance) applies within 15 s.                                                                                                                                                                                                    |
| Logout            | `POST /auth/logout` revokes the caller's session (`LOGOUT`); the token is refused from the next request on.                                                                                                                                                                                                                                                                                                                                                 |
| Password changes  | An admin reset (Settings → Users, HR employee account tab, agent team pages — all `UsersService.resetPassword`) and the forgot-password reset revoke **every** session of that user (`PASSWORD_RESET`). The user's own password change revokes all **other** sessions (`PASSWORD_CHANGED`); the session that made the change stays. A supplied reset password is never echoed in the response and never logged.                                             |

## Browser side

- The token cookie `oms_token` is a **session cookie** (no `max-age` / `expires`): the browser drops it
  when it really ends the session.
- **Restart detection (best effort).** Each tab keeps a random marker in `sessionStorage`
  (`oms.session.tab`, set at login and when a tab is accepted). A page load that has the cookie but no
  marker asks the other open tabs over `BroadcastChannel("oms.session.presence")`; a signed-in, marked
  tab answers. No answer within **400 ms** → the cookie outlived the browser: the page calls
  `POST /auth/logout` (server revoke), clears the cookie and per-user storage, and goes to `/login`
  (without `next`). A reload keeps its marker; a new tab opened while another tab is alive is accepted.
  Nothing relies on `unload` / `beforeunload`.
- Without `sessionStorage` or `BroadcastChannel` the check is skipped (the tab is accepted).
- Sign-out lands on `/login` with no `next`. `next` is carried only by the proxy's signed-out deep-link
  redirect and by the in-app session-expiry redirect (any API 401).

## Honest limitations

1. Browsers set to "continue where you left off" (Chrome / Edge "Continue where you left off",
   Firefox "Open previous windows and tabs", Safari window restore) may restore **session cookies and
   per-tab `sessionStorage`** together. A restored tab then looks exactly like a reload, and the
   handshake cannot tell a restart from a reload — the user stays signed in after a restart. The
   server still ends that session after **2 h without activity** or at its absolute expiry.
2. Closing the last tab of OMS while the browser keeps running is not a restart: the session cookie
   survives until the browser exits, and a new OMS tab opened later finds no live tab and is signed out
   (by design — the session belonged to the closed tabs).
3. The cookie is readable by page scripts (non-httpOnly, needed by `proxy.ts`); server revocation is
   what makes a copied token useless after logout.
4. There is no refresh token: an active user is signed out once at the absolute expiry (12 h after
   sign-in by default) even while working. Raise `SESSION_ABSOLUTE_HOURS` (max 24) if a shift is longer.

## Release notes

- Migration `20261008100000_r14_user_sessions` (additive table; FK cascade on the user's hard delete).
- On first request after deploy, every pre-R14 token is refused once (no `sid`) — users sign in again.
- New env (both optional): `SESSION_IDLE_MINUTES` (default 120), `SESSION_ABSOLUTE_HOURS` (default 12, max 24).
  `JWT_ACCESS_TTL` no longer limits user sessions.
