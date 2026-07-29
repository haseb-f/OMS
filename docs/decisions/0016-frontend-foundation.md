# ADR-0016: OMS Frontend Foundation

Date: 2026-07-29
Status: Accepted

## Context

This task pauses backend feature development to build the permanent frontend
architecture: the design system, navigation architecture, and application shell
(Sidebar + TopBar) that every future business page will render inside. The brief
explicitly frames this as production architecture, not a prototype, and names Apple/
Linear/Stripe Dashboard/Vercel Dashboard/Microsoft Clarity/Notion as visual references
while forbidding "Bootstrap Admin"-style templates. It also asks for a Vercel
connection, which — as an OAuth-gated action tied to the user's own account — could not
be performed autonomously; see the final report for what was done instead.

## Decisions

**`apps/web` was restructured onto `src/`** (`app/` → `src/app/`, top-level `features/`
merged into the previously-empty `src/features/`), resolving the overlap ADR-0004 had
explicitly flagged as unresolved ("both overlaps were left unresolved since resolving
them means moving code"). There was no real code inside the old `app/`/`features/`
yet (bootstrap boilerplate and empty `.gitkeep` folders only), so this was a
zero-cost cleanup, not a risky migration. `tsconfig.json`'s `@/*` alias now points at
`./src/*`.

**shadcn/ui was bootstrapped via its own CLI** (`shadcn init`, Nova preset, Radix
base, `--rtl`), not hand-rolled — "Do NOT reinvent common UI components." This
generated `components.json`, `src/lib/utils.ts` (`cn()`), and the Tailwind v4
CSS-variable theme in `src/app/globals.css`. Sidebar, Command, Sheet, Dialog,
Dropdown Menu, Tooltip, Popover, Breadcrumb, Collapsible, and related primitives were
added the same way — the OMS-specific navigation/shell logic is built as a layer on
top of these, never replacing them.

**A single accent color (indigo) was introduced over shadcn's neutral Nova base** for
`--primary`/`--ring`/`--sidebar-primary` in both light and dark mode. The stated
visual references (Linear, Stripe, Vercel) all pair a mostly-grayscale UI with one
restrained accent; the base Nova preset ships fully monochrome. This is a design
decision within "Design Authority," not a business rule.

**Non-color design tokens split across two mechanisms deliberately.** Semantic
typography aliases (`text-page-title`, `text-body`, ...) live inside an `@theme`
block in `theme/tokens.css` so Tailwind generates real utility classes for them.
Z-index and motion duration/easing live as plain `:root` custom properties,
consumed via Tailwind's `z-(--z-topbar)` arbitrary-value syntax (and mirrored in
`theme/tokens.ts` for contexts needing real numbers, like the `motion` library's
`transition.duration`, which is in seconds) — these aren't recognized Tailwind theme
namespaces the same way font sizes are, so putting them in `@theme` would not
reliably generate utilities. Spacing, shadow, border width, opacity, and breakpoints
deliberately reuse Tailwind's own default scale rather than being redeclared —
redeclaring a scale that's already centralized would be duplication, not
architecture.

**`navigation.config.ts` is authored as a flat list with `parent` ids, not a nested
tree.** The task's own field list names both `parent` and `children` on the same
item shape; a flat list means adding a future module is always exactly one new line,
never a deep nested-array edit. `buildNavigationTree()` assembles the nested
`children` structure (sorted, visibility-filtered) that the Sidebar actually renders;
`flattenNavigationTree()`/`findNavigationItemByRoute()`/`getNavigationBreadcrumb()`
support search and breadcrumb lookup from the same source of truth. Icons are stored
as string keys (`icon: "package"`) resolved through `navigation/icon-registry.ts`,
keeping the config itself plain, serializable data with no JSX.

**The navigation tree reflects every backend module built so far** (CRM, Sales,
Products, Inventory, Purchasing, Costing, Finance, Settings, Identity —
ADR-0005 through ADR-0015), not placeholder/dummy entries — this is what "every
module should be generated from configuration" means in practice. Routes with no
page built yet 404 until a later phase builds them; that is expected, not a defect,
per "Do not start business pages yet."

**The Sidebar is built on shadcn's own `Sidebar` primitive** (`collapsible="icon"`),
which already provides cookie-persisted collapsed state, a Cmd/Ctrl+B shortcut, an
automatic mobile Sheet fallback, and collapsed-mode tooltips. OMS-specific behavior
layered on top: "only one parent expanded at a time" (a single `expandedId` in
localStorage, auto-synced to whichever section contains the active route), Pinned
Modules and Recent Pages (both plain client-side preferences in localStorage — no
backend, no fabricated data), and an in-sidebar search that swaps the tree for a
flat filtered result list. Every rendered nav button always has an icon (falling back
to a generic dot glyph when none is configured) — a bug surfaced during smoke testing
where an icon-less pinned item rendered as clipped, unreadable text in collapsed
mode; the fix was a defensive fallback in the `NavIcon` helper plus filling in the
handful of icons that had been left unset.

**RTL is real, not cosmetic.** A `DirectionProvider` (Radix's `Direction` primitive +
a localStorage-persisted `dir` state applied to `<html>`) drives an actual layout
mirror, verified live: sidebar side-swap, icon/chevron mirroring, breadcrumb order,
and TopBar control order all flipped correctly. The TopBar's "Language Switch" is
explicitly a placeholder — selecting "العربية" only flips direction; no translation
content exists, since no i18n/content system was in scope here.

**The Command Palette is fully functional, not a placeholder**, despite the task
calling it "Command Palette placeholder." It searches and navigates the same
navigation tree the Sidebar renders, opened via Cmd/Ctrl+K or the TopBar's search
box — a legitimate, no-invented-business-logic implementation of a universally
adopted enterprise pattern ("Design Authority... implement automatically"). It
required one fix during smoke testing: shadcn's generated `CommandDialog` does not
implicitly wrap children in the `cmdk` root (`<Command>`) in this version, unlike
older shadcn releases — omitting it threw `Cannot read properties of undefined
(reading 'subscribe')` at runtime; the fix was nesting an explicit `<Command>`
inside `CommandDialog`.

**Notifications, Quick Actions, and the Profile Menu are honest placeholders.**
Notifications and Quick Actions always render the "empty state" pattern (no
fabricated notification/action data). The Profile Menu shows a clearly-generic
placeholder identity (`Guest User` / `Not signed in`) rather than a fabricated real
person, with every menu action disabled — there is no Authentication module yet
(see TODO.md), and inventing a working logout with nothing to log out of would be
inventing business behavior the task explicitly forbids.

**Vercel was connected after the user authenticated the CLI themselves.** Linking a
GitHub repository to a Vercel account requires an OAuth authorization only the user
can grant; once they logged in via `vercel login` in their own session, the CLI
(`vercel project add`, `vercel link`, `vercel git connect`, and the `/v9/projects`
API for `rootDirectory`/`framework`) was used to create the `oms` project under the
`haseb-f-s-projects` team, link it to `apps/web` (Root Directory `apps/web`,
Framework `nextjs`), and connect it to the `haseb-f/OMS` GitHub repository.

**The Git "Production Branch" setting could not be changed via CLI or API** —
`vercel project update` has no flag for it, and `PATCH /v9/projects/{id}` rejects
both a top-level `productionBranch` field and a nested `link` object as unknown
properties. This appears to be a dashboard-only setting
(Project Settings → Git → Production Branch). Left at its default (`main`), this
means **every push to `main` auto-creates a Production deployment** via the Git
integration — confirmed live twice during this task (once triggered by a manual
CLI deploy, once by a routine `git push`), both times corrected by removing the
auto-generated production aliases (`vercel alias rm`) immediately after. The user
was asked and confirmed this remediation; they still need to change the Production
Branch setting themselves to stop it recurring on their next push.

## Consequences

- Every future business page renders inside `AppShell` — adding a route means adding
  a page component and (if it should appear in navigation) one line in
  `navigation.config.ts`; the shell itself does not change.
- The `packages/ui`/`packages/shared`/`packages/types` workspace packages remain
  unused by `apps/web` (pre-existing TODO item, unchanged by this task) — everything
  built here lives directly in `apps/web/src`, since only one app currently needs a UI.
- `apps/web`'s dev/start scripts now bind to port 3001 (was 3000, colliding with
  `apps/api`) — `README.md` updated to match.
- No business page, data table, form, or API-wired view exists yet — every route
  besides `/` 404s until Part 2 (or a later task) builds it.
- Vercel is connected and a Preview Deployment of this work exists and was verified
  `READY`. Until the user changes the Production Branch away from `main` in the
  dashboard, every future push to `main` will keep auto-creating a Production
  deployment that needs its aliases manually removed — this is the one outstanding
  Vercel item.
