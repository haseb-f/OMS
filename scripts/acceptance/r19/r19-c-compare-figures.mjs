#!/usr/bin/env node
/**
 * R19 §C — value-unchanged proof: compares the card text captured by r19-c-sales-cards-shots.mjs
 * before and after the card redesign (same demo DB, same personas, same tabs, same locale).
 *
 *   node scripts/acceptance/r19/r19-c-compare-figures.mjs \
 *     specs/round19-improvements/evidence/c/before/figures.json \
 *     specs/round19-improvements/evidence/c/after/figures.json
 *
 * Exits 1 when any tab's cards differ (count, order or text).
 */
import { readFileSync } from "node:fs";

const [beforePath, afterPath] = process.argv.slice(2);
const before = JSON.parse(readFileSync(beforePath, "utf8"));
const after = JSON.parse(readFileSync(afterPath, "utf8"));
let differences = 0;
let cards = 0;
for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
  const a = before[key];
  const b = after[key];
  if (!a || !b) {
    differences += 1;
    console.log(`MISSING ${key}: before ${a ? a.length : "-"} / after ${b ? b.length : "-"}`);
    continue;
  }
  const same = a.length === b.length && a.every((text, i) => text === b[i]);
  cards += a.length;
  if (!same) {
    differences += 1;
    console.log(`DIFF ${key}`);
    a.forEach((text, i) => {
      if (text !== b[i]) console.log(`  #${i}\n    before: ${text}\n    after:  ${b[i]}`);
    });
  } else console.log(`same ${key}: ${a.length} card(s)`);
}
console.log(
  `\n${Object.keys(before).length} tab views, ${cards} cards compared, ${differences} difference(s)`,
);
process.exit(differences ? 1 : 0);
