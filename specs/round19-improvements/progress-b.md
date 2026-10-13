# R19 stream B — contrasting sidebar (`feat/r19-sidebar`)

Spec: `specs/round19-improvements/README.md` §B. Status: implemented locally, not pushed / merged.

## Tokens (`apps/web/src/app/globals.css`, sidebar blocks only)

| Token                                     | Light (charcoal)       | Dark (soft light grey) | Contrast (light / dark)                                             |
| ----------------------------------------- | ---------------------- | ---------------------- | ------------------------------------------------------------------- |
| `--sidebar`                               | #1f2024                | #e8e9ec                | vs canvas 16.27 / 16.31, vs card 16.27 / 15.55                      |
| `--sidebar-foreground`                    | #d6d7db                | #2a2c31                | 11.32 / 11.51 (on hover 9.31 / 10.18)                               |
| `--sidebar-muted-foreground`              | #a2a5ac                | #585b63                | 6.60 / 5.60 (on hover 5.43 / 4.95)                                  |
| `--sidebar-primary` (active)              | #ffffff                | #0a0a0a                | on active 11.80 / 12.70                                             |
| `--sidebar-accent` (hover)                | #2d2f34                | #dadce0                | hover label 13.39 / 14.42                                           |
| `--sidebar-active`                        | 20% #52a8ff on sidebar | 20% #0068d6 on sidebar | vs hover 1.14 / 1.14 (+ hue, rail, weight)                          |
| `--sidebar-rail` (active / hover icon)    | #52a8ff                | #005cc5                | on sidebar 6.51 / 5.18, on active 4.72 / 4.04, on hover 5.36 / 4.58 |
| `--sidebar-ring` (focus)                  | #6cb6ff                | #0060c7                | sidebar 7.57 / 4.95, hover 6.23 / 4.37, active 5.49 / 3.85          |
| `--sidebar-border` (dividers)             | #383a40                | #c3c6cc                | 1.43 / 1.41 (decorative, ≥ 1.3)                                     |
| `--sidebar-raised` (identity)             | #292b30                | #f4f5f6                | name 9.85 / 12.80, number 5.74 / 6.22                               |
| `--sidebar-chip` / `-foreground`          | 24% #52a8ff / #a9d1ff  | 14% #0068d6 / #0058b8  | icon 6.00 / 5.19                                                    |
| `--sidebar-scrollbar-thumb`               | 22% foreground         | 26% foreground         | 1.79 / 1.64                                                         |
| company selector (unchanged `--selector`) | tone 3                 | dark tone 3            | label 7.53 / 8.79                                                   |

Contrast check: `node scripts/design/contrast-check.mjs` — 712 pairs pass (356 per theme), 19 new
sidebar pairs per theme.

## Components touched

- `globals.css` — light/dark sidebar token blocks (rail tokens moved into them), new
  `--sidebar-raised`, `--sidebar-chip(-foreground)`, `--sidebar-scrollbar-thumb` + theme mappings;
  one `[data-slot="sidebar"]` surface rule mapping `--foreground`, `--btn-soft-hover/-pressed`,
  `--focus-ring`, `--scrollbar-thumb*` onto sidebar tokens (fixes the ghost collapse toggles, pin
  button and mobile-drawer close button on the new surface).
- `ui/sidebar.tsx` — item / sub-item focus outline `outline-sidebar-ring`, hovered icon
  `text-sidebar-rail` (was `text-primary`), outline item variant on `bg-sidebar-raised`.
- `layout/app-sidebar.tsx` — pin hover `text-sidebar-rail`; the icon-collapsed rail now marks the
  group that contains the current page (it was unmarked while the group was expanded).
- `layout/portal-identity.tsx` — identity card `bg-sidebar-raised`, chip `bg-sidebar-chip`.
- Guard `layout/sidebar-surface.spec.ts` (5 tests): sidebar components use sidebar tokens only; no
  other file / stylesheet overrides a sidebar colour; light sidebar dark, dark sidebar light; the
  surface rule exists and leaves selector colours alone; desktop + mobile carry the slot.
- `scripts/design/contrast-check.mjs` — sidebar pairs; `design-system.md` §11.6 note.

Navigation config, permissions, routing and behaviour are unchanged (only the collapsed-rail
active marker is new).

## Layouts covered

Company shell, agent portal (`/agent`) and partner portal (`/partner`) — all render the one
`AppSidebar` inside `AppShell`: expanded, icon-collapsed and the mobile drawer. The investor portal
(`/investor`) has no sidebar (a top navigation bar by design) and no demo persona — not applicable.

## Evidence

`evidence/b/{before,after}/` — company AR light/dark expanded (hover state), collapsed, mobile 375
drawer; company EN light/dark expanded; agent AR light/dark; partner AR light/dark (12 each).
Captured with `tmp/r19-b/shots.mjs` against the local `oms_r19_b` demo DB.
