# MedLens Vision

Point your phone at any medicine. It sees, counts, and explains.

**Live app:** https://medlens-vision.rohnringo3.workers.dev
**Live vision demo (no setup):** https://medlens-vision.rohnringo3.workers.dev/?livedemo=1
**Pipeline self-test (10 assertions, runs in your browser):** https://medlens-vision.rohnringo3.workers.dev/?selftest=1

Entry for the OpenCV AI Competition 2026, powered by AWS. Solo build by a 14-year-old developer in Tanzania.

## What it does

Photograph a medicine box, bottle or blister sheet:

1. **SEE — OpenCV 5, on this device.** Finds the label and perspective-corrects it. Detects blister cells (round pills, capsules, oblongs), counts which pills are intact and which were already pressed out, and marks everything on your photo. Runs in a Web Worker, typically one to four seconds per photo on this device (measured live on the real-photo corpus at 1280 px input) — no internet needed for this step.
2. **REASON — AI + official data.** Gemini reads the rectified label into a plain-language safety card; openFDA grounds the name; a deterministic 30-pair interaction table checks the new medicine against everything you saved — including international name traps (Panadol + Tylenol is the same drug twice).
3. **ACT.** Dose reminders, a refill forecast from the measured pill count, and clear "see a doctor now" guidance.

The philosophy throughout: **AI reads and explains, deterministic code decides.** Every safety-relevant number on screen comes from auditable JavaScript, not a language model.

## The vision pipeline (where OpenCV does real work)

All in `vision-worker.js`, all on-device:

- **Label detection and rectification** — auto-Canny (thresholds from the image median), contour analysis, largest convex quadrilateral, `warpPerspective`. The AI reads a flat, upright label instead of a crooked photo.
- **Rectify-then-count** — when the sheet quad is found, measurement happens in rectified space, so angled shots do not turn circles into missed ellipses.
- **Shape-agnostic cell detection** — morphological top-hat / black-hat (structuring element larger than a pill) isolates pill-scale blobs and cancels sheet borders and lighting gradients; Otsu on the top-hat separates pills from embossed-seam leak; `minAreaRect` gates by aspect ratio (1.0-3.2) so capsules and oblongs pass. HoughCircles runs as an independent cross-check vote.
- **Intact vs pressed-out** — per-cell Laplacian texture variance, split by largest-gap clustering. Cells whose pill was torn out completely are recovered from the blister grid pattern (only positions whose row AND column already exist) and then judged on pixel evidence: a recovered position counts as used only when its inner disc is clearly darker than the surrounding sheet ring (a torn hole); anything else is reported as unknown, never as taken.
- **Honesty by design** — glare-heavy cells (specular highlights over 30 percent of the cell) are counted but never classified; when the texture split finds no real evidence, the app says "could not tell" instead of guessing. In a medicine app, a confident wrong answer is worse than an honest abstention.

## The OpenCV 5 story

The official `docs.opencv.org/5.x/opencv.js` build uses pthreads and hard-hangs browsers that are not cross-origin isolated. This repo therefore ships a **self-compiled single-threaded OpenCV 5 WASM build** (14 MB), built from the `5.x` branch with `build-opencv5.ps1` — the script records every fix needed on Windows: the harfbuzz warnings-as-errors escape hatch, the unquoted `--post-js` link flag, and driving ninja directly because `build_js.py` ends by calling `make`.

Reproduce it:

```
powershell -ExecutionPolicy Bypass -File build-opencv5.ps1
```

## Verification

`/?selftest=1` runs 10 assertions against synthetic sheets with known ground truth (skewed labels, a 45-degree diamond, round-pill and capsule blisters, an all-intact pack that must NOT report empties).

`/?eval=1` scores the pipeline against a hand-labeled corpus of 15 real photos from my family's medicine drawer (`corpus/` in this repo — blister sheets front and back, boxes, a sachet, a bottle, tilts, blur, dark surfaces). Current numbers, failures included: blister detection 4/6, exact cell count on 1 of 3 scoreable sheets (best result: 10 cells, 6 intact, 4 taken — exact), count MAE 3.0, and 0/9 false blisters on boxes and bottles after the grid gate. Foil-back sheets and all-empty packs are the documented open problems. Small numbers, published anyway — the corpus grows weekly and the page re-scores itself in your browser: https://medlens-vision.rohnringo3.workers.dev/?eval=1

## Architecture

- Single-file PWA (`index.html`), zero frameworks. The app shell and the vision pipeline work offline after first load; the AI explanation and openFDA check need internet.
- `vision-worker.js` — OpenCV pipeline in a Web Worker, transferable ImageData in and out, every Mat freed in `finally`.
- Cloudflare Worker (`deploy/worker.js`) serves the app and proxies Gemini with a server-held key, prompt-prefix guard and per-IP rate limit — zero setup for visitors.
- AWS evaluation backbone (S3 corpus + Lambda eval harness) is the next milestone, pending account setup.

## Honest limitations

- Pill counting is an estimate from one photo; the pack is the truth.
- The interaction table covers 30 classic dangerous pairs — a pharmacist checks thousands. The app says exactly that on every all-clear.
- Not medical advice. The app repeats this on every result and abstains when unsure.
- Chosen non-scope: expiry-date OCR on crimped foil, counterfeit claims, tamper detection — features a phone camera cannot do responsibly today.

## Run locally

```
node server.js
```

Then open http://localhost:7990 (the dev server sends the cross-origin-isolation headers a threaded wasm build would need, and the query-string pages work: `/?selftest=1`, `/?livedemo=1`).
