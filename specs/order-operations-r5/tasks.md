# Round 5 — tasks

| ID  | Task                                                                                         | Workstream | Depends on   | State       |
| --- | -------------------------------------------------------------------------------------------- | ---------- | ------------ | ----------- |
| T1  | Tariff dimensions (channel × payment type), migration, resolution                            | W2         | —            | in progress |
| T2  | Pricing status, provisional estimate, resolve on shipping-company assignment, dispatch guard | W2         | T1           | in progress |
| T3  | INCLUDED / ADDED behaviors, customer-total confirmation                                      | W2         | T2           | in progress |
| T4  | Carrier-cost leak closure in agent portal + automated key scan                               | W2         | —            | in progress |
| T5  | Product ownership UX, agent Products tab (link / new / unlink / override), empty states      | W2         | —            | in progress |
| T6  | Duplicate check API (phone / name / cross-scope), enforced resolution, review queue          | W1B        | —            | in progress |
| T7  | Idempotent order creation (manual, lead conversion, agent)                                   | W1B        | —            | in progress |
| T8  | Duplicate panel in create dialog, lead convert, agent form                                   | W1B        | T6           | in progress |
| T9  | Payment vocabulary single source + tone fixes                                                | W3         | —            | in progress |
| T10 | Payments review workbench stage strip                                                        | W3         | T9           | in progress |
| T11 | Match panel side sheet, semantic actions, bulk endpoints                                     | W3         | T9           | in progress |
| T12 | Collapsible report summary                                                                   | W4         | —            | in progress |
| T13 | Soft card tokens + dashboard application                                                     | W4         | —            | in progress |
| T14 | Toolbar / trigger / segmented refinement                                                     | W4         | —            | in progress |
| T15 | Order amendment preview/commit, version, audit, impacts                                      | W1A        | T1–T3, T6–T7 | queued      |
| T16 | Compact order detail (internal + agent)                                                      | W1C        | T9, T15      | queued      |
| T17 | Independent reviews: financial correctness, authorization, visual usability                  | reviewers  | each stream  | queued      |
| T18 | Merge, gates on `main`, release functional work, verify deployed SHA + journeys              | integrator | T17          | queued      |
| T19 | Visual preview + screenshots → owner approval → release                                      | integrator | T12–T14      | queued      |
| T20 | Arabic handoff                                                                               | integrator | all          | queued      |
