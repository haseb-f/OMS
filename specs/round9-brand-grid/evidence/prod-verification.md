# Production verification — Home + R9 release (2026-10-04)

Production https://oms.haseb.org · code SHA `fa4f62d15481497a09941322e64677ad553ced18` · Vercel deployment 6842428207 (success).
Script: `tmp/r9/prod-verify.mjs` (read-only; QA personas; screenshots in `evidence/prod/`).

| Check                                                                                                                                                                                                       | Result                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Company login lands on Home (`/`); agent login lands on `/agent`                                                                                                                                            | pass                                                            |
| Sidebar: الشاشة الرئيسية first, لوحة التحكم second (company and agent)                                                                                                                                      | pass (probe, `/` → `/dashboard`, `/agent` → `/agent/dashboard`) |
| Home lists only authorized destinations (22 company tiles; 9 agent tiles, all `/agent/*`)                                                                                                                   | pass                                                            |
| Dashboard reachable separately (company + agent)                                                                                                                                                            | pass                                                            |
| `?next=/store-orders` deep link preserved after login                                                                                                                                                       | pass                                                            |
| Blue dropdown / toolbar triggers (computed oklab hue = blue, 5-step ramp)                                                                                                                                   | pass                                                            |
| Table/Grid on store orders, invoices, leads, customers (20 cards each, no overflow); agent orders (10 cards)                                                                                                | pass                                                            |
| Lead-distribution control renders a real state (Production: paused)                                                                                                                                         | pass                                                            |
| Agent cannot open an internal page (`/store-orders` → `/agent`)                                                                                                                                             | pass                                                            |
| Inventory cost: admin (costing rights) sees cost data; shipping persona has no inventory access (403) so the redaction branch is covered only by unit tests (`inventory-cost-visibility.spec.ts`, 15 tests) | pass / limitation                                               |

Script assertions "sidebar" (selector `aside`) and "blue" (rgb parsing of `oklab()`) were selector defects in the script, not product defects; both re-checked directly.
