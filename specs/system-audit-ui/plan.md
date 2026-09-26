# Plan — system-audit-ui

## Architecture

- Controls stay on shadcn/Radix + cmdk. Fixes land in shared files first
  (`components/ui/select.tsx`, `components/ui/command.tsx`, `components/shared/entity-combobox.tsx`,
  `search-input.tsx`, `form-fields/*`, `data-table/*filter*`, `business/*-picker.tsx`), then call sites
  migrate to them. No page-specific CSS.
- Audit reuses `scripts/acceptance/_tour-lib.mjs` (login, RUN tag, report collector) with a new
  UI-journey script `scripts/acceptance/journey-audit.mjs`.

## Sequence

1. UI-01 inventory (read-only) ‖ AUD-01 Production journey audit on baseline (functional status).
2. UI-02 shared component fixes (Master).
3. UI-03.. call-site migrations in disjoint file sets (implementer subagents).
4. REV-01 independent review of integrated diff; fixes.
5. Gates: typecheck, lint, web tests, api tests (untouched), production build.
6. Commit + push main → Vercel Production; verify SHA.
7. UI-VIS visual matrix on Production (theme × locale × viewport) for representative pages.
8. AUD-02 rerun journeys on new SHA + final guide screenshots.
9. Guide update (roles, coverage, demo-records, issues, screenshot index); commit; redeploy; verify SHA.

## Risks

- Changing `SelectContent` defaults affects ~56 call sites → keep API identical; verify visually.
- Production mutations: only one agent at a time; all records tagged `DEMO-AUDIT-20260926`.
- Replacing a `Select` with a combobox can change value types (id vs object) → keep id-based adapters.
- Account lockout from bad logins → one login per persona per run.

## Validation

Unit tests (vitest) for Arabic normalization in filters and combobox behaviors; typecheck/lint/build;
Playwright visual matrix + journey audit on Production.
