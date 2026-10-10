# QA record — OMS Arabic user manual R15

Prepared 2026-10-10 against release R15 (`main` @ `8c43566e` + the fixes found while capturing, `f26b0ec5`),
built locally (`nest build` → `apps/api/dist`, `next build` → `apps/web/.next`; API :4505 / web :4501) on the
demonstration database `oms_r15_manual`: the R14 manual database (`oms_r14_manual`, unchanged) copied and
migrated forward to R15 with `prisma migrate deploy` (the deployed-schema path), then the R15 demo steps of
`build/demo-data.mjs` run through the API (snapshot `oms_r15_manual_base` = migrated, before the R15 steps).

## Outputs

| File                         | Size           | Notes                                                                                                                 |
| ---------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------- |
| `OMS-دليل-المستخدم-R15.pdf`  | 9.3 MB         | **110 pages**, A4 portrait, RTL; cover, 3-page clickable table of contents with page numbers, 13 chapters, 85 figures |
| `OMS-دليل-المستخدم-R15.docx` | 2.7 MB         | same source; 99 TOC entries (internal hyperlinks + PAGEREF fields), 128 bookmarked Word headings, 85 figures          |
| `screenshots/raw/`           | 85 PNG, 2.5 MB | max 119 KB per file                                                                                                   |
| `screenshots/annotated/`     | 85 PNG, 2.6 MB | numbered callouts + highlight boxes injected into the live page before capture                                        |

The R14 outputs (`OMS-دليل-المستخدم-R14.*`) were removed from the folder; they remain in git history.

## What changed from R14

- **Text:** chapters 1 (what is new in R15), 2 (portals, partners section), 3 (stock at creation, shortage and
  «احجز الآن», stock column / filter / panel, Excel and Google Sheets imports, own rank), 4 (hand-over to the
  carrier → goods in transit, partial dispatch, delivery with accepted quantities, receiving returned goods,
  the R15 status table), 5 (reserve → transit → deliver model, estimated vs posted COGS, system warehouses,
  returns «إرجاع» → «استلام وفحص» → credit note), 7 (collection only from verified payments, carrier COD
  claims → statement match, refund due / record refund, payment reversal), 8 (R15 permissions table),
  9 (own section, partner page cards, partner login, partner portal, after the partnership ends),
  10 (agent dashboards, shared four-step order flow, agent imports, company-side agent overviews, the agent
  shipping agreement with the worked example), 11 (carrier COD collection method), 12 (11 new problems with
  the exact messages), 13 (11 new terms, table sorted).
- **Figures:** 20 new (03-13 … 03-17, 04-04 … 04-07, 05-09, 05-10, 07-08 … 07-10, 09-07, 09-08,
  10-08 … 10-11); 03-05, 05-01, 05-02, 09-02, 10-02, 10-07 redefined for R15 screens; all 85 recaptured.

## What was checked

### Content accuracy

- Every label in the text was taken from the running screen or `apps/web/src/i18n/messages` (Arabic),
  including the permission names as the permission matrix shows them.
- Behaviour statements follow the R15 decisions (`specs/round15-completion/decisions.md`, D15-1 … D15-21) and
  the handoff (`specs/round15-completion/handoff-ar.md`), and were seen on the demo system: reservation at
  creation for prepaid and COD orders; a SHORT order (3 requested, 2 available) with its shortage note and
  «احجز الآن»; hand-over dialog (quantities per line); in transit with the transfer movements; delivery with
  accepted quantities (partial acceptance 1 of 2); a failed parcel «في طريق العودة» and the receive-back dialog
  (saleable / damaged → WH-DAMAGED); prepaid declaration → Finance verification; carrier COD claim → statement
  match → «المحصّل (مؤكد)» / «لدى شركة الشحن»; return → receive & inspect → credit note → «مستحق الرد» → record
  refund; Excel imports with a rejected lead row (missing phone) and an order row waiting for review; the agent
  shipping agreement (migrated active agreement + a duplicated draft from 1 Nov); agent admin dashboard with
  the team breakdown; partner login created by the accountant; partner portal overview and statement.
- Demo data is fictitious (company «شركة الأفق للتجارة», phones `+20 10 0000 0xxx`) and was created through
  the API by role personas; password inputs are blanked before every capture; no password appears in any
  document or file of this folder.

### Defects found while capturing (fixed in `f26b0ec5`, before the screenshots were final)

- Import uploads stored an Arabic file name as mojibake (multipart name decoded as Latin-1) — now UTF-8, with an
  HTTP regression test.
- Agent order quote showed an English-only message in Arabic; the worked price line and list price were
  reordered by the bidi algorithm.
- Dates, phones and codes inside Arabic sentences were reordered on several screens (recognition notice,
  duplicate panel, amendment history, partner pages, agent header phone, shipping-agreement «أنشأها / فعّلها»,
  stock panel shipment line).
- The order form's shortage hint described a status and an automatic reservation that R15 does not have.

### PDF (rendered page by page)

- Every page was rendered to PNG with pdf.js (`RENDER=1 node build/pdf.mjs`) and reviewed as contact sheets
  (`build/contact-sheet.mjs`, 14 sheets); full-size review of every new or redefined figure. Found and fixed
  during review: the related-records figure (05-01) was captured as a whole-page miniature (its R14 clip
  container changed) — now clipped to the panel with all 9 callouts; the refund figure scrolled its title under
  the sticky header; a stale «R14» in the settings table.
- Arabic shaping and RTL order correct in body, tables, boxes, header/footer; codes, phone numbers and document
  numbers are isolated LTR and read correctly.
- No clipped text or images; figures are never split; headings stay with the next block; table header rows
  repeat on continuation pages; the cover has no header/footer.
- TOC page numbers: computed in a second pass from heading markers found in the PDF text (96 of 99 found
  directly, 3 placed by their neighbour — 1.1, 1.2 and 8.2 — each verified on its page); all TOC entries are
  clickable anchors; the PDF also carries a document outline.
- Every figure's legend numbers equal its callout numbers (checked by script against `build/shot-list.mjs`).

### DOCX (re-opened with python-docx — `build/qa_docx.py`, result in `build/out/docx-qa.json`)

- Section `w:bidi` ✓; 1,466 / 1,466 non-empty paragraphs `w:bidi` ✓; no absolute `left/right` `w:jc` on RTL
  paragraphs ✓; Arabic runs `w:rtl` with Arial as the complex-script font ✓; 45 / 45 tables `w:bidiVisual` ✓.
- 99 TOC hyperlinks = 99 PAGEREF fields = 99 hyperlinks resolving to heading bookmarks ✓; 128 headings use
  Word heading styles with bookmarks ✓; 85 figures + cover logo present ✓; header logo/title/release and footer
  `PAGE` / `NUMPAGES` fields + SHA ✓.

## Limitations

- The DOCX page numbers in the TOC are Word fields: Word computes them when the document is opened (or with
  F9); the PDF carries the computed numbers.
- The migrated shipping agreement keeps its English note («Migrated from the tariff of agreement …») — it is
  stored data, shown as typed.
- The system warehouses are named «بضاعة في الطريق — Goods in transit» / «بضاعة تالفة — Damaged goods» by the
  migration (renamable by an administrator).
