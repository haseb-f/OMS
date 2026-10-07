/* QA helper: tiles the rendered PDF pages (build/out/pages) into contact sheets of 8 pages. */
import { createRequire } from "node:module";
import { readdirSync, mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const sharp = require("D:/Systems/OMS/node_modules/.pnpm/sharp@0.34.5/node_modules/sharp");
const DIR = "D:/Systems/OMS/docs/user-manual/build/out/pages";
const OUT = "D:/Systems/OMS/docs/user-manual/build/out/sheets";
mkdirSync(OUT, { recursive: true });
const pages = readdirSync(DIR).filter((f) => f.startsWith("page-")).sort();
const W = 380, H = 537, COLS = 4, ROWS = 2;
for (let s = 0; s < pages.length; s += COLS * ROWS) {
  const tiles = [];
  for (let k = 0; k < COLS * ROWS && s + k < pages.length; k++) {
    const buf = await sharp(`${DIR}/${pages[s + k]}`).resize(W, H).toBuffer();
    tiles.push({ input: buf, left: (k % COLS) * (W + 10), top: Math.floor(k / COLS) * (H + 10) });
  }
  await sharp({ create: { width: COLS * (W + 10), height: ROWS * (H + 10), channels: 3, background: "#777" } })
    .composite(tiles)
    .png()
    .toFile(`${OUT}/sheet-${String(s / 8 + 1).padStart(2, "0")}.png`);
}
console.log("sheets:", Math.ceil(pages.length / 8));
