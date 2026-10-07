# QA record — OMS Arabic user manual R14

Prepared 2026-10-07 against release `main` @ `02368c18`, on a local copy of the release
(API `apps/api/dist`, web `apps/web/.next`) with the clean demonstration database `oms_r14_manual`.

## Outputs

| File                         | Size           | Notes                                                                                                                |
| ---------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `OMS-دليل-المستخدم-R14.pdf`  | 7.1 MB         | **83 pages**, A4 portrait, RTL; cover, 3-page clickable table of contents with page numbers, 13 chapters, 64 figures |
| `OMS-دليل-المستخدم-R14.docx` | 2.1 MB         | same source; 87 TOC entries (internal hyperlinks + PAGEREF fields), 105 bookmarked Word headings, 64 figures         |
| `screenshots/raw/`           | 64 PNG, 1.9 MB | max 125 KB per file                                                                                                  |
| `screenshots/annotated/`     | 64 PNG, 2.0 MB | numbered callouts + highlight boxes injected into the live page before capture                                       |

## What was checked

### Content accuracy

- Every documented screen was opened in the running release and its labels were taken from the UI or
  from `apps/web/src/i18n/messages` (Arabic). Each figure is a real capture of the system.
- Behaviour statements were checked against the R14 specs (`specs/round14-production-readiness/*`), the
  session policy and the API code: recognition at delivery (reservation → issue → COGS), failure codes and
  retry, job-title templates / individual grant / deny, impact preview, review flag, shipping-carrier
  permission, advanced lookup limits, repeat-customer rule, partner agreements / preview / review / close /
  payment, accounts required in Settings → Accounting.
- Demo figures in the text were verified in the database: order `STO-2026-000001` → `INV-2026-000001`,
  `JV-2026-000003` (Dr AR 1,540 / Cr revenue 1,540; Dr COGS 800 / Cr inventory 800), reservation /
  release / delivery movements `MV/10/2026/000005–7`; return `SR-2026-000001` on `INV-2026-000002`
  (JV-2026-000006: 120 / 45); partner October period: net 3,345.00, gross 7,995.00 → 1,003.50 + 1,599.00,
  payment 600.00 → remaining 403.50.
- Demo data is fictitious (company «شركة الأفق للتجارة», phones `+20 10 0000 0xxx`) and was created through
  the API by role personas; password inputs are blanked before every capture; no password appears in any
  document or file of this folder.

### PDF (rendered page by page)

- Every page was rendered to PNG with pdf.js (`RENDER=1 node build/pdf.mjs`) and reviewed as contact sheets
  (`build/contact-sheet.mjs`), plus full-size review of the cover, TOC, chapter openers, tables (1.2, 2.6,
  5.1, 5.3, 9.7), the glossary (long table), and screenshot pages (2.1, 2.2, 3.3–3.4, 5.3, 8.4, 9.4).
- Arabic shaping and RTL order correct in body, tables, boxes, header/footer; codes, phone numbers and
  document numbers are isolated LTR (`<bdi dir="ltr">`) and read correctly.
- No clipped text or images; figures are never split (`break-inside: avoid`); headings stay with the next
  block; an introductory paragraph stays with its figure and the figure with its legend; table header rows
  repeat on continuation pages; the cover has no header/footer.
- TOC page numbers: computed in a second pass from heading markers found in the PDF text (86 of 87 found
  directly, 1 placed by its neighbour on the same page); all TOC entries are clickable anchors; the PDF also
  carries a document outline.

### DOCX (re-opened with python-docx — `build/qa_docx.py`, result in `build/out/docx-qa.json`)

- Section `w:bidi` ✓; 1,141 / 1,141 non-empty paragraphs `w:bidi` ✓; no absolute `left/right` `w:jc` on RTL
  paragraphs (alignment = paragraph start = right) ✓; 2,195 / 2,195 Arabic runs `w:rtl` with Arial as the
  complex-script font ✓; 37 / 37 tables `w:bidiVisual` ✓.
- 87 TOC hyperlinks = 87 PAGEREF fields = 87 hyperlinks resolving to heading bookmarks ✓; 105 headings use
  Word heading styles with bookmarks ✓; 64 figures + cover logo present ✓; header logo/title/release and
  footer `PAGE` / `NUMPAGES` fields + SHA ✓.

## Limitations

1. **DOCX page numbers:** the TOC page numbers and «صفحة X من Y» are Word fields. The file asks Word to
   update fields on open (accept the prompt), or press `Ctrl+A` then `F9`. Until then the TOC shows titles
   only (still clickable).
2. **PDF is produced from the HTML rendering of the same source, not from the DOCX** (no Word/LibreOffice on
   this machine). Content is identical; pagination differs. The DOCX layout was validated structurally (above),
   not visually.
3. pdf.js (cdnjs) is used only to render PDF pages for QA and to locate heading pages.
4. The web build used for screenshots was built at 12:11, before commit `86ceaf58` (sign-out redirect fix);
   no documented screen is affected.

## Not documented (not available or not demonstrable in R14)

- Placeholder pages («قريبًا»): Settings → بيانات الشركة, إعدادات الطباعة, الإشعارات, الأمان, النسخ الاحتياطي,
  التكاملات; Reports → التنفيذية, علاقات العملاء, المشتريات, التكاليف, الشحن, المخصصة, التحليلية. Listed as such.
- `RETURN_PENDING` («مرتجع قيد المعالجة») is described but not shown: in R14 it is reached only from a pickup
  marked RETURNED or a carrier status whose code contains `RETURN` (imports); user-created shipping statuses
  get `USR_…` codes, and delivered → failed / needs-reshipment is refused.
- Covered only briefly (outside the requested scope): HR payroll / KPI / targets / commissions, investors,
  landed cost, Import Center details, B2B quotations / sales orders, dashboard widgets.

## Observations for the product team (seen while capturing)

- English / raw strings in the Arabic UI: `actions` column header (partners list, saved partner periods,
  agreements tab); raw permission names `lookup_global`, `generate_invoice` in the permission matrix and raw
  keys (`reports.sales.view`) in the job-title impact preview; stock movement chip `sales return`; Inventory
  integrity metric names (Movements, Chains, Keyed movements…); document-numbering labels in English.
- Job titles page subtitle still says that changing the job title never changes a user's permissions, which
  contradicts R14 job-title templates.
- Shipping → استيراد الشحن is visible to `shipping.view` users but needs Import Center permission (toast
  «لا توجد صلاحية» on open).
- Partner statement summary cards squeeze into vertical text when the content area is narrower than
  about 1,350 px (screenshot taken at a 1,600 px viewport).
- Partner periods can be closed before the period has ended (the demo closes October 2026 on 7 October).
