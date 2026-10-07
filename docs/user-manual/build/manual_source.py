"""
Parser for the manual's Markdown subset (documented in docs/user-manual/README.md).

Supported, one construct per line group:
  # / ## / ###            chapter / section / subsection headings
  plain lines             paragraph (consecutive lines are joined)
  1. text                 numbered step (a following "   - text" line is a sub-bullet of that step)
  - text                  bullet
  - [n] text              callout legend item (explains badge n of the preceding figure)
  | a | b |               table (first row = header, second row = --- separator)
  ![caption](shot-id)     figure: screenshots/annotated/<shot-id>.png, auto-numbered «شكل n»
  > [!note|tip|warn] t    note box with title t; following "> ..." lines are its body ("> - x" = bullet)
Inline: **bold**, `code` (rendered left-to-right, monospace).
"""
import json
import re
from pathlib import Path

BOX_TITLES = {"note": "ملاحظة", "tip": "نصيحة", "warn": "تنبيه"}


def parse_inline(text):
    """Split text into runs: [{"t": str, "b": bool, "code": bool}]."""
    runs = []
    pattern = re.compile(r"(\*\*.+?\*\*|`[^`]+`)")
    pos = 0
    for m in pattern.finditer(text):
        if m.start() > pos:
            runs.append({"t": text[pos:m.start()], "b": False, "code": False})
        tok = m.group(0)
        if tok.startswith("**"):
            inner = tok[2:-2]
            # allow `code` inside bold
            for r in parse_inline(inner):
                r["b"] = True
                runs.append(r)
        else:
            runs.append({"t": tok[1:-1], "b": False, "code": True})
        pos = m.end()
    if pos < len(text):
        runs.append({"t": text[pos:], "b": False, "code": False})
    return runs


def parse_file(path, chapter_no, fig_counter):
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    blocks = []
    i = 0
    sec = 0
    sub = 0
    last_was_figure = False
    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if not s:
            i += 1
            continue
        if s.startswith("# "):
            blocks.append({"type": "h1", "text": s[2:].strip(), "id": f"h{chapter_no:02d}", "no": chapter_no})
            i += 1
            continue
        if s.startswith("## "):
            sec += 1
            sub = 0
            blocks.append({"type": "h2", "text": s[3:].strip(), "id": f"h{chapter_no:02d}_{sec:02d}", "no": f"{chapter_no}.{sec}"})
            i += 1
            continue
        if s.startswith("### "):
            sub += 1
            blocks.append({"type": "h3", "text": s[4:].strip(), "id": f"h{chapter_no:02d}_{sec:02d}_{sub:02d}"})
            i += 1
            continue
        m = re.match(r"^!\[(.+)\]\(([^)]+)\)$", s)
        if m:
            fig_counter[0] += 1
            blocks.append({"type": "figure", "caption": m.group(1), "shot": m.group(2), "no": fig_counter[0]})
            last_was_figure = True
            i += 1
            continue
        if s.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.match(r"^:?-{3,}:?$", c) for c in cells):
                    rows.append([parse_inline(c) for c in cells])
                i += 1
            blocks.append({"type": "table", "header": rows[0], "rows": rows[1:]})
            continue
        if s.startswith(">"):
            m = re.match(r"^>\s*\[!(\w+)\]\s*(.*)$", s)
            kind = m.group(1) if m else "note"
            title = (m.group(2) if m else "") or BOX_TITLES.get(kind, "")
            body = []
            i += 1 if m else 0
            while i < len(lines) and lines[i].strip().startswith(">"):
                t = lines[i].strip()[1:].strip()
                if t.startswith("- "):
                    body.append({"type": "li", "runs": parse_inline(t[2:])})
                elif t:
                    body.append({"type": "p", "runs": parse_inline(t)})
                i += 1
            blocks.append({"type": "box", "kind": kind, "title": title, "body": body})
            continue
        if re.match(r"^\d+\.\s", s):
            items = []
            while i < len(lines) and (re.match(r"^\d+\.\s", lines[i].strip()) or re.match(r"^\s{2,}-\s", lines[i])):
                t = lines[i]
                if re.match(r"^\s{2,}-\s", t):
                    items[-1]["sub"].append(parse_inline(t.strip()[2:]))
                else:
                    n, rest = t.strip().split(".", 1)
                    items.append({"n": int(n), "runs": parse_inline(rest.strip()), "sub": []})
                i += 1
            blocks.append({"type": "ol", "items": items})
            continue
        if s.startswith("- "):
            items = []
            legend = re.match(r"^-\s\[(\d+)\]\s", s) is not None
            while i < len(lines) and lines[i].strip().startswith("- "):
                t = lines[i].strip()[2:]
                lm = re.match(r"^\[(\d+)\]\s(.*)$", t)
                if legend and lm:
                    items.append({"n": int(lm.group(1)), "runs": parse_inline(lm.group(2))})
                else:
                    items.append({"runs": parse_inline(t)})
                i += 1
            blocks.append({"type": "legend" if legend else "ul", "items": items})
            continue
        # paragraph
        para = [s]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#|!\[|\||>|-\s|\d+\.\s)", lines[i].strip()):
            para.append(lines[i].strip())
            i += 1
        blocks.append({"type": "p", "runs": parse_inline(" ".join(para))})
    return blocks


def load_manual(source_dir):
    files = sorted(p for p in Path(source_dir).glob("[0-9][0-9]-*.md"))
    fig = [0]
    chapters = []
    for n, f in enumerate(files, start=1):
        blocks = parse_file(f, n, fig)
        chapters.append({"file": f.name, "no": n, "title": blocks[0]["text"], "blocks": blocks})
    return {"chapters": chapters, "figures": fig[0]}


if __name__ == "__main__":
    import sys

    m = load_manual(sys.argv[1])
    print(json.dumps({"chapters": len(m["chapters"]), "figures": m["figures"]}, ensure_ascii=False))
