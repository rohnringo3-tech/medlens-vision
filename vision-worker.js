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
      /* tell the page explicitly — otherwise every future scan waits the full
         ready-timeout against a worker that can never become ready */
      postMessage({ type: "init-failed" });
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

/* Median gray level, sampled — drives the auto-Canny thresholds so edge
   detection adapts to dark kitchens and bright daylight alike. */
function grayMedian(gray) {
  const data = gray.data, n = data.length;
  const step = Math.max(1, Math.floor(n / 9973));
  const sample = [];
  for (let i = 0; i < n; i += step) sample.push(data[i]);
  sample.sort((a, b) => a - b);
  return sample[Math.floor(sample.length / 2)];
}

/* Canny thresholds from the GRADIENT distribution, not intensity: a bright
   white table pushed intensity-median thresholds far above the actual edge
   strengths, so the sheet outline vanished (deskew fired 0/8 on real photos). */
function autoCannyThresholds(gray) {
  const gx = new cv.Mat(), gy = new cv.Mat(), ax = new cv.Mat(), ay = new cv.Mat(), mag = new cv.Mat();
  try {
    cv.Sobel(gray, gx, cv.CV_32F, 1, 0, 3);
    cv.Sobel(gray, gy, cv.CV_32F, 0, 1, 3);
    cv.convertScaleAbs(gx, ax); cv.convertScaleAbs(gy, ay);
    cv.addWeighted(ax, 0.5, ay, 0.5, 0, mag);
    const data = mag.data, n = data.length, step = Math.max(1, Math.floor(n / 9973));
    const sample = [];
    for (let i = 0; i < n; i += step) { if (data[i] > 4) sample.push(data[i]); }
    if (sample.length < 50) return { lo: 30, hi: 90 };
    sample.sort((a, b) => a - b);
    const hi = Math.max(30, Math.min(200, sample[Math.floor(sample.length * 0.9)]));
    return { lo: Math.max(10, hi * 0.4), hi };
  } finally { gx.delete(); gy.delete(); ax.delete(); ay.delete(); mag.delete(); }
}

function findLabelQuad(gray) {
  const blur = new cv.Mat(), edges = new cv.Mat(), hier = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  const contours = new cv.MatVector();
  let best = null;
  try {
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    const t = autoCannyThresholds(blur);
    cv.Canny(blur, edges, t.lo, t.hi);
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

/* Fraction of near-blown-out pixels in a cell — glare. A specular highlight
   fakes high texture, so glary cells must abstain, not guess. */
function cellSpecularFrac(gray, cx, cy, r) {
  /* sample the WHOLE cell, not the centre patch: a healthy glossy dome has a
     small centred highlight (normal), real glare blows out half the cell */
  const half = Math.max(4, Math.round(r * 0.95));
  const x = Math.max(0, Math.round(cx - half)), y = Math.max(0, Math.round(cy - half));
  const wDim = Math.min(gray.cols - x, half * 2), hDim = Math.min(gray.rows - y, half * 2);
  if (wDim < 6 || hDim < 6) return 0;
  let hot = 0, total = 0;
  for (let yy = y; yy < y + hDim; yy += 2) {
    const row = yy * gray.cols;
    for (let xx = x; xx < x + wDim; xx += 2) { total++; if (gray.data[row + xx] >= 245) hot++; }
  }
  return total ? hot / total : 0;
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

/* Pixel evidence at a grid position the detector never saw: mean gray of the
   inner disc (0.55r, specular pixels excluded) vs the MEDIAN of the
   1.15r-1.4r ring just outside the cell. Median, not mean, for the ring:
   in a tight grid the ring overlaps neighbouring pills (same reason
   sheetColorRef uses medians), and a mean would drag the "sheet level"
   toward the neighbours. A torn-out cell is a dark hole (disc well below
   ring); a disc at or ABOVE the ring is a pill face the detector missed —
   which must never be reported as a taken dose. */
function cellRingEvidence(gray, cx, cy, r) {
  const W = gray.cols, H = gray.rows, d = gray.data;
  const rIn = Math.max(2, r * 0.55), r0 = r * 1.15, r1 = r * 1.4;
  const x0 = Math.max(0, Math.floor(cx - r1)), x1 = Math.min(W - 1, Math.ceil(cx + r1));
  const y0 = Math.max(0, Math.floor(cy - r1)), y1 = Math.min(H - 1, Math.ceil(cy + r1));
  let dSum = 0, dN = 0;
  const ringVals = [];
  for (let y = y0; y <= y1; y += 2) {
    for (let x = x0; x <= x1; x += 2) {
      const v = d[y * W + x];
      if (v >= 245) continue; // specular highlight — evidence of nothing
      const dist = Math.hypot(x - cx, y - cy);
      if (dist <= rIn) { dSum += v; dN++; }
      else if (dist >= r0 && dist <= r1) ringVals.push(v);
    }
  }
  if (dN < 6 || ringVals.length < 6) return null;
  ringVals.sort((a, b) => a - b);
  return { disc: dSum / dN, ring: ringVals[Math.floor(ringVals.length / 2)] };
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
function detectCellsByContour(gray, inverted, bias, kernelDiv = 3, openSize = 5, gates = {}) {
  const maxAspect = gates.maxAspect || 3.2, minFill = gates.minFill || 0.6;
  const bin = new cv.Mat(), kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(openSize, openSize));
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
    let big = Math.max(31, Math.round(minDim / kernelDiv)); if (big % 2 === 0) big++;
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
        if (major / minor > maxAspect) { rec.x = "aspect"; continue; }
        if (area / (w * h) < minFill) { rec.x = "fill"; continue; }
        rec.x = "ok";
        cells.push({ cx: rr.center.x, cy: rr.center.y, r: (major + minor) / 4,
                     major, minor, angle: rr.angle, area });
      } finally { c.delete(); }
    }
    detectCellsByContour._trace = { n: contours.size(), big, trace };
  } finally { bin.delete(); kernel.delete(); diff.delete(); contours.delete(); hier.delete(); }
  return cells;
}

/* ---- detector v4: foil-back BUMP pass ---- */
/* The printed back of a blister sheet defeats the plain top-hat: ink strokes
   are the same scale as the pill bumps, so text fragments join the family and
   the gate throws the whole pass out. But the bumps are LOW-frequency domes
   while print is HIGH-frequency strokes — a Gaussian blur at ~minDim/16 erases
   the ink and leaves the domes, and the very same top-hat machinery then sees
   a clean sheet. Low bias (8, not 15): blurring costs the bumps contrast. */
function detectCellsByBumps(gray, bias = 8, blurDiv = 20, kernelDiv = 3, openDiv = 18) {
  const blurred = new cv.Mat();
  let cells;
  try {
    const minDim = Math.min(gray.rows, gray.cols);
    let k = Math.max(9, Math.round(minDim / blurDiv)); if (k % 2 === 0) k++;
    cv.GaussianBlur(gray, blurred, new cv.Size(k, k), 0);
    /* blurred domes touch at their skirts and weld neighbouring bumps into
       one blob — an aggressive OPEN (kernel scaled to the blur, not the fixed
       5px) erodes the bridges so each dome keeps its own centre */
    let o = openDiv ? Math.round(minDim / openDiv) : 5; if (o % 2 === 0) o++;
    cells = detectCellsByContour(blurred, false, bias, kernelDiv, Math.max(5, o));
  } finally { blurred.delete(); }
  /* the blur also smears frame-edge gradients into fat blobs — a real cell
     never straddles the border, so border-touching blobs are noise */
  cells = cells.filter(c =>
    c.cx - c.r > 2 && c.cy - c.r > 2 && c.cx + c.r < gray.cols - 2 && c.cy + c.r < gray.rows - 2);
  /* isolated far-off blobs (background shadows) wreck the lattice stats:
     drop cells whose nearest neighbour is far beyond the family's pitch */
  if (cells.length >= 4) {
    const nn = cells.map(c => Math.min(...cells.filter(o => o !== c).map(o => Math.hypot(o.cx - c.cx, o.cy - c.cy))));
    const med = [...nn].sort((a, b) => a - b)[Math.floor(nn.length / 2)];
    cells = cells.filter((c, i) => nn[i] <= med * 1.8);
  }
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

/* Mean color of a cell's inner disc, specular pixels excluded. */
function cellColorStats(srcRgba, cx, cy, r) {
  const half = Math.max(3, Math.round(r * 0.55));
  const x0 = Math.max(0, Math.round(cx - half)), y0 = Math.max(0, Math.round(cy - half));
  const x1 = Math.min(srcRgba.cols, Math.round(cx + half)), y1 = Math.min(srcRgba.rows, Math.round(cy + half));
  let rs = 0, gs = 0, bs = 0, n = 0;
  const d = srcRgba.data, W = srcRgba.cols;
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const i = (y * W + x) * 4;
    const R = d[i], G = d[i + 1], B = d[i + 2];
    if (Math.max(R, G, B) >= 250) continue;
    rs += R; gs += G; bs += B; n++;
  }
  if (n < 8) return null;
  const R = rs / n, G = gs / n, B = bs / n;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
  return { R, G, B, v: mx, sat: mx ? (mx - mn) / mx : 0 };
}

/* Sheet background color, sampled from rings just OUTSIDE each cell.
   Per-channel MEDIAN, not mean: in a tight grid the ring lands on
   neighbouring pills too, and a mean would drag the "sheet color" toward
   the pills — poisoning the very contrast we classify by. */
function sheetColorRef(srcRgba, cells) {
  const Rs = [], Gs = [], Bs = [];
  const d = srcRgba.data, W = srcRgba.cols, H = srcRgba.rows;
  for (const c of cells) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * 2 * Math.PI;
      const x = Math.round(c.cx + Math.cos(ang) * c.r * 1.35);
      const y = Math.round(c.cy + Math.sin(ang) * c.r * 1.35);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = (y * W + x) * 4;
      if (Math.max(d[i], d[i + 1], d[i + 2]) >= 250) continue;
      Rs.push(d[i]); Gs.push(d[i + 1]); Bs.push(d[i + 2]);
    }
  }
  if (Rs.length < 24) return null;
  const med = (arr) => { arr.sort((a, b) => a - b); return arr[Math.floor(arr.length / 2)]; };
  const R = med(Rs), G = med(Gs), B = med(Bs);
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
  return { R, G, B, v: mx, sat: mx ? (mx - mn) / mx : 0 };
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

/* Dominant lattice angle of a cell family: the median nearest-neighbour
   direction folded into [-45°, 45°]. Rotating by this before grid analysis
   lets tilted sheets keep their grid structure. */
function familyAngle(cells) {
  const angs = [];
  for (const c of cells) {
    let best = null, bd = Infinity;
    for (const o of cells) {
      if (o === c) continue;
      const d = Math.hypot(o.cx - c.cx, o.cy - c.cy);
      if (d < bd) { bd = d; best = o; }
    }
    if (best) {
      let a = Math.atan2(best.cy - c.cy, best.cx - c.cx);
      a = ((a % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
      angs.push(a);
    }
  }
  if (!angs.length) return 0;
  angs.sort((x, y) => x - y);
  let a = angs[Math.floor(angs.length / 2)];
  if (a > Math.PI / 4) a -= Math.PI / 2;
  return a;
}

/* THE anti-text gate. Printed letters and logos form uniform-looking blob
   families (they defeated the size gate on 5 of 7 real box photos), but they
   sit on TEXT LINES: their centres never align into a regular 2-D lattice.
   Real blister cells do — rows AND columns, evenly spaced, densely occupied. */
function gridScore(cells, angOverride) {
  const ang = angOverride !== undefined ? angOverride : familyAngle(cells);
  const cos = Math.cos(-ang), sin = Math.sin(-ang);
  const pts = cells.map(c => ({ x: c.cx * cos - c.cy * sin, y: c.cx * sin + c.cy * cos }));
  const tol = cells.reduce((s, c) => s + c.r, 0) / cells.length;
  const cluster = (vals) => {
    const centers = [];
    for (const v of [...vals].sort((a, b) => a - b)) {
      const hit = centers.find(c => Math.abs(c.mean - v) < tol);
      if (hit) { hit.sum += v; hit.n++; hit.mean = hit.sum / hit.n; }
      else centers.push({ mean: v, sum: v, n: 1 });
    }
    return centers.map(c => c.mean).sort((a, b) => a - b);
  };
  const rows = cluster(pts.map(p => p.y));
  const cols = cluster(pts.map(p => p.x));
  const occupancy = cells.length / Math.max(1, rows.length * cols.length);
  const gapCV = (centers) => {
    if (centers.length < 3) return 0;
    const gaps = [];
    for (let i = 1; i < centers.length; i++) gaps.push(centers[i] - centers[i - 1]);
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    if (!mean) return 1;
    const sd = Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length);
    return sd / mean;
  };
  return { rows: rows.length, cols: cols.length, occupancy, spacingCV: Math.max(gapCV(cols), gapCV(rows)) };
}

function gridOK(fam) {
  const g = gridScore(fam);
  return g.rows >= 2 && g.cols >= 2 && g.occupancy >= 0.7 && g.spacingCV <= 0.3;
}

/* Lattice check for the BUMP pass only. Blur has already erased printed text
   (the reason gridOK exists), so occupancy may relax a little — foil-back
   bumps hide in shadow and behind print, and demanding 70% of an 8-cell
   lattice throws away honest 5-cell finds. In exchange the spacing bar is
   RAISED (CV <= 0.2): a sparse family may only claim a grid when its members
   are strictly evenly spaced. familyAngle mis-folds on sparse families whose
   nearest neighbours sit diagonally, so the unrotated frame is tried too. */
function bumpGridOK(fam) {
  if (gridOK(fam)) return true;
  for (const ang of [undefined, 0]) {
    const g = gridScore(fam, ang);
    if (g.rows >= 2 && g.cols >= 2 && g.occupancy >= 0.6 && g.spacingCV <= 0.2) return true;
  }
  return false;
}

/* Lattice completion — the supreme-court rank-1 fix. A half-used sheet or a
   partially-detected one leaves HOLES in the lattice: a missing column shows
   up as a double-width gap between detected columns. Old logic gated on raw
   occupancy and rejected exactly the sheets that most need counting.
   Here each axis is repaired first: a gap of ~k times the base pitch implies
   k-1 hidden grid lines (accepted only when the residual error is under 15%,
   far stricter than the old 30% CV — strict spacing is what keeps printed
   text out now that occupancy is allowed down to 0.45). Implied positions are
   returned as recovered cells for PIXEL-EVIDENCE classification, and all of
   it happens rotation-aware so tilted sheets keep their lattice. */
function latticeComplete(cells, gray) {
  if (cells.length < 4) return { ok: false, implied: [] };
  const ang = familyAngle(cells);
  const cos = Math.cos(-ang), sin = Math.sin(-ang);
  const rot = cells.map(c => ({ x: c.cx * cos - c.cy * sin, y: c.cx * sin + c.cy * cos }));
  const tol = cells.reduce((s, c) => s + c.r, 0) / cells.length;
  const cluster = (vals) => {
    const centers = [];
    for (const v of [...vals].sort((a, b) => a - b)) {
      const hit = centers.find(c => Math.abs(c.mean - v) < tol);
      if (hit) { hit.sum += v; hit.n++; hit.mean = hit.sum / hit.n; }
      else centers.push({ mean: v, sum: v, n: 1 });
    }
    return centers.map(c => c.mean).sort((a, b) => a - b);
  };
  const repair = (centers) => {
    if (centers.length < 2) return { centers, ok: false };
    const gaps = [];
    for (let i = 1; i < centers.length; i++) gaps.push(centers[i] - centers[i - 1]);
    /* base pitch = MEDIAN gap — one noisy tight pair must not poison the
       axis the way a min-gap estimate does */
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const base = sortedGaps[Math.floor(sortedGaps.length / 2)];
    /* a lattice pitch smaller than ~a cell diameter is physically impossible */
    if (base < tol * 1.6) return { centers, ok: false };
    const out = [centers[0]];
    let ok = true;
    for (let i = 1; i < centers.length; i++) {
      const g = centers[i] - centers[i - 1];
      const k = Math.min(2, Math.max(1, Math.round(g / base)));
      if (Math.abs(g / k - base) / base > 0.15) ok = false;
      for (let s = 1; s < k; s++) out.push(centers[i - 1] + (g * s) / k);
      out.push(centers[i]);
    }
    return { centers: out.sort((a, b) => a - b), ok };
  };
  const rowsR = repair(cluster(rot.map(p => p.y)));
  const colsR = repair(cluster(rot.map(p => p.x)));
  const rows = rowsR.centers, cols = colsR.centers;
  const total = rows.length * cols.length;
  const occupancy = cells.length / Math.max(1, total);
  const ok = rowsR.ok && colsR.ok && rows.length >= 2 && cols.length >= 2 && occupancy >= 0.6 && total <= 30;
  if (!ok) return { ok: false, implied: [], rows: rows.length, cols: cols.length, occupancy };
  /* implied = grid positions with no detected cell — rotated back to image space */
  const icos = Math.cos(ang), isin = Math.sin(ang);
  const toImage = (cx, ry) => ({ ox: cx * icos - ry * isin, oy: cx * isin + ry * icos });
  const inBounds = (ox, oy) => ox >= tol && oy >= tol && ox <= gray.cols - tol && oy <= gray.rows - tol;
  const implied = [];
  for (const ry of rows) for (const cx of cols) {
    if (rot.some(p => Math.hypot(p.x - cx, p.y - ry) < tol * 1.2)) continue;
    const { ox, oy } = toImage(cx, ry);
    if (!inBounds(ox, oy)) continue;
    implied.push({ cx: ox, cy: oy, r: tol, major: tol * 2, minor: tol * 2, angle: 0,
                   area: Math.PI * tol * tol, recovered: true });
  }
  /* EDGE extension: a fully-used row/column at the sheet's edge leaves no
     interior gap for pitch repair to see. Probe one pitch beyond each edge,
     but count a position ONLY on positive pixel evidence of a torn hole
     (inner disc clearly darker than its ring) — a plain sheet margin adds
     nothing. This recovers pressed-out edge columns without fabricating. */
  const gapMed = (centers) => {
    if (centers.length < 2) return null;
    const gaps = [];
    for (let i = 1; i < centers.length; i++) gaps.push(centers[i] - centers[i - 1]);
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)];
  };
  const pitchX = gapMed(cols), pitchY = gapMed(rows);
  const edgeCandidates = [];
  if (pitchX) for (const ry of rows) {
    edgeCandidates.push({ cx: cols[0] - pitchX, ry });
    edgeCandidates.push({ cx: cols[cols.length - 1] + pitchX, ry });
  }
  if (pitchY) for (const cx of cols) {
    edgeCandidates.push({ cx, ry: rows[0] - pitchY });
    edgeCandidates.push({ cx, ry: rows[rows.length - 1] + pitchY });
  }
  let edgeAdded = 0;
  for (const cand of edgeCandidates) {
    if (edgeAdded >= 4) break;
    const { ox, oy } = toImage(cand.cx, cand.ry);
    if (!inBounds(ox, oy)) continue;
    if (rot.some(p => Math.hypot(p.x - cand.cx, p.y - cand.ry) < tol * 1.2)) continue;
    const ev = cellRingEvidence(gray, ox, oy, tol);
    if (ev && ev.disc <= ev.ring - 10) { // positive evidence of a torn hole

      implied.push({ cx: ox, cy: oy, r: tol, major: tol * 2, minor: tol * 2, angle: 0,
                     area: Math.PI * tol * tol, recovered: true, edge: true });
      edgeAdded++;
    }
  }
  return { ok: true, implied: implied.length <= cells.length ? implied : [],
           rows: rows.length, cols: cols.length, occupancy };
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

/* Saturation channel as a Mat — colored pills on gray foil are often
   LUMINANCE-TWINS of the sheet (the pink-sheet failure: 7/10 cells), but in
   saturation they blaze while foil, print and shadows stay near zero. */
function saturationChannel(srcRgba) {
  const sat = new cv.Mat(srcRgba.rows, srcRgba.cols, cv.CV_8UC1);
  const d = srcRgba.data, s = sat.data, n = srcRgba.rows * srcRgba.cols;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const R = d[j], G = d[j + 1], B = d[j + 2];
    const mx = Math.max(R, G, B);
    s[i] = mx ? Math.round(255 * (mx - Math.min(R, G, B)) / mx) : 0;
  }
  return sat;
}

function countPills(srcRgba, isRectified) {
  const gray = new cv.Mat();
  let satMat = null;
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
    const bump = detectCellsByBumps(gray);
    /* the saturation pass: catches colored pills that are luminance-twins of
       the foil (grayscale-invisible) — foil/print/shadow stay near zero S.
       RECTIFIED-ONLY: colored pills live on sheets. Measured on the corpus,
       interior sharpness does NOT separate pills from label text (glossy
       pills 166 vs bottle text 86), but sheet context does — a saturated
       grid floating in a room scene is a logo, not medicine. */
    let satCells = [];
    if (isRectified) {
      satMat = saturationChannel(srcRgba);
      satCells = detectCellsByContour(satMat, false, 15);
    }
    for (const c of dark) c.srcDark = true; // a dark-pass cell is a hole/torn-foil candidate
    for (const c of bump) c.src = "bump";   // a blurred-dome cell — foil-back bump candidate
    for (const c of satCells) c.src = "sat"; // a saturation-blob cell — colored pill candidate
    const passes = [
      { k: "bright", cells: bright },
      { k: "dark", cells: dark },
      { k: "hough", cells: hough },
      { k: "bump", cells: bump },
      { k: "sat", cells: satCells },
    ];
    const candidates = passes.map(p => gateUniform(p.cells)).filter(Boolean);
    /* mixed sheets show intact pills to the BRIGHT pass (or the BUMP pass on a
       printed foil back) and torn cells to the DARK pass — winner-take-all
       caps the count at one family. When two families survive the gate with
       agreeing sizes, their deduped union is usually the true cell set. */
    const gb = gateUniform(bright), gd = gateUniform(dark), gm = gateUniform(bump), gs = gateUniform(satCells);
    if (gs) { const sh = gs.map(c => cellSharpness(gray, c.cx, c.cy, c.r)).sort((a, b) => a - b); countPills._gsSharp = sh[Math.floor(sh.length / 2)]; } else countPills._gsSharp = null;
    const medR = (f) => { const rs = f.map(c => c.r).sort((a, b) => a - b); return rs[Math.floor(rs.length / 2)]; };
    const tryUnion = (fa, fb) => {
      if (!fa || !fb) return;
      const ra = medR(fa), rb = medR(fb);
      if (Math.max(ra, rb) / Math.min(ra, rb) >= 1.6) return;
      const union = [...fa];
      for (const c of fb) if (!union.some(o => Math.hypot(o.cx - c.cx, o.cy - c.cy) < (o.r + c.r) * 0.6)) union.push(c);
      const gu = gateUniform(union);
      if (gu && gu.length > Math.max(fa.length, fb.length)) candidates.push(gu);
    };
    tryUnion(gb, gd);
    tryUnion(gm, gd);
    tryUnion(gm, gb);
    tryUnion(gs, gd);   // colored pills + torn holes = the mixed colored sheet
    tryUnion(gs, gb);
    countPills._dbg = { bright: bright.length, dark: dark.length, hough: hough.length, bump: bump.length,
      fams: { gb: gb ? gb.length : 0, gd: gd ? gd.length : 0, gm: gm ? gm.length : 0 },
      cand: candidates.map(f => f.length), bTrace, dTrace,
      art: detectCellsByContour._art || null };
    /* letters-are-not-pills: every candidate family must show real 2-D grid
       structure before it may claim to be a blister pack (bump-pass families
       get the blur-earned variant — see bumpGridOK) */
    const isBumpFam = (f) => f.length > 0 && f.every(c => c.src === "bump");
    /* PRIMARY gate: the proven v3.2 grid gate — the calibrated path that holds
       the sacred results (exact capsule sheet, zero box false-positives) */
    let viable = candidates.filter(f => isBumpFam(f) ? bumpGridOK(f) : gridOK(f));
    let rescuedByLattice = false;
    if (!viable.length) {
      /* RESCUE lane (rank-1 lattice completion): a partially-detected or
         half-used sheet leaves holes that the primary gate punishes. Repair
         the lattice (pitch-multiple gaps) and re-judge on the implied grid.
         Runs ONLY when the primary gate found nothing, so it can extend
         coverage but never disturb a result the proven gate would produce. */
      for (const f of candidates) {
        if (isBumpFam(f)) continue;
        const L = latticeComplete(f, gray);
        if (L.ok) { f._lattice = L; viable.push(f); rescuedByLattice = true; }
      }
    }
    if (!viable.length) {
      /* tight-crop retry: in a rectified sheet crop the pills are LARGE
         relative to the frame, so the standard top-hat element is too small
         and hollows them out — try again with a much larger element */
      const bigBright = gateUniform(detectCellsByContour(gray, false, 15, 1.6));
      const bigDarkRaw = detectCellsByContour(gray, true, 15, 1.6);
      /* same hole/torn-foil prior as the primary dark pass — the tag was
         silently lost on this retry path, inverting the srcDark fallback */
      for (const c of bigDarkRaw) c.srcDark = true;
      const bigDark = gateUniform(bigDarkRaw);
      if (bigBright && gridOK(bigBright)) viable.push(bigBright);
      if (bigDark && gridOK(bigDark)) viable.push(bigDark);
    }
    if (!viable.length) {
      /* ALL-EMPTY-PACK rescue: a finished sheet is nothing but crumpled torn
         cells — irregular blobs that fail the normal fill/aspect gates. Relax
         shape (fill 0.35, aspect 4.0) for the DARK pass only and demand the
         full 2-D grid gate; every cell found this way IS a hole, so the
         verdict is "empty or nearly empty pack". The grid gate is what keeps
         dark text on boxes out — same defense as everywhere else. */
      const torn = detectCellsByContour(gray, true, 8, 3, 5, { maxAspect: 4.0, minFill: 0.35 });
      const tornFam = gateUniform(torn);
      if (tornFam && gridOK(tornFam)) {
        for (const c of tornFam) { c.empty = true; c.srcDark = true; }
        return { total: tornFam.length, full: 0, empty: tornFam.length, unknown: 0,
                 cells: tornFam, estimated: true, emptyPack: true };
      }
      return null;
    }
    viable.sort((a, b) => b.length - a.length);
    let cells = viable[0];
    /* recovery: every accepted family gets lattice recovery (pitch repair +
       evidence-gated edge extension); the legacy recover remains the fallback
       for families whose lattice analysis declines */
    let lat = cells._lattice;
    if (!lat) { const L = latticeComplete(cells, gray); if (L.ok) lat = L; }
    const recovered = lat ? lat.implied : gridRecover(cells, gray);
    cells = cells.concat(recovered);
    if (cells.length > 30) return null;
    /* Classification, three tiers of evidence:
       1. COLOR vs the sheet's own background — a pill is saturated or brighter
          than the sheet; an empty pocket matches the sheet, a torn hole is
          darker. Texture alone lied on glossy colored pills (real-photo eval:
          shiny pink tablets read as "torn foil"), color does not.
       2. TEXTURE for cells color could not resolve — polarity ANCHORED by the
          color-proven cells when any exist (texture polarity inverts between
          glossy pills and smooth foil, so it must be learned, not assumed);
          largest-gap split with the srcDark prior only when no anchors exist.
       3. Glary cells ABSTAIN. Recovered grid cells need PIXEL evidence:
          dark hole = empty, anything else = unknown, never "taken". */
    const detected = cells.filter(c => !c.recovered);
    for (const c of detected) {
      c.spec = cellSpecularFrac(gray, c.cx, c.cy, c.r);
      c.unknown = c.spec > 0.3;
    }
    const ref = sheetColorRef(srcRgba, detected);
    const unresolved = [], anchorsFull = [], anchorsEmpty = [];
    let colorResolved = 0;
    for (const c of detected) {
      if (c.unknown) continue;
      c.sharp = cellSharpness(gray, c.cx, c.cy, c.r);
      const cs = ref ? cellColorStats(srcRgba, c.cx, c.cy, c.r) : null;
      if (cs && ref) {
        const dSat = cs.sat - ref.sat, dV = cs.v - ref.v;
        const colorDist = Math.hypot(cs.R - ref.R, cs.G - ref.G, cs.B - ref.B);
        const pillEv = dSat > 0.12 || dV > 18;
        const emptyEv = dV < -30 || (colorDist < 18 && dSat < 0.08);
        if (pillEv && !emptyEv) { c.empty = false; c.resolved = "color"; colorResolved++; anchorsFull.push(c.sharp); continue; }
        if (emptyEv && !pillEv) { c.empty = true; c.resolved = "color"; colorResolved++; anchorsEmpty.push(c.sharp); continue; }
      }
      unresolved.push(c);
    }
    const thr = largestGapThreshold(unresolved.map(c => c.sharp));
    const meanOf = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
    let anchored = false;
    if (anchorsFull.length && anchorsEmpty.length) {
      /* color proved examples of BOTH classes on this very sheet — but the
         anchors may only teach texture polarity when texture actually
         SEPARATES the classes: non-overlapping sharpness ranges with a real
         gap between them. Overlapping anchors mean texture says nothing here
         (an empty pocket can be as sharp as a pill), so they must not vote. */
      const loF = Math.min(...anchorsFull), hiF = Math.max(...anchorsFull);
      const loE = Math.min(...anchorsEmpty), hiE = Math.max(...anchorsEmpty);
      const gap = loE > hiF ? loE - hiF : loF > hiE ? loF - hiE : 0;
      const span = Math.max(hiF, hiE) - Math.min(loF, loE);
      if (gap > 0 && span > 0 && gap >= span * 0.25) {
        const mF = meanOf(anchorsFull), mE = meanOf(anchorsEmpty);
        for (const c of unresolved) c.empty = Math.abs(c.sharp - mE) < Math.abs(c.sharp - mF);
        anchored = true;
      }
    } else if (thr !== null && (anchorsFull.length || anchorsEmpty.length)) {
      /* one-sided anchors decide which side of the texture gap is "empty" */
      const anchorAbove = meanOf(anchorsFull.length ? anchorsFull : anchorsEmpty) > thr;
      const emptyAbove = anchorsFull.length ? !anchorAbove : anchorAbove;
      for (const c of unresolved) c.empty = emptyAbove ? c.sharp > thr : c.sharp < thr;
      anchored = true;
    }
    if (!anchored) {
      for (const c of unresolved) {
        /* which detector found the cell is itself evidence: a cell only the
           DARK pass saw is a hole/torn-foil candidate — use it as the prior
           when color said nothing and the texture split is inconclusive */
        c.empty = thr !== null ? c.sharp > thr : !!c.srcDark;
      }
    }
    for (const c of cells) {
      if (c.recovered) {
        /* a recovered position may claim "taken" ONLY with pixel evidence:
           (a) ring test — a clearly dark inner disc vs the surrounding ring
           is a torn hole; (b) color test — the same sheet-reference evidence
           trusted for detected cells, except brightness alone may not vote
           "pill" here (the white backing behind torn foil fakes it, only
           saturation is trusted). A disc at/above the ring or a saturated
           disc is likely a pill the detector MISSED; that and every
           ambiguous case abstain as unknown, never "taken". */
        const ev = cellRingEvidence(gray, c.cx, c.cy, c.r);
        const cs = ref ? cellColorStats(srcRgba, c.cx, c.cy, c.r) : null;
        let colorEmpty = false, colorPill = false;
        if (cs && ref) {
          const dSat = cs.sat - ref.sat, dV = cs.v - ref.v;
          const colorDist = Math.hypot(cs.R - ref.R, cs.G - ref.G, cs.B - ref.B);
          colorPill = dSat > 0.12;
          colorEmpty = dV < -30 || (colorDist < 18 && dSat < 0.08);
        }
        if (ev && ev.disc <= ev.ring - 10) { c.empty = true; }
        else if (colorEmpty && !colorPill) { c.empty = true; }
        else { c.unknown = true; c.empty = false; if ((ev && ev.disc >= ev.ring + 14) || colorPill) c.likelyPill = true; }
      } else if (c.unknown) c.empty = false; // counted, never classified
    }
    const unknown = cells.filter(c => c.unknown).length;
    const recoveredEmpty = recovered.some(c => c.empty);
    if (thr === null && !recoveredEmpty && !colorResolved) {
      /* no evidence either way — report the count honestly, say nothing more */
      for (const c of cells) c.empty = false;
      return { total: cells.length, full: null, empty: null, unknown, cells, estimated: true };
    }
    const empty = cells.filter(c => c.empty).length;
    return { total: cells.length, full: cells.length - empty - unknown, empty, unknown, cells, estimated: true };
  } finally { gray.delete(); if (satMat) satMat.delete(); }
}

function pillColorName(srcRgba, cells) {
  /* name the color only from cells that are proven pills — unknown and
     grid-recovered positions carry no pill-face evidence */
  const full = cells.filter(c => !c.empty && !c.unknown && !c.recovered);
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
        const col = (unknown || c.unknown) ? new cv.Scalar(56, 189, 248, 255)
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
       If the tight crop defeats the detector (kernel scale assumptions shift
       when the sheet fills the frame), fall back to the raw image — and keep
       the overlay in the SAME space the cells were found in. */
    let base = label || src;
    /* the saturation pass is licensed by SHEET CONTEXT (a quad was found in
       the frame), not by which space we count in — the tight crop can defeat
       the kernel scale while the raw frame counts fine */
    const sheetContext = !!label;
    out.pills = countPills(base, sheetContext);
    out.gsSharp = countPills._gsSharp;
    out.rectifiedCount = !!label && !!out.pills;
    if (!out.pills && label) {
      base = src;
      out.pills = countPills(src, sheetContext);
    }
    out.dbg = countPills._dbg || null;
    if (out.pills) out.colorName = pillColorName(base, out.pills.cells);
    out.overlayImage = drawOverlay(base, base === src ? quad : null, out.pills);
    if (out.pills) out.pills.cells = out.pills.cells.map(c => ({ cx: c.cx, cy: c.cy, r: c.r, empty: !!c.empty, recovered: !!c.recovered, unknown: !!c.unknown }));
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
