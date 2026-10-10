"""
Re-opens the generated DOCX with python-docx and checks the RTL / navigation invariants:
section bidi, paragraph bidi, table bidiVisual, Arabic runs rtl + cs font, heading bookmarks vs
TOC hyperlinks (and PAGEREF fields), images, header/footer fields. Writes build/out/docx-qa.json.
"""
import json
import re
import sys
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn

sys.path.insert(0, str(Path(__file__).resolve().parent))
from meta import META, ROOT  # noqa: E402

FIGURES = json.loads((ROOT / "build" / "out" / "manual.json").read_text(encoding="utf-8"))["figures"]
path = ROOT / f"{META['file_stem']}.docx"
doc = Document(str(path))
body = doc.element.body
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
ARABIC = re.compile(r"[؀-ۿ]")


def all_paragraphs():
    yield from body.iter(f"{W}p")


paras = list(all_paragraphs())
non_empty = [p for p in paras if "".join(t.text or "" for t in p.iter(f"{W}t")).strip()]
bidi = [p for p in non_empty if p.find(f"{W}pPr/{W}bidi") is not None]
jc_lr = [p for p in non_empty if (j := p.find(f"{W}pPr/{W}jc")) is not None and j.get(f"{W}val") in ("left", "right")]

runs = list(body.iter(f"{W}r"))
arabic_runs = [r for r in runs if ARABIC.search("".join(t.text or "" for t in r.iter(f"{W}t")))]
arabic_rtl = [r for r in arabic_runs if r.find(f"{W}rPr/{W}rtl") is not None]
arabic_cs = [r for r in arabic_runs if (f := r.find(f"{W}rPr/{W}rFonts")) is not None and f.get(f"{W}cs")]

tables = list(body.iter(f"{W}tbl"))
tables_bidi = [t for t in tables if t.find(f"{W}tblPr/{W}bidiVisual") is not None]

bookmarks = {b.get(f"{W}name") for b in body.iter(f"{W}bookmarkStart")}
links = [h.get(f"{W}anchor") for h in body.iter(f"{W}hyperlink") if h.get(f"{W}anchor")]
pagerefs = [t.text for t in body.iter(f"{W}instrText") if "PAGEREF" in (t.text or "")]
headings = [p for p in paras if (s := p.find(f"{W}pPr/{W}pStyle")) is not None and s.get(f"{W}val", "").startswith("Heading")]
headings_with_bm = [p for p in headings if p.find(f"{W}bookmarkStart") is not None]
images = list(body.iter("{http://schemas.openxmlformats.org/drawingml/2006/picture}pic"))

sect = doc.sections[0]._sectPr
hdr_fields = []
for part in (doc.sections[0].footer, doc.sections[0].header):
    hdr_fields += [t.text.strip() for t in part._element.iter(f"{W}instrText")]

toc_targets = [a for a in links if a != "toc"]
report = {
    "file": path.name,
    "size_bytes": path.stat().st_size,
    "section_bidi": sect.find(f"{W}bidi") is not None,
    "paragraphs_non_empty": len(non_empty),
    "paragraphs_bidi": len(bidi),
    "paragraphs_with_absolute_left_right_jc": len(jc_lr),
    "arabic_runs": len(arabic_runs),
    "arabic_runs_rtl": len(arabic_rtl),
    "arabic_runs_cs_font": len(arabic_cs),
    "tables": len(tables),
    "tables_bidiVisual": len(tables_bidi),
    "headings": len(headings),
    "headings_bookmarked": len(headings_with_bm),
    "toc_hyperlinks": len(toc_targets),
    "toc_pageref_fields": len(pagerefs),
    "toc_links_resolving_to_bookmarks": sum(1 for a in toc_targets if a in bookmarks),
    "images": len(images),
    "header_footer_fields": hdr_fields,
}
checks = {
    "section is RTL": report["section_bidi"],
    "every non-empty paragraph is bidi": report["paragraphs_bidi"] == report["paragraphs_non_empty"],
    "no absolute left/right alignment on RTL paragraphs": report["paragraphs_with_absolute_left_right_jc"] == 0,
    "every Arabic run is rtl with a cs font": report["arabic_runs_rtl"] == report["arabic_runs"] == report["arabic_runs_cs_font"],
    "every table is bidiVisual": report["tables_bidiVisual"] == report["tables"],
    "TOC hyperlinks == PAGEREF fields == bookmarked TOC headings": report["toc_hyperlinks"] == report["toc_pageref_fields"] == report["toc_links_resolving_to_bookmarks"],
    "all images present (every figure + cover logo)": report["images"] >= FIGURES + 1,
    "PAGE and NUMPAGES in footer": "PAGE" in hdr_fields and "NUMPAGES" in hdr_fields,
}
report["checks"] = checks
(ROOT / "build" / "out" / "docx-qa.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=1))
sys.exit(0 if all(checks.values()) else 1)
