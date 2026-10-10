"""HTML rendering of the manual (input of the PDF). Same source and images as the DOCX."""
import base64
import html
from pathlib import Path

from meta import META, ROOT, figure_width_mm

SHOTS = ROOT / "screenshots" / "annotated"
ASSETS = ROOT / "assets"


def esc(t):
    return html.escape(t, quote=False)


def runs_html(runs):
    out = []
    for r in runs:
        t = esc(r["t"])
        if r.get("code"):
            t = f'<bdi dir="ltr" class="code">{t}</bdi>'
        if r.get("b"):
            t = f"<strong>{t}</strong>"
        out.append(t)
    return "".join(out)


def data_uri(path):
    return "data:image/png;base64," + base64.b64encode(Path(path).read_bytes()).decode()


def image_size(path):
    import struct

    with open(path, "rb") as f:
        head = f.read(24)
    w, h = struct.unpack(">II", head[16:24])
    return w, h


def block_html(b):
    t = b["type"]
    if t == "h1":
        return ""  # chapter header rendered by the caller
    if t == "h2":
        return f'<h2 id="{b["id"]}"><span class="num">{b["no"]}</span> {esc(b["text"])}<span class="mk">@@{b["id"]}@@</span></h2>'
    if t == "h3":
        return f'<h3 id="{b["id"]}">{esc(b["text"])}</h3>'
    if t == "p":
        return f"<p>{runs_html(b['runs'])}</p>"
    if t == "ul":
        return "<ul>" + "".join(f"<li>{runs_html(i['runs'])}</li>" for i in b["items"]) + "</ul>"
    if t == "ol":
        items = []
        for it in b["items"]:
            sub = ""
            if it["sub"]:
                sub = "<ul>" + "".join(f"<li>{runs_html(s)}</li>" for s in it["sub"]) + "</ul>"
            items.append(f'<li><span class="stepno">{it["n"]}</span><div>{runs_html(it["runs"])}{sub}</div></li>')
        return '<ol class="steps">' + "".join(items) + "</ol>"
    if t == "legend":
        return '<ul class="legend">' + "".join(
            f'<li><span class="badge">{i["n"]}</span><span>{runs_html(i["runs"])}</span></li>' for i in b["items"]
        ) + "</ul>"
    if t == "table":
        head = "".join(f"<th>{runs_html(c)}</th>" for c in b["header"])
        rows = "".join("<tr>" + "".join(f"<td>{runs_html(c)}</td>" for c in r) + "</tr>" for r in b["rows"])
        return f'<table class="grid"><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table>'
    if t == "box":
        body = []
        ul = []
        for x in b["body"]:
            if x["type"] == "li":
                ul.append(f"<li>{runs_html(x['runs'])}</li>")
            else:
                if ul:
                    body.append("<ul>" + "".join(ul) + "</ul>")
                    ul = []
                body.append(f"<p>{runs_html(x['runs'])}</p>")
        if ul:
            body.append("<ul>" + "".join(ul) + "</ul>")
        return f'<div class="box {b["kind"]}"><div class="box-title">{esc(b["title"])}</div>{"".join(body)}</div>'
    if t == "figure":
        path = SHOTS / f"{b['shot']}.png"
        w, h = image_size(path)
        style = f"width:{figure_width_mm(b['shot'], w, h, max_h=205.0):.1f}mm;"
        return (
            f'<figure id="fig{b["no"]}"><img src="{data_uri(path)}" style="{style}" alt="{esc(b["caption"])}"/>'
            f'<figcaption>شكل {b["no"]}: {esc(b["caption"])}</figcaption></figure>'
        )
    raise ValueError(t)


CSS = """
@page { size: A4; margin: 22mm 18mm 20mm 18mm;
  @top-right { content: "دليل مستخدم OMS"; font: 700 8.5pt Arial; color: #0F2747; }
  @top-left { content: "OMS R15 · __DATE__"; font: 8.5pt Arial; color: #5B6B82; }
  @bottom-center { content: "صفحة " counter(page) " من " counter(pages); font: 8.5pt Arial; color: #5B6B82; }
  @bottom-left { content: "SHA __SHA__"; font: 7.5pt Arial; color: #8A97AA; }
}
@page :first { margin: 0; @top-right { content: none } @top-left { content: none } @bottom-center { content: none } @bottom-left { content: none } }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Arial, "Sakkal Majalla", Tahoma, sans-serif; font-size: 10.5pt; line-height: 1.75; color: #1B2533; margin: 0; }
.cover { height: 297mm; width: 210mm; position: relative; background: #0F2747; color: #fff; overflow: hidden; break-after: page; }
.cover .band { position: absolute; inset: 0 0 auto 0; height: 118mm; background: #fff; display: flex; align-items: center; justify-content: center; }
.cover .band img { width: 150mm; }
.cover .stripe { position: absolute; top: 118mm; height: 4mm; width: 100%; background: linear-gradient(90deg, #3BB5C4, #3B6FD8, #0F2747); }
.cover .text { position: absolute; top: 140mm; right: 22mm; left: 22mm; }
.cover h1 { font-size: 34pt; margin: 0 0 4mm; line-height: 1.3; }
.cover .sub { font-size: 14pt; color: #BFD3F2; margin: 0 0 18mm; }
.cover table.meta { border-collapse: collapse; font-size: 11pt; }
.cover table.meta td { padding: 2mm 0 2mm 10mm; color: #E6EEF9; }
.cover table.meta td.k { color: #9FB6D8; }
.cover .foot { position: absolute; bottom: 16mm; right: 22mm; left: 22mm; font-size: 9pt; color: #9FB6D8; border-top: 1px solid #2D4A75; padding-top: 4mm; }
.toc { break-after: page; }
.toc h1 { font-size: 20pt; color: #0F2747; border-bottom: 3px solid #3B6FD8; padding-bottom: 3mm; margin: 0 0 6mm; }
.toc a { color: inherit; text-decoration: none; display: flex; align-items: baseline; gap: 2mm; }
.toc a .dots { flex: 1; border-bottom: 1px dotted #9AA7B8; transform: translateY(-1mm); }
.toc a .pg { min-width: 8mm; text-align: left; color: #3B6FD8; font-weight: 700; }
.toc .l1 { font-weight: 700; font-size: 11pt; margin-top: 2.6mm; }
.toc .l2 { font-size: 9.5pt; margin-inline-start: 8mm; color: #3A4658; }
.chapter { break-before: page; }
.chapter-head { display: flex; align-items: center; gap: 5mm; border-bottom: 3px solid #3B6FD8; padding-bottom: 3mm; margin-bottom: 6mm; break-after: avoid; }
.chapter-head .cnum { background: #0F2747; color: #fff; font-weight: 700; font-size: 18pt; width: 14mm; height: 14mm; border-radius: 3mm; display: flex; align-items: center; justify-content: center; }
.chapter-head h1 { font-size: 21pt; color: #0F2747; margin: 0; }
h2 { font-size: 14pt; color: #0F2747; margin: 7mm 0 2.5mm; break-after: avoid; border-inline-start: 4px solid #3BB5C4; padding-inline-start: 3mm; }
h2 .num { color: #3B6FD8; }
h3 { font-size: 11.5pt; color: #24456F; margin: 5mm 0 2mm; break-after: avoid; }
p { margin: 0 0 2.4mm; text-align: start; }
strong { color: #0F2747; }
.code { font-family: Consolas, "Courier New", monospace; font-size: 9.2pt; background: #EEF2F8; border: 1px solid #DCE3EE; border-radius: 1mm; padding: 0 1mm; unicode-bidi: isolate; white-space: nowrap; }
ul { margin: 0 0 3mm; padding-inline-start: 6mm; }
ul li { margin-bottom: 1mm; }
ol.steps { list-style: none; padding: 0; margin: 0 0 3mm; }
ol.steps li { display: flex; gap: 2.5mm; margin-bottom: 1.6mm; break-inside: avoid; }
ol.steps .stepno { flex: none; width: 6mm; height: 6mm; border-radius: 50%; background: #3B6FD8; color: #fff; font-size: 8.5pt; font-weight: 700; display: flex; align-items: center; justify-content: center; margin-top: 0.8mm; }
ol.steps ul { margin: 1mm 0 0; }
ul.legend { list-style: none; padding: 0; margin: 0 0 4mm; }
ul.legend li { display: flex; gap: 2.5mm; margin-bottom: 1.2mm; break-inside: avoid; }
ul.legend .badge { flex: none; width: 5.6mm; height: 5.6mm; border-radius: 50%; background: #E8590C; color: #fff; font-size: 8pt; font-weight: 700; display: flex; align-items: center; justify-content: center; margin-top: 0.9mm; direction: ltr; }
table.grid { width: 100%; border-collapse: collapse; margin: 1mm 0 4mm; font-size: 9.5pt; page-break-inside: auto; }
table.grid tr { break-inside: avoid; }
table.grid thead { display: table-header-group; }
table.grid th { background: #0F2747; color: #fff; text-align: start; padding: 1.8mm 2.5mm; font-weight: 700; }
table.grid td { border-bottom: 1px solid #DCE3EE; padding: 1.6mm 2.5mm; vertical-align: top; }
table.grid tbody tr:nth-child(even) td { background: #F5F8FC; }
p:has(+ figure), h3:has(+ figure) { break-after: avoid; }
figure + ul.legend { break-before: avoid; }
figure { margin: 3mm 0 2.5mm; text-align: center; break-inside: avoid; }
figure img { border: 1px solid #C9D3E1; border-radius: 1.5mm; box-shadow: 0 0.6mm 2mm rgba(15,39,71,0.12); max-width: 174mm; object-fit: contain; }
figcaption { font-size: 9pt; color: #3A4658; margin-top: 1.6mm; font-weight: 700; }
.box { border-radius: 2mm; padding: 2.6mm 4mm 1.4mm; margin: 2mm 0 4mm; border-inline-start: 4px solid; break-inside: avoid; font-size: 9.8pt; }
.mk { font-size: 1pt; color: #fdfdfd; letter-spacing: 0; }
.box .box-title { font-weight: 700; margin-bottom: 1mm; }
.box.note { background: #EEF4FD; border-color: #3B6FD8; }
.box.tip { background: #EAF7EF; border-color: #2E9D5B; }
.box.warn { background: #FFF5E6; border-color: #E08A00; }
.box ul { margin-bottom: 1mm; }
"""


def toc_html(manual, pages=None):
    pages = pages or {}
    rows = []
    for ch in manual["chapters"]:
        rows.append(
            f'<div class="l1"><a href="#{ch["blocks"][0]["id"]}"><span>{ch["no"]}. {esc(ch["title"])}</span>'
            f'<span class="dots"></span><span class="pg">{pages.get(ch["blocks"][0]["id"], "")}</span></a></div>'
        )
        for b in ch["blocks"]:
            if b["type"] == "h2":
                rows.append(
                    f'<div class="l2"><a href="#{b["id"]}"><span>{b["no"]} {esc(b["text"])}</span>'
                    f'<span class="dots"></span><span class="pg">{pages.get(b["id"], "")}</span></a></div>'
                )
    return '<section class="toc"><h1 id="toc">المحتويات</h1>' + "".join(rows) + "</section>"


def cover_html():
    logo = data_uri(ASSETS / "oms-logo.png")
    return f"""
<section class="cover">
  <div class="band"><img src="{logo}" alt="OMS"/></div>
  <div class="stripe"></div>
  <div class="text">
    <h1>دليل المستخدم</h1>
    <p class="sub">نظام إدارة العمليات OMS — شرح الشاشات والمهام حسب الدور الوظيفي</p>
    <table class="meta">
      <tr><td class="k">الإصدار</td><td><bdi dir="ltr">{META['version']}</bdi></td></tr>
      <tr><td class="k">رقم البناء (Git SHA)</td><td><bdi dir="ltr">{META['sha']}</bdi></td></tr>
      <tr><td class="k">تاريخ الإعداد</td><td><bdi dir="ltr">{META['date']}</bdi></td></tr>
      <tr><td class="k">اللغة</td><td>العربية</td></tr>
    </table>
  </div>
  <div class="foot">صور هذا الدليل مأخوذة من النظام الفعلي ببيانات تجريبية مُختلقة بالكامل (شركة الأفق للتجارة). لا تحتوي الصور على كلمات مرور أو بيانات عملاء حقيقيين.</div>
</section>"""


def build_html(manual, out_path, pages=None):
    parts = [cover_html(), toc_html(manual, pages)]
    for ch in manual["chapters"]:
        h1 = ch["blocks"][0]
        body = "".join(block_html(b) for b in ch["blocks"][1:])
        parts.append(
            f'<section class="chapter"><div class="chapter-head"><div class="cnum">{ch["no"]}</div>'
            f'<h1 id="{h1["id"]}">{esc(h1["text"])}<span class="mk">@@{h1["id"]}@@</span></h1></div>{body}</section>'
        )
    css = CSS.replace("__DATE__", META["date"]).replace("__SHA__", META["sha"])
    doc = f"""<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"/><title>دليل مستخدم OMS — {META['version']}</title>
<style>{css}</style></head><body>{''.join(parts)}</body></html>"""
    Path(out_path).write_text(doc, encoding="utf-8")
    return out_path
