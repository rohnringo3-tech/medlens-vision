/* MedLens Vision — headless evaluation harness.
   Runs the EXACT browser pipeline (vision-worker.js + the self-compiled
   OpenCV 5 WASM) under Node, scores it against corpus/manifest.json, and
   emits the same summary the in-browser /?eval=1 page prints.
   Used locally and inside the AWS Lambda (arm64 and x86) eval backbone. */
"use strict";
const fs = require("fs");
const path = require("path");

const MAX_SIDE = 1280; // production vision input cap (index.html imageToImageData)

/* Decode with libvips (libjpeg-turbo, fancy chroma upsampling, EXIF auto-
   rotation) — the same decoder family browsers use, so the pixels entering
   the pipeline match what the in-browser /?eval=1 page feeds it. jpeg-js was
   tried first: its nearest-neighbour chroma upsampling shifted pill colours
   enough to flip borderline photos. */
async function loadImageData(cv, file) {
  const sharp = require("sharp");
  const img = sharp(file, { failOn: "none" }).rotate(); // .rotate() = apply EXIF orientation
  const meta = await img.metadata();
  let w = meta.width, h = meta.height;
  if (meta.orientation >= 5) { const t = w; w = h; h = t; } // swapped by the rotation
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const tw = Math.round(w * scale), th = Math.round(h * scale);
  const { data, info } = await img
    .resize(tw, th, { fit: "fill", kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}

async function main(opts) {
  const root = opts.root || path.resolve(__dirname, "..", "..");
  const corpusDir = opts.corpusDir || path.join(root, "corpus");
  const t0 = Date.now();
  const cv = await require(path.join(root, "opencv.js"));
  global.cv = cv;                                   // the worker talks to the bare global
  /* the worker returns overlay/label crops as browser ImageData — a shape-
     compatible stand-in is all Node needs (the harness never displays them) */
  if (typeof global.ImageData === "undefined") {
    global.ImageData = class ImageData {
      constructor(a, b, c) {
        if (typeof a === "number") { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); }
        else { this.data = a; this.width = b; this.height = c !== undefined ? c : (a.length / 4 / b); }
      }
    };
  }
  const { analyze } = require(path.join(root, "vision-worker.js"));
  const manifest = JSON.parse(fs.readFileSync(path.join(corpusDir, "manifest.json"), "utf8"));
  const rows = [];
  for (const item of manifest.items) {
    const file = path.join(corpusDir, item.file);
    let row = { file: item.file, kind: item.kind,
      truth: { cells: item.cells ?? null, intact: item.intact ?? null, empty: item.empty ?? null } };
    try {
      const img = await loadImageData(cv, file);
      const v = analyze(img);
      const p = v.pills;
      row.got = p ? { total: p.total, full: p.full, empty: p.empty, unknown: p.unknown || 0 } : null;
      row.deskewed = v.deskewed; row.ms = v.ms;
      row.detectOK = item.kind === "blister" ? !!p : !p;
      row.countErr = (p && item.cells != null) ? Math.abs(p.total - item.cells) : null;
      row.intactOK = (p && p.full !== null && item.intact != null) ? (p.full === item.intact) : null;
    } catch (e) {
      row.crashed = true; row.error = String(e && e.message || e); row.detectOK = false;
    }
    rows.push(row);
    if (opts.verbose) console.error(`${row.file} -> ${row.got ? `${row.got.total}/${row.got.full}/${row.got.empty}` : "no blister"} ${row.ms || ""}ms${row.crashed ? " CRASH " + row.error : ""}`);
  }
  const blisters = rows.filter(r => r.kind === "blister" && !r.crashed);
  const detected = blisters.filter(r => r.detectOK);
  const exact = blisters.filter(r => r.countErr === 0);
  const mae = blisters.filter(r => r.countErr != null);
  const summary = {
    photos: rows.length,
    blisterDetectRate: blisters.length ? `${detected.length}/${blisters.length}` : "n/a",
    exactCount: mae.length ? `${exact.length}/${mae.length}` : "n/a",
    countMAE: mae.length ? (mae.reduce((s, r) => s + r.countErr, 0) / mae.length).toFixed(2) : "n/a",
    intactExact: blisters.filter(r => r.intactOK === true).length + "/" + blisters.filter(r => r.intactOK !== null).length,
    falseBlisterOnBoxes: rows.filter(r => r.kind !== "blister" && !r.crashed && !r.detectOK).length
      + "/" + rows.filter(r => r.kind !== "blister" && !r.crashed).length,
    crashes: rows.filter(r => r.crashed).length,
    totalMs: Date.now() - t0,
    node: process.version, arch: process.arch, platform: process.platform,
  };
  return { summary, rows };
}

module.exports = { main, loadImageData };

if (require.main === module) {
  main({ verbose: true }).then(({ summary, rows }) => {
    console.log(JSON.stringify(summary));
    const outDir = path.join(__dirname, "results");
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(path.join(outDir, `eval-${stamp}.json`), JSON.stringify({ summary, rows }, null, 2));
  }).catch(e => { console.error("harness failed:", e); process.exit(1); });
}
