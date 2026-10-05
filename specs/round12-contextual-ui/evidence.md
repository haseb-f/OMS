# Round 12 — acceptance evidence (local review stack, tagged demo records)

Web :4701 / API :4705 (builds of this branch), DB `oms_r7_final`. Scripts: `scripts/acceptance/r12/{api-acceptance,browser-acceptance,dropdown-audit,before-shots}.mjs`. Raw results: `evidence/*.json`.

| Check                                                                                                                                                                                                         | Result                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| API: country default currency source / edit / clear / refuse unknown; lookup by 6 phone formats (incl. Arabic digits) as an ordinary employee                                                                 | 25 / 25                                                             |
| API: other owner sees masked, no link, no history, no ids, minimal fields; owner sees open + history; by-id and edit denied (404); agents 403 / nothing                                                       | 25 / 25                                                             |
| Browser: Name → Country → Phone one row; SA → +966/SAR; Egypt → +20/EGP; manual +971 and USD survive a country change; Kuwait → empty currency + hint; typed number keeps its code; delivery country separate | 37 / 37 (one pass, ar-RTL / en-LTR, light / dark, desktop / 390 px) |
| Browser: exactly one lookup entry on Store Orders, Leads, Customers; Arabic-digit phone and order number in the same dialog; cards on a phone                                                                 | included                                                            |
| Browser: toolbar triggers strong blue (white text) in light and dark; every dropdown in the order dialog is the form variant, readable in both themes                                                         | included                                                            |
| Browser: agent overview + portal statement use InsightCards; no company margin / cost on the agent statement                                                                                                  | included                                                            |
| Dropdown audit (135 routes): form triggers 90 (editors, dialogs, forms); toolbar triggers 94; remaining dark triggers are page filters / pagination                                                           | `evidence/dropdown-audit.json`                                      |
| Jest: customer-lookup, store-order duplicates, phone matching (261); vitest 847 (new: control-surface, country defaults, lookup dialog); lint 0 errors                                                        | pass                                                                |
| Independent review (fresh context): 5 findings — 4 fixed (delivery address on master, stale currency edit, Cairo day, phone pin), 1 noted (order-number enumeration budget)                                   | see `plan.md` §5                                                    |

Before / after: `before-order-form-desktop.png` → `ui-order-form-desktop.png`; `before-agent-overview.png` → `ui-agent-overview.png`; `before-agent-statement-portal.png` → `ui-agent-statement-portal.png`; dark / English: `ui-order-form-en-dark.png`; mobile: `ui-order-form-mobile-390.png`, `ui-advanced-lookup-mobile-390.png`.

Not covered: tablet widths, print layouts, investor portal, Production (nothing deployed).
