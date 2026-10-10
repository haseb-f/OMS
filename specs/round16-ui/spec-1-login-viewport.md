# S1 — Professional login + mobile viewport

## Findings (2026-10-10)

- Inputs use `--text-body` 14px and `--control-height-md` 32px (40px on coarse pointers). iOS Safari zooms the
  page when an input under 16px gets focus and keeps that zoom after the client-side redirect, so the
  destination page looks enlarged / clipped. Root cause of the reported zoom.
- No explicit `viewport` export (Next default `width=device-width, initial-scale=1`) — keep it, never add
  `maximum-scale`/`user-scalable=no`.
- The login password uses `PasswordInput` whose `copyable` defaults to true → a COPY icon on the login form.

## Changes

1. Login: `copyable={false}` on the login password (reveal/hide kept); generation/copy stay in user creation
   and password reset (unchanged components there).
2. Touch-input font: under `@media (pointer: coarse)` every text-entry control (`input` text-like types,
   `textarea`, `select`, the shared combobox search input) renders at ≥16px — app-wide, so focusing any field
   never zooms. Desktop density unchanged.
3. Explicit `viewport` export: `width=device-width, initialScale=1, viewportFit=cover`, `interactiveWidget:
'resizes-content'` (keyboard resizes the layout so fields/actions stay reachable); no scale limits.
4. Visual redesign of the auth shell + form, tokens only:
   - auth inputs 50px (`--auth-control-height: 3.125rem`), 16px text, softer 10px radius, clearer label
     weight, roomy focus ring (brand navy, 3px soft halo), password reveal button sized to the field;
   - a soft raised form card (surface + hairline border + restrained shadow) on the canvas, max-width ~26rem,
     with a small brand mark and a clear title/subtitle hierarchy; primary button 50px, full width, navy;
   - brand panel: keep logo, add subtle depth (gradient + faint pattern), tagline under the logo;
   - mobile: compact brand header, card full width with 16px gutters, no horizontal scroll, safe-area padding;
   - light/dark, ar/en, reduced motion respected (no animation beyond the existing focus transitions).
5. Post-login fit: verify Home/agent Home at 360–430px have no horizontal overflow (fix overflow sources found).

## Verification

Playwright WebKit mobile (iPhone profile, `isMobile`, `hasTouch`) and Chromium Android: focus email/password
→ `visualViewport.scale === 1`; after sign-in `scale === 1` and `scrollWidth <= innerWidth`; portrait +
landscape; keyboard-open is emulated by a reduced viewport height (stated as emulation — real-device
confirmation requested from the owner). Screens: ar/en × light/dark × desktop/mobile, before/after.
