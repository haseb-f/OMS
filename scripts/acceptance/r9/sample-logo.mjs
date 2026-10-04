import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const b = await chromium.launch();
const p = await b.newPage();
const data =
  "data:image/png;base64," +
  readFileSync("apps/web/public/brand/oms-logo-light.png").toString("base64");
const out = await p.evaluate(async (src) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  const W = 340;
  const d = x.getImageData(0, 0, W, c.height).data;
  const groups = { navy: [], blue: [], teal: [] };
  for (let i = 0; i < d.length; i += 4) {
    const [r, g, bl, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
    if (a < 250 || (r > 235 && g > 235 && bl > 235)) continue;
    const mx = Math.max(r, g, bl),
      mn = Math.min(r, g, bl);
    const l = (mx + mn) / 2 / 255;
    const s = mx === mn ? 0 : (mx - mn) / (255 - Math.abs(mx + mn - 255));
    let h = 0;
    if (mx !== mn) {
      const dd = mx - mn;
      h = mx === r ? ((g - bl) / dd) % 6 : mx === g ? (bl - r) / dd + 2 : (r - g) / dd + 4;
      h = (h * 60 + 360) % 360;
    }
    if (l < 0.22) groups.navy.push([r, g, bl]);
    else if (h > 175 && h < 200 && s > 0.35) groups.teal.push([r, g, bl]);
    else if (h > 205 && h < 235 && s > 0.45) groups.blue.push([r, g, bl]);
  }
  const med = (arr) => {
    if (!arr.length) return null;
    const m = [0, 1, 2].map((k) => {
      const v = arr.map((p) => p[k]).sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)];
    });
    return { n: arr.length, hex: "#" + m.map((v) => v.toString(16).padStart(2, "0")).join("") };
  };
  return { navy: med(groups.navy), blue: med(groups.blue), teal: med(groups.teal) };
}, data);
console.log(JSON.stringify(out));
await b.close();
