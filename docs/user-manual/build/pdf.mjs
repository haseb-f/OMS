/* eslint-disable no-console */
/**
 * Renders build/out/manual.html to the PDF with Playwright Chromium (A4, RTL, page numbers in the
 * page margin boxes, clickable TOC anchors), in two passes so the TOC carries real page numbers:
 *   1. print → find the page of every heading marker (@@hNN_MM@@) with pdf.js text extraction
 *   2. rebuild the HTML with those numbers (python build.py --pages ...) → print again
 * QA: RENDER=1 also renders every PDF page to build/out/pages/page-NNN.png (pdf.js canvas).
 *
 *   node docs/user-manual/build/pdf.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const ROOT = "D:/Systems/OMS/docs/user-manual";
const OUT = `${ROOT}/build/out`;
const PDF = `${ROOT}/OMS-دليل-المستخدم-R15.pdf`;
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";

const browser = await chromium.launch();

async function print() {
  const page = await browser.newPage();
  await page.goto("file:///" + `${OUT}/manual.html`.replace(/\\/g, "/"), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const buf = await page.pdf({ preferCSSPageSize: true, printBackground: true, outline: true, tagged: true });
  await page.close();
  return buf;
}

async function withPdfJs(buf, fn) {
  const v = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
  await v.setContent(`<html><body style="margin:0"><script src="${PDFJS}/pdf.min.js"></script></body></html>`);
  await v.waitForFunction(() => window.pdfjsLib);
  await v.evaluate(
    async ({ b64, src }) => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${src}/pdf.worker.min.js`;
      const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      window.__doc = await window.pdfjsLib.getDocument({ data }).promise;
    },
    { b64: buf.toString("base64"), src: PDFJS },
  );
  const r = await fn(v);
  await v.close();
  return r;
}

async function headingPages(buf) {
  return withPdfJs(buf, (v) =>
    v.evaluate(async () => {
      const map = {};
      for (let i = 1; i <= window.__doc.numPages; i++) {
        const pg = await window.__doc.getPage(i);
        const tc = await pg.getTextContent();
        const text = tc.items.map((x) => x.str).join(" ");
        for (const m of text.matchAll(/@@\s*(h\d\d(?:_\d\d)*)\s*@@/g)) if (!(m[1] in map)) map[m[1]] = i;
      }
      return { map, pages: window.__doc.numPages };
    }),
  );
}

// Pass 1
let buf = await print();
let { map, pages } = await headingPages(buf);
// A marker split across text items can be missed: take the page of the previous heading (same page or the next one).
{
  const manual = JSON.parse(readFileSync(`${OUT}/manual.json`, "utf8"));
  const ids = manual.chapters.flatMap((c) => c.blocks.filter((b) => b.type === "h1" || b.type === "h2").map((b) => b.id));
  let last = 1;
  const missing = [];
  for (const id of ids) {
    if (map[id]) last = map[id];
    else {
      map[id] = last;
      missing.push(id);
    }
  }
  if (missing.length) console.log("headings placed by neighbour:", missing.join(", "));
}
writeFileSync(`${OUT}/pages.json`, JSON.stringify(map, null, 1));
// Pass 2 (TOC numbers) — the TOC length does not change, so the numbers stay valid.
execFileSync("python", [`${ROOT}/build/build.py`, "--html-only", "--pages", `${OUT}/pages.json`], { stdio: "inherit" });
buf = await print();
const check = await headingPages(buf);
const drift = Object.entries(map).filter(([k, p]) => check.map[k] !== p);
writeFileSync(PDF, buf);
console.log(`PDF ${pages} pages, ${Object.keys(map).length} headings located, drift after pass 2: ${drift.length}`);

if (process.env.RENDER) {
  mkdirSync(`${OUT}/pages`, { recursive: true });
  const n = check.pages;
  await withPdfJs(buf, async (v) => {
    for (let i = 1; i <= n; i++) {
      const url = await v.evaluate(async (i) => {
        const pg = await window.__doc.getPage(i);
        const vp = pg.getViewport({ scale: 1.6 });
        const c = document.createElement("canvas");
        c.width = vp.width;
        c.height = vp.height;
        await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
        return c.toDataURL("image/png");
      }, i);
      writeFileSync(`${OUT}/pages/page-${String(i).padStart(3, "0")}.png`, Buffer.from(url.split(",")[1], "base64"));
    }
  });
  console.log(`rendered ${n} page images to ${OUT}/pages`);
}
await browser.close();
