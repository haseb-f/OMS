"""Release metadata shared by the DOCX and HTML/PDF builders."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # docs/user-manual
META = {
    "version": "R15",
    "sha": "f26b0ec5",
    "date": "2026-10-10",
    "title": "دليل مستخدم OMS",
    "file_stem": "OMS-دليل-المستخدم-R15",
}


def figure_width_mm(shot, w, h, max_w=174.0, max_h=200.0):
    """One sizing rule for DOCX and PDF: a 1150 px desktop capture spans the text width (174 mm);
    smaller crops (dialogs, menus) are enlarged 1.1x for legibility; tall images are capped."""
    if shot.startswith("02-05"):  # phone capture (2x)
        width = 78.0
    else:
        # A 1150 px capture (1200 px viewport minus the icon rail) spans the text width.
        width = min(max_w, w * (174.0 / 1150.0) * (1.1 if w < 900 else 1.0))
    if width * h / w > max_h:
        width = max_h * w / h
    return width
