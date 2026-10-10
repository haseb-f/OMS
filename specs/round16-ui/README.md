# R16 UI — login, agent overview vs management, compact agent order entry

Owner brief 2026-10-10. Branch per spec, merged into `integration/r16-ui`; **no deploy before the owner's
visual approval** of the redesigned screens (local preview + before/after screenshots).

| Spec                                          | File                                                             | Branch                       | Owner of files                                                                                                                                                                                                                              |
| --------------------------------------------- | ---------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 login + mobile viewport                    | [spec-1-login-viewport.md](spec-1-login-viewport.md)             | `feat/r16-login`             | `app/(auth)/**`, `app/layout.tsx` (viewport export only), `theme/tokens.css` / `theme/recipes.css` auth + touch-input rules, `components/shared/password-input.tsx` defaults                                                                |
| S2 agent overview / management + report cards | [spec-2-agent-overview-cards.md](spec-2-agent-overview-cards.md) | `feat/r16-agent-overview`    | `app/(shell)/agents/**`, `components/agents/overview/**`, `components/agents/summary-card.tsx`, `components/shared/insight-card.tsx` (+ consumers' props only), navigation entries for agents, report-card CSS block in `theme/recipes.css` |
| S3 compact agent order entry                  | [spec-3-agent-order-entry.md](spec-3-agent-order-entry.md)       | `feat/r16-agent-order-entry` | the shared `OrderEntryFlow` + agent adapter, agent order pages/dialog wrappers, country→calling-code logic                                                                                                                                  |

Checklist with evidence: [checklist.md](checklist.md). Before/after screenshots: `evidence/before/`, `evidence/after/`.
