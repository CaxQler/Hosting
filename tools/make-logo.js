"use strict";
/**
 * Vaxtor — build the transparent logo from the raw JPEG.
 *   node tools/make-logo.js
 * Reads  public/img/vaxtor-logo-src.png (actually a JPEG with a baked
 * checkerboard/white background) and writes public/img/vaxtor-logo.png
 * with the background flood-filled to transparency + resized for web.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const jpeg = require("jpeg-js");

const SRC = path.join(__dirname, "..", "public", "img", "vaxtor-logo-src.png");
const OUT = path.join(__dirname, "..", "public", "img", "vaxtor-logo.png");
const TARGET_W = 220;

const { width: W, height: H, data } = jpeg.decode(fs.readFileSync(SRC), { useTArray: true, maxMemoryUsageInMB: 512 });

const sat = (i) => Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
const lum = (i) => (data[i] + data[i + 1] + data[i + 2]) / 3;
const isBg = (i) => {
  const s = sat(i);
  if (s > 26) return false;
  const l = lum(i);
  return l <= 135 || l >= 210; // dark checker grays or the white band
};

/* ---- flood fill background: from borders (catches the white band) AND
        from every dark checker pixel anywhere (catches the enclosed
        counters inside the bolt that borders can't reach) ---- */
const N = W * H;
const gone = new Uint8Array(N);
const stack = [];
const push = (x, y) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const p = y * W + x;
  if (gone[p]) return;
  if (!isBg(p * 4)) return;
  gone[p] = 1;
  stack.push(p);
};
function drain() {
  while (stack.length) {
    const p = stack.pop();
    const x = p % W, y = (p / W) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
}
for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
drain();
// interior checker regions (dark grays only — never the white core)
for (let p = 0; p < N; p++) {
  if (gone[p]) continue;
  const i = p * 4;
  if (sat(i) <= 26 && lum(i) <= 135 && isBg(i)) { gone[p] = 1; stack.push(p); drain(); }
}

/* ---- feather: fade pixels hugging the removed region ---- */
const alpha = new Uint8Array(N).fill(255);
for (let p = 0; p < N; p++) if (gone[p]) alpha[p] = 0;
for (let pass = 0; pass < 2; pass++) {
  const prev = alpha.slice();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (prev[p] === 0) continue;
      let adjGone = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (prev[ny * W + nx] === 0) { adjGone = true; break; }
      }
      if (adjGone) alpha[p] = Math.min(prev[p], pass === 0 ? 150 : 90);
    }
  }
}
let removed = 0;
for (let p = 0; p < N; p++) if (alpha[p] === 0) removed++;

/* ---- box resize (premultiplied) to TARGET_W ---- */
const scale = W / TARGET_W;
const TH = Math.max(1, Math.round(H / scale));
const RW = TARGET_W;
const out = Buffer.alloc(RW * TH * 4);
for (let oy = 0; oy < TH; oy++) {
  for (let ox = 0; ox < RW; ox++) {
    const x0 = Math.floor(ox * scale), x1 = Math.min(W, Math.ceil((ox + 1) * scale));
    const y0 = Math.floor(oy * scale), y1 = Math.min(H, Math.ceil((oy + 1) * scale));
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4, p = y * W + x;
        const av = alpha[p];
        if (av === 0) { n++; continue; }
        r += data[i] * av; g += data[i + 1] * av; b += data[i + 2] * av; a += av; n++;
      }
    }
    const o = (oy * RW + ox) * 4;
    if (a === 0) { out[o + 3] = 0; continue; }
    out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a);
    out[o + 3] = Math.round(a / (x1 - x0) * (y1 - y0) === 0 ? 255 : a / ((x1 - x0) * (y1 - y0)));
    if (out[o + 3] > 255) out[o + 3] = 255;
  }
}

/* ---- encode PNG (RGBA8, filter 0) ---- */
function crc32(buf) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf) >>> 0;
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c; }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}
const chunk = (type, body) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(type), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(RW, 0); ihdr.writeUInt32BE(TH, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const raw = Buffer.alloc(TH * (1 + RW * 4));
for (let y = 0; y < TH; y++) {
  raw[y * (1 + RW * 4)] = 0;
  out.copy(raw, y * (1 + RW * 4) + 1, y * RW * 4, (y + 1) * RW * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.writeFileSync(OUT, png);
console.log(`source ${W}x${H} -> ${RW}x${TH} | background removed: ${(100 * removed / N).toFixed(1)}% | ${png.length} bytes -> ${path.relative(process.cwd(), OUT)}`);
