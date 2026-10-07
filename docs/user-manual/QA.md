# QA record — OMS Arabic user manual R14

Prepared 2026-10-07 against the final release `main` @ `0db15e41` (R14 + fix/r14-polish), rebuilt locally
(`nest build` → `apps/api/dist`, `next build` → `apps/web/.next`, API :3005 / web :3001) on a freshly
recreated clean demonstration database `oms_r14_manual`. Refresh of the first version (based on `02368c18`):
all 65 figures recaptured on the final build; partner demo reworked to close September 2026 (a past period).

## Outputs

| File                         | Size           | Notes                                                                                                                |
| ---------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `OMS-دليل-المستخدم-R14.pdf`  | 7.4 MB         | **84 pages**, A4 portrait, RTL; cover, 3-page clickable table of contents with page numbers, 13 chapters, 65 figures |
| `OMS-دليل-المستخدم-R14.docx` | 2.2 MB         | same source; 87 TOC entries (internal hyperlinks + PAGEREF fields), 105 bookmarked Word headings, 65 figures         |
| `screenshots/raw/`           | 65 PNG, 1.9 MB | max 125 KB per file                                                                                                  |
| `screenshots/annotated/`     | 65 PNG, 2.1 MB | numbered callouts + highlight boxes injected into the live page before capture                                       |

## What was checked

### Content accuracy

- Every documented screen was opened in the running release and its labels were taken from the UI or
  from `apps/web/src/i18n/messages` (Arabic). Each figure is a real capture of the system.
- Behaviour statements were checked against the R14 specs (`specs/round14-production-readiness/*`), the
  session policy and the API code: recognition at delivery (reservation → issue → COGS), failure codes and
  retry, job-title templates / individual grant / deny, impact preview, review flag, shipping-carrier
  permission, advanced lookup limits, repeat-customer rule, partner agreements / preview / review / close /
  payment, accounts required in Settings → Accounting, and (final release) closing a partner period only after
  its last Cairo day: the API refused closing October 2026 on 7 October with `PERIOD_NOT_ENDED`, and the UI
  shows the «لم تنتهِ هذه الفترة بعد» note with the disabled «إقفال وترحيل — بعد انتهاء الفترة» action (figure 54).
- Demo figures in the text were verified in the database: order `STO-2026-000001` → `INV-2026-000001`,
  `JV-2026-000003` (Dr AR 1,540 / Cr revenue 1,540; Dr COGS 800 / Cr inventory 800), reservation /
  release / delivery movements `MV/10/2026/000005–7`; return `SR-2026-000001` on `INV-2026-000002`
  (JV-2026-000007: 120 / 45). Partners, September 2026 (CLOSED, `JV-2026-000019` dated 30 Sep): revenue
  30,000.00, cost of sales 12,000.00, gross 18,000.00, expenses 4,650.00, net 13,350.00 → خالد 30 % net =
  4,005.00, دينا 20 % gross = 3,600.00, total 7,605.00, retained 5,745.00; payment 2,000.00 → خالد remaining
  2,005.00. October 2026 saved as a review only (net 3,345.00 / gross 7,995.00 → 1,003.50 + 1,599.00 تقديري).
  September's trading is recorded as two summary journal entries and three expense vouchers dated in September
  (documents themselves cannot be back-dated through the API).
- Demo data is fictitious (company «شركة الأفق للتجارة», phones `+20 10 0000 0xxx`) and was created through
  the API by role personas; password inputs are blanked before every capture; no password appears in any
  document or file of this folder.

### PDF (rendered page by page)

- Every page was rendered to PNG with pdf.js (`RENDER=1 node build/pdf.mjs`) and reviewed as contact sheets
  (`build/contact-sheet.mjs`), plus full-size review of the cover, TOC, chapter openers, tables (1.2, 2.6,
  5.1, 5.3, 9.7), the glossary (long table), and screenshot pages (2.1, 2.2, 3.3–3.4, 5.3, 8.4, 9.4). Refresh:
  re-rendered all 84 pages; full-size review of the cover (SHA 0db15e41), chapter 9 pages 59–67 (partner
  cards, periods, not-ended note, numeric example), the settings/partners page and the changed figures
  (job titles, permission matrix, impact preview, movement chips, inventory integrity, document numbering).
- Arabic shaping and RTL order correct in body, tables, boxes, header/footer; codes, phone numbers and
  document numbers are isolated LTR (`<bdi dir="ltr">`) and read correctly.
- No clipped text or images; figures are never split (`break-inside: avoid`); headings stay with the next
  block; an introductory paragraph stays with its figure and the figure with its legend; table header rows
  repeat on continuation pages; the cover has no header/footer.
- TOC page numbers: computed in a second pass from heading markers found in the PDF text (86 of 87 found
  directly, 1 placed by its neighbour); all TOC entries are clickable anchors; the PDF also
  carries a document outline.

### DOCX (re-opened with python-docx — `build/qa_docx.py`, result in `build/out/docx-qa.json`)

- Section `w:bidi` ✓; 1,152 / 1,152 non-empty paragraphs `w:bidi` ✓; no absolute `left/right` `w:jc` on RTL
  paragraphs (alignment = paragraph start = right) ✓; 2,227 / 2,227 Arabic runs `w:rtl` with Arial as the
  complex-script font ✓; 38 / 38 tables `w:bidiVisual` ✓.
- 87 TOC hyperlinks = 87 PAGEREF fields = 87 hyperlinks resolving to heading bookmarks ✓; 105 headings use
  Word heading styles with bookmarks ✓; 65 figures + cover logo present ✓; header logo/title/release and
  footer `PAGE` / `NUMPAGES` fields + SHA ✓.

## Limitations

1. **DOCX page numbers:** the TOC page numbers and «صفحة X من Y» are Word fields. The file asks Word to
   update fields on open (accept the prompt), or press `Ctrl+A` then `F9`. Until then the TOC shows titles
   only (still clickable).
2. **PDF is produced from the HTML rendering of the same source, not from the DOCX** (no Word/LibreOffice on
   this machine). Content is identical; pagination differs. The DOCX layout was validated structurally (above),
   not visually.
3. pdf.js (cdnjs) is used only to render PDF pages for QA and to locate heading pages.
4. The September 2026 profit used for the closed partner period comes from summary journal entries (see
   above), because sales / purchase documents are always dated on the day they are confirmed.

## Not documented (not available or not demonstrable in R14)

- Placeholder pages («قريبًا»): Settings → بيانات الشركة, إعدادات الطباعة, الإشعارات, الأمان, النسخ الاحتياطي,
  التكاملات; Reports → التنفيذية, علاقات العملاء, المشتريات, التكاليف, الشحن, المخصصة, التحليلية. Listed as such.
- `RETURN_PENDING` («مرتجع قيد المعالجة») is described but not shown: in R14 it is reached only from a pickup
  marked RETURNED or a carrier status whose code contains `RETURN` (imports); user-created shipping statuses
  get `USR_…` codes, and delivered → failed / needs-reshipment is refused.
- Covered only briefly (outside the requested scope): HR payroll / KPI / targets / commissions, investors,
  landed cost, Import Center details, B2B quotations / sales orders, dashboard widgets.

## Observations for the product team (seen while capturing)

Fixed in `0db15e41` and verified in the recaptured figures: Arabic labels (actions column, permission action
names, impact-preview labels, movement chips, integrity metric labels, document numbering), the job-titles
subtitle, the shipping-import entry gating, the responsive partner summary cards, and closing a partner period
only after it ends. Still open:

- Sales → استيراد الطلبات is still listed for `store-orders.view` alone, while its page runs Import Center jobs
  (importing needs `import-center.manage`) — the same pattern that was fixed for the shipping import entry.
- Inventory integrity: the per-check scope notes are still English (e.g. «Keyed (R13) movements are protected
  by a unique index…»).
- Job-title impact preview: an implied module permission is still shown as a raw key (`reports.view`) next to
  «تقارير المبيعات — عرض» (figure 48).
