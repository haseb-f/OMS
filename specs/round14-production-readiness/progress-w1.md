# W1 progress log (feat/r14-ui-session)

Durable log for spec-1 (entry, sessions, menu tones, required fields, password reset, user dialog).

| Step                                                                                                     | State   | Notes                                                                               |
| -------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------- |
| API sessions (`UserSession`, migration `20261008100000_r14_user_sessions`, guard, logout / reset revoke) | done    | applied to `oms_r14_w1`; guard spec + mutation proof (11/13 fail without the check) |
| Employee reset endpoint `POST /employees/:id/reset-password` (`settings.manage`)                         | done    | no employee-account permission exists in the catalog → `settings.manage` fallback   |
| Integration specs moved to session-bound tokens (`UserSessionsService.issueAccessToken`)                 | done    | 12 spec files: `jwt.sign` → `sessionTokens.issueAccessToken`                        |
| Web: session cookie, remember-me removal, restart detection                                              | pending |                                                                                     |
| Menu tones                                                                                               | pending |                                                                                     |
| Required fields                                                                                          | pending |                                                                                     |
| Employee account tab reset UI, compact user dialog                                                       | pending |                                                                                     |

| Session policy doc `session-policy.md` | done | incl. limitations + JWT_ACCESS_TTL release note |

## Final verification (2026-10-07)

- API: `tsc` clean; jest (runInBand) auth / users / employees / controller-authorization + 10 touched
  integration suites: 21 suites, 581 tests green. Mutation: removing the guard's session check fails
  11/13 tests of `jwt-auth.guard.session.spec.ts`.
- Web: `tsc` clean; vitest 145 files / 1076 tests green; `next build` OK; compiled CSS checked for
  `[data-menu-tone]` states, `--menu-max-height`, the required-legend `:has` rule.
- Not done here (lead): browser pass; Playwright two-tab / new-context restart script.
