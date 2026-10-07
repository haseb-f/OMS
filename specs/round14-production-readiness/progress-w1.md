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
