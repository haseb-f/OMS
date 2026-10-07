# W7 — Branded Arabic user manual (after release)

Location: `docs/user-manual/` — `source/` (Markdown/JSON chapter sources, build script),
`screenshots/` (raw + annotated PNG), `OMS-دليل-المستخدم-<version>.docx` and `.pdf`.

- Built from the released system on a local copy of the release with clean demonstration data
  (seeded demo company, agent, partners; no real customers, no passwords in shots).
- Screenshots via Playwright at 1440×900 (desktop) and 390×844 (mobile samples), annotated (numbered
  callouts, highlight boxes) with a Node/sharp script.
- DOCX generated with `docx` (RTL sections, `bidi` paragraphs, `rightToLeft` tables, Arabic font
  "Cairo"/"Noto Naskh Arabic" embedded fallback), clickable TOC (heading bookmarks + internal links),
  page numbers, brand colours/logo from `Brand/`. PDF rendered from the DOCX via LibreOffice
  (`soffice --headless --convert-to pdf`) so both match; fallback: HTML → PDF via Playwright.
- Chapters by role and task: getting started (login, Home, session), company sales (leads, orders,
  customer lookup, repeat customers, history), shipping, inventory and costing (stock flow explained),
  purchasing, accounting & reports, expenses/assets, HR and users (job-title permissions), partners,
  agent portal, settings, troubleshooting, glossary. Version + preparation date on the cover.
- Every documented screen is verified to exist in the release; nothing unreleased is described.
- Visual QA: render each PDF page to PNG and inspect (Arabic shaping, RTL, clipping, page breaks).
