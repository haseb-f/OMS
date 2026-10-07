"""
Builds the manual from source/*.md:
  python docs/user-manual/build/build.py            -> out/manual.json, out/manual.html, DOCX
  python docs/user-manual/build/build.py --pages out/pages.json   (second pass: TOC page numbers in the HTML)
The PDF is produced from out/manual.html by build/pdf.mjs (Playwright Chromium).
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_docx import build_docx  # noqa: E402
from build_html import build_html  # noqa: E402
from manual_source import load_manual  # noqa: E402
from meta import META, ROOT  # noqa: E402

OUT = ROOT / "build" / "out"
OUT.mkdir(parents=True, exist_ok=True)

manual = load_manual(ROOT / "source")
missing = [b["shot"] for ch in manual["chapters"] for b in ch["blocks"] if b["type"] == "figure" and not (ROOT / "screenshots" / "annotated" / f"{b['shot']}.png").exists()]
if missing:
    raise SystemExit(f"missing screenshots: {missing}")
(OUT / "manual.json").write_text(json.dumps(manual, ensure_ascii=False, indent=1), encoding="utf-8")

pages = None
if "--pages" in sys.argv:
    pages = json.loads(Path(sys.argv[sys.argv.index("--pages") + 1]).read_text(encoding="utf-8"))
build_html(manual, OUT / "manual.html", pages)

if "--html-only" not in sys.argv:
    stats = build_docx(manual, ROOT / f"{META['file_stem']}.docx")
    (OUT / "docx-stats.json").write_text(json.dumps(stats, ensure_ascii=False), encoding="utf-8")
    print("docx", stats)
print(json.dumps({"chapters": len(manual["chapters"]), "figures": manual["figures"]}, ensure_ascii=False))
