/* eslint-disable no-console */
/**
 * Optimises every screenshot in place with sharp (palette PNG, max 1600 px wide) so each file
 * stays around 250 KB or less. Run after shots.mjs.
 *   node docs/user-manual/build/optimize-images.mjs
 */
import { createRequire } from "node:module";
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { ROOT } from "./lib/api.mjs";

const require = createRequire(import.meta.url);
const sharp = require(`${ROOT}/node_modules/.pnpm/sharp@0.34.5/node_modules/sharp`);
const DIRS = [`${ROOT}/docs/user-manual/screenshots/raw`, `${ROOT}/docs/user-manual/screenshots/annotated`];

let total = 0;
for (const dir of DIRS) {
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".png"))) {
    const path = `${dir}/${f}`;
    const input = readFileSync(path);
    const meta = await sharp(input).metadata();
    let pipeline = sharp(input);
    if (meta.width > 1600) pipeline = pipeline.resize({ width: 1600 });
    let out = await pipeline.png({ palette: true, quality: 92, effort: 10, compressionLevel: 9 }).toBuffer();
    if (out.length > 250_000) out = await sharp(input).resize({ width: Math.min(meta.width, 1400) }).png({ palette: true, quality: 80, colours: 128, effort: 10 }).toBuffer();
    if (out.length < input.length) writeFileSync(path, out);
    total += statSync(path).size;
  }
}
console.log(`optimised; total ${(total / 1024 / 1024).toFixed(2)} MB`);
for (const dir of DIRS) {
  const big = readdirSync(dir).filter((n) => statSync(`${dir}/${n}`).size > 250_000);
  if (big.length) console.log(`> 250 KB in ${dir}:`, big.join(", "));
}
