/* MedLens Vision — the OpenCV pipeline, in a Web Worker.
   opencv.js compiles off the main thread, so the app never janks or hangs
   even on a $30 Android. The page sends ImageData in; measurements and
   marked-up ImageData come back. No DOM APIs in here. */

importScripts("opencv.js");

let ready = false, failed = false;
const pending = []; // {id, imageData} records — NOT closures, so buffers stay collectable

(function waitForCv() {
  /* emscripten's fake thenable must never be awaited — poll for the module,
     and give init a deadline: a failed WASM load must answer every queued
     scan with an error instead of holding its ImageData forever.
     Builds differ in WHERE the API lands: docs builds populate `cv`,
     raw build_js output populates the emscripten `Module` global — accept both. */
  if (typeof cv === "function" && !cv.Mat) { try { cv = cv(); } catch {} }
  const t0 = Date.now();
  const iv = setInterval(() => {
    let m = null;
    if (typeof cv === "object" && cv && cv.Mat) m = cv;
    else if (typeof Module === "object" && Module && Module.Mat) m = Module;
    if (m) {
      clearInterval(iv);
      try { cv = m; } catch {}       // normalize: the pipeline below talks to `cv`
      try { self.cv = m; } catch {}
      ready = true;
      postMessage({ type: "ready" });
      pending.splice(0).forEach(p => run(p.id, p.imageData));
    } else if (Date.now() - t0 > 30000) {
      clearInterval(iv);
      failed = true;
      for (const p of pending.splice(0)) postMessage({ type: "result", id: p.id, error: "opencv failed to initialize" });
    }
  }, 100);
})();

/* ---------- pipeline (identical maths to the design in index.html) ---------- */

/* Order corners by angle around the centroid — the sum/diff trick assigns the
   same point twice on diamond-oriented (~45°) quads, which would feed a
   singular transform to warpPerspective and smear the crop. */
function orderCorners(pts) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4, cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  /* rotate the cycle so it starts at the top-left-most corner */
  let start = 0;
  for (let i = 1; i < 4; i++) if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i;
  return [0, 1, 2, 3].map(i => sorted[(start + i) % 4]);
}

function findLabelQuad(gray) {
  const blur = new cv.Mat(), edges = new cv.Mat(), hier = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  const contours = new cv.MatVector();
  let best = null;
  try {
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    cv.Canny(blur, edges, 50, 150);
    cv.dilate(edges, edges, kernel);
    cv.findContours(edges, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let bestArea = gray.rows * gray.cols * 0.18;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const approx = new cv.Mat();
      try {
        cv.approxPolyDP(c, approx, 0.02 * cv.arcLength(c, true), true);
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          const area = Math.abs(cv.contourArea(approx));
          if (area > bestArea) {
            bestArea = area;
            const pts = [];
            for (let r = 0; r < 4; r++) pts.push({ x: approx.data32S[r * 2], y: approx.data32S[r * 2 + 1] });
            best = orderCorners(pts);
          }
        }
      } finally { approx.delete(); c.delete(); }
    }
  } finally { blur.delete(); edges.delete(); hier.delete(); kernel.delete(); contours.delete(); }
  return best;
}

function warpQuad(src, quad) {
  const [tl, tr, br, bl] = quad;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  /* degenerate quads (duplicate or near-duplicate corners) would make the
     transform singular — fall back to the raw photo instead */
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    if (dist(quad[i], quad[j]) < 8) return null;
  }
  const w = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
  const h = Math.round(Math.max(dist(tl, bl), dist(tr, br)));
  if (w < 60 || h < 60) return null;
  let srcTri = null, dstTri = null, M = null, out = null;
  try {
    srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
    dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
    M = cv.getPerspectiveTransform(srcTri, dstTri);
    out = new cv.Mat();
    cv.warpPerspective(src, out, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
    const ret = out; out = null;
    return ret;
  } finally {
    for (const m of [srcTri, dstTri, M, out]) if (m) m.delete();
  }
}

function cellSharpness(gray, cx, cy, r) {
  const half = Math.max(4, Math.round(r * 0.55));
  const x = Math.max(0, Math.round(cx - half)), y = Math.max(0, Math.round(cy - half));
  const wDim = Math.min(gray.cols - x, half * 2), hDim = Math.min(gray.rows - y, half * 2);
  if (wDim < 6 || hDim < 6) return 0;
  const roi = gray.roi(new cv.Rect(x, y, wDim, hDim));
  const lap = new cv.Mat(), mean = new cv.Mat(), std = new cv.Mat();
  try {
    cv.Laplacian(roi, lap, cv.CV_64F);
    cv.meanStdDev(lap, mean, std);
    return Math.pow(std.doubleAt(0, 0), 2);
  } finally { roi.delete(); lap.delete(); mean.delete(); std.delete(); }
}

function largestGapThreshold(values) {
  if (values.length < 4) return null;
  const sorted = [...values].sort((a, b) => a - b);
  let gapAt = -1, gapSize = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1] - sorted[i];
    if (gap > gapSize) { gapSize = gap; gapAt = i; }
  }
  const span = sorted[sorted.length - 1] - sorted[0];
  if (span <= 0 || gapSize < span * 0.35) return null;
  if (sorted[sorted.length - 1] < sorted[0] * 3 + 1e-6) return null;
  return (sorted[gapAt] + sorted[gapAt + 1]) / 2;
}

/* ---- detector v2: shape-agnostic contour pass (round, capsule, oblong) ---- */
function detectCellsByContour(gray, inverted, bias) {
  const bin = new cv.Mat(), kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
  const diff = new cv.Mat();
  const contours = new cv.MatVector(), hier = new cv.Mat();
  const cells = [];
  try {
    const minDim = Math.min(gray.rows, gray.cols);
    /* Morphological top-hat (bright pass) / black-hat (dark pass): isolates
       blobs SMALLER than the structuring element and cancels everything at
       larger scales — so pills pop out while the blister sheet itself, its
       borders and lighting gradients vanish. This is the multi-scale trick
       a plain local-mean threshold cannot do (the sheet border always leaks). */
    let big = Math.max(31, Math.round(minDim / 3)); if (big % 2 === 0) big++;
    const bigK = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(big, big));
    try {
      cv.morphologyEx(gray, diff, inverted ? cv.MORPH_BLACKHAT : cv.MORPH_TOPHAT, bigK);
    } finally { bigK.delete(); }
    /* Otsu on the top-hat auto-separates pill-peaks from background leak
       (embossed seams / cell rings drag erosion down and leak the whole
       sheet past any fixed bias); floor it at `bias` for near-flat images */
    const otsuT = cv.threshold(diff, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    if (otsuT < bias) cv.threshold(diff, bin, bias, 255, cv.THRESH_BINARY);
    cv.morphologyEx(bin, bin, cv.MORPH_OPEN, kernel);
    if (self.__dumpBins && !inverted) {
      const sx = Math.ceil(bin.cols / 90), sy = Math.ceil(bin.rows / 40);
      let art = "";
      for (let y = 0; y < bin.rows; y += sy) {
        for (let x = 0; x < bin.cols; x += sx) art += bin.ucharPtr(y, x)[0] > 128 ? "#" : ".";
        art += "\n";
      }
      let gart = "";
      for (let y = 0; y < gray.rows; y += sy) {
        for (let x = 0; x < gray.cols; x += sx) { const v = gray.ucharPtr(y, x)[0]; gart += v > 210 ? "@" : v > 180 ? "#" : v > 140 ? "+" : v > 80 ? "." : " "; }
        gart += "\n";
      }
      detectCellsByContour._art = { bin: art, gray: gart };
    }
    cv.findContours(bin, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const frameArea = gray.rows * gray.cols;
    const trace = [];
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      try {
        const area = cv.contourArea(c);
        const rr = cv.minAreaRect(c);
        const w = rr.size.width, h = rr.size.height;
        const rec = { a: Math.round(area), w: Math.round(w), h: Math.round(h) };
        if (trace.length < 14) trace.push(rec);
        if (area < frameArea * 0.002 || area > frameArea * 0.15) { rec.x = "area"; continue; }
        if (!w || !h) { rec.x = "dim"; continue; }
        const major = Math.max(w, h), minor = Math.min(w, h);
        if (major / minor > 3.2) { rec.x = "aspect"; continue; }
        if (area / (w * h) < 0.6) { rec.x = "fill"; continue; }
        rec.x = "ok";
        cells.push({ cx: rr.center.x, cy: rr.center.y, r: (major + minor) / 4,
                     major, minor, angle: rr.angle, area });
      } finally { c.delete(); }
    }
    detectCellsByContour._trace = { n: contours.size(), big, trace };
  } finally { bin.delete(); kernel.delete(); diff.delete(); contours.delete(); hier.delete(); }
  return cells;
}

function detectCellsByHough(gray) {
  const blurred = new cv.Mat(), circles = new cv.Mat();
  const cells = [];
  try {
    cv.medianBlur(gray, blurred, 5);
    const minDim = Math.min(gray.rows, gray.cols);
    cv.HoughCircles(blurred, circles, cv.HOUGH_GRADIENT, 1,
      minDim / 10, 100, 30,
      Math.round(minDim / 22), Math.round(minDim / 5));
    for (let i = 0; i < circles.cols; i++) {
      const cx = circles.data32F[i * 3], cy = circles.data32F[i * 3 + 1], r = circles.data32F[i * 3 + 2];
      cells.push({ cx, cy, r, major: r * 2, minor: r * 2, angle: 0, area: Math.PI * r * r });
    }
  } finally { blurred.delete(); circles.delete(); }
  return cells;
}

/* Keep only a plausible, mutually-uniform family of cells; null = no pack. */
function gateUniform(cells) {
  if (cells.length < 4 || cells.length > 30) return null;
  const areas = cells.map(c => c.area).sort((a, b) => a - b);
  const medA = areas[Math.floor(areas.length / 2)];
  const kept = cells.filter(c => c.area > medA * 0.45 && c.area < medA * 2.2);
  if (kept.length < 4 || kept.length > 30) return null;
  /* dedupe near-duplicate detections (same cell found twice) */
  const out = [];
  for (const c of kept) {
    if (!out.some(o => Math.hypot(o.cx - c.cx, o.cy - c.cy) < (o.r + c.r) * 0.6)) out.push(c);
  }
  return out.length >= 4 ? out : null;
}

/* Blister invariant: cells sit on a grid. Recover cells whose pill was fully
   torn out (no contour) — CONSERVATIVELY: only positions whose row AND column
   both already exist, and every recovered cell is marked, never "intact". */
function gridRecover(cells, gray) {
  if (cells.length < 4) return [];
  const tol = cells.reduce((s, c) => s + c.r, 0) / cells.length;
  const cluster = (vals) => {
    const centers = [];
    for (const v of vals.sort((a, b) => a - b)) {
      const hit = centers.find(c => Math.abs(c.mean - v) < tol);
      if (hit) { hit.sum += v; hit.n++; hit.mean = hit.sum / hit.n; }
      else centers.push({ mean: v, sum: v, n: 1 });
    }
    return centers.map(c => c.mean);
  };
  const rows = cluster(cells.map(c => c.cy));
  const cols = cluster(cells.map(c => c.cx));
  if (rows.length < 2 || cols.length < 2 || rows.length * cols.length > 30) return [];
  const recovered = [];
  for (const ry of rows) for (const cx of cols) {
    if (cells.some(c => Math.hypot(c.cx - cx, c.cy - ry) < tol * 1.2)) continue;
    if (cx < tol || ry < tol || cx > gray.cols - tol || ry > gray.rows - tol) continue;
    recovered.push({ cx, cy: ry, r: tol, major: tol * 2, minor: tol * 2, angle: 0,
                     area: Math.PI * tol * tol, recovered: true });
  }
  /* if we "recovered" more than we detected, the grid assumption is wrong */
  return recovered.length <= cells.length ? recovered : [];
}

function countPills(srcRgba) {
  const gray = new cv.Mat();
  try {
    cv.cvtColor(srcRgba, gray, cv.COLOR_RGBA2GRAY);
    /* three candidate detections: contour bright, contour dark, Hough circles.
       Pick the most populous plausible family — the cross-check vote. */
    /* three independent detections: clearly-brighter blobs, clearly-darker
       blobs, and Hough circles. The plausibility gate + populous-vote picks
       the survivor — bright for pills on foil, dark for pressed-out holes. */
    const bright = detectCellsByContour(gray, false, 15);
    const bTrace = detectCellsByContour._trace;
    const dark = detectCellsByContour(gray, true, 15);
    const dTrace = detectCellsByContour._trace;
    const hough = detectCellsByHough(gray);
    const passes = [
      { k: "bright", cells: bright },
      { k: "dark", cells: dark },
      { k: "hough", cells: hough },
    ];
    const candidates = passes.map(p => gateUniform(p.cells)).filter(Boolean);
    countPills._dbg = { bright: bright.length, dark: dark.length, hough: hough.length, bTrace, dTrace,
      art: detectCellsByContour._art || null };
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.length - a.length);
    let cells = candidates[0];
    /* recover fully torn-out cells from the grid pattern */
    const recovered = gridRecover(cells, gray);
    cells = cells.concat(recovered);
    if (cells.length > 30) return null;
    /* texture split on DETECTED cells only; recovered ones are empty by definition */
    const detected = cells.filter(c => !c.recovered);
    for (const c of detected) c.sharp = cellSharpness(gray, c.cx, c.cy, c.r);
    const thr = largestGapThreshold(detected.map(c => c.sharp));
    for (const c of cells) c.empty = c.recovered ? true : (thr !== null && c.sharp > thr);
    if (thr === null && !recovered.length) {
      /* no evidence either way — report the count honestly, say nothing more */
      for (const c of cells) c.empty = false;
      return { total: cells.length, full: null, empty: null, cells, estimated: true };
    }
    const empty = cells.filter(c => c.empty).length;
    return { total: cells.length, full: cells.length - empty, empty, cells, estimated: true };
  } finally { gray.delete(); }
}

function pillColorName(srcRgba, cells) {
  const full = cells.filter(c => !c.empty);
  if (!full.length) return null;
  let rSum = 0, gSum = 0, bSum = 0, n = 0;
  for (const c of full.slice(0, 6)) {
    const half = Math.max(3, Math.round(c.r * 0.4));
    const x = Math.max(0, Math.round(c.cx - half)), y = Math.max(0, Math.round(c.cy - half));
    const w = Math.min(srcRgba.cols - x, half * 2), h = Math.min(srcRgba.rows - y, half * 2);
    if (w < 4 || h < 4) continue;
    const roi = srcRgba.roi(new cv.Rect(x, y, w, h));
    try {
      const m = cv.mean(roi);
      rSum += m[0]; gSum += m[1]; bSum += m[2]; n++;
    } finally { roi.delete(); }
  }
  if (!n) return null;
  const r = rSum / n, g = gSum / n, b = bSum / n;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx > 190 && mx - mn < 32) return "white or off-white";
  if (mx < 90) return "dark";
  if (r >= g && r >= b) return g > b + 20 ? (r > 200 ? "orange or yellow" : "brown") : "red or pink";
  if (g >= r && g >= b) return "green";
  return "blue";
}

/* RGBA Mat -> plain ImageData (transferable back to the page) */
function matToImageData(mat) {
  let rgba = mat;
  let made = false;
  try {
    if (mat.type() !== cv.CV_8UC4) {
      rgba = new cv.Mat();
      made = true;
      cv.cvtColor(mat, rgba, mat.channels() === 1 ? cv.COLOR_GRAY2RGBA : cv.COLOR_RGB2RGBA);
    }
    return new ImageData(new Uint8ClampedArray(rgba.data), rgba.cols, rgba.rows);
  } finally { if (made) rgba.delete(); }
}

function drawOverlay(srcRgba, quad, pills) {
  const vis = srcRgba.clone();
  try {
    if (quad) {
      const blue = new cv.Scalar(30, 94, 255, 255);
      for (let i = 0; i < 4; i++) {
        const a = quad[i], b = quad[(i + 1) % 4];
        cv.line(vis, new cv.Point(a.x, a.y), new cv.Point(b.x, b.y), blue, 4);
      }
    }
    if (pills) {
      const unknown = pills.full === null; // texture split found no evidence — draw neutral
      for (const c of pills.cells) {
        const col = unknown ? new cv.Scalar(56, 189, 248, 255)
          : c.empty ? new cv.Scalar(225, 60, 60, 255) : new cv.Scalar(22, 163, 74, 255);
        /* capsules/oblongs get their true ellipse; round pills a circle */
        if (c.major && c.minor && c.major / c.minor > 1.3) {
          cv.ellipse(vis, new cv.Point(c.cx, c.cy), new cv.Size(c.major / 2, c.minor / 2),
            c.angle || 0, 0, 360, col, 3);
        } else {
          cv.circle(vis, new cv.Point(c.cx, c.cy), Math.round(c.r), col, 3);
        }
        /* pressed-out cells also get an X so the verdict survives color-blindness */
        if (!unknown && c.empty) {
          const d = c.r * 0.55;
          cv.line(vis, new cv.Point(c.cx - d, c.cy - d), new cv.Point(c.cx + d, c.cy + d), col, 3);
          cv.line(vis, new cv.Point(c.cx - d, c.cy + d), new cv.Point(c.cx + d, c.cy - d), col, 3);
        }
      }
    }
    return matToImageData(vis);
  } finally { vis.delete(); }
}

function analyze(imageData) {
  const t0 = Date.now();
  const src = cv.matFromImageData(imageData);
  const gray = new cv.Mat();
  let label = null;
  const out = { deskewed: false, pills: null, colorName: null, labelImage: null, overlayImage: null, ms: 0 };
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const quad = findLabelQuad(gray);
    if (quad) {
      label = warpQuad(src, quad);
      if (label) {
        out.deskewed = true;
        out.labelImage = matToImageData(label);
      }
    }
    /* rectify-THEN-count: when the sheet/label quad was found, measure in the
       flattened space — angled circles stop being ellipses, spacing is true.
       The overlay then shows the rectified view (no quad outline needed). */
    const base = label || src;
    out.pills = countPills(base);
    out.dbg = countPills._dbg || null;
    out.rectifiedCount = !!label && !!out.pills;
    if (out.pills) out.colorName = pillColorName(base, out.pills.cells);
    out.overlayImage = drawOverlay(base, label ? null : quad, out.pills);
    if (out.pills) out.pills.cells = out.pills.cells.map(c => ({ cx: c.cx, cy: c.cy, r: c.r, empty: !!c.empty, recovered: !!c.recovered }));
  } finally {
    gray.delete(); src.delete(); if (label) label.delete();
  }
  out.ms = Date.now() - t0;
  return out;
}

function run(id, imageData) {
  try {
    const result = analyze(imageData);
    const transfers = [];
    if (result.labelImage) transfers.push(result.labelImage.data.buffer);
    if (result.overlayImage) transfers.push(result.overlayImage.data.buffer);
    postMessage({ type: "result", id, result }, transfers);
  } catch (err) {
    postMessage({ type: "result", id, error: String(err && err.message || err) });
  }
}

onmessage = (e) => {
  if (e.data && e.data.type === "debug-art") { self.__dumpBins = true; return; }
  const { id, imageData } = e.data;
  if (ready) run(id, imageData);
  else if (failed) postMessage({ type: "result", id, error: "opencv failed to initialize" });
  else pending.push({ id, imageData });
};
