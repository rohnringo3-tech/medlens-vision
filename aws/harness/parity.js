const fs = require("fs"), path = require("path");
const { loadImageData } = require("./eval.js");
(async () => {
  const root = path.resolve(__dirname, "..", "..");
  const cv = await require(path.join(root, "opencv.js"));
  global.cv = cv;
  global.ImageData = class { constructor(a,b,c){ if (typeof a==="number"){this.width=a;this.height=b;this.data=new Uint8ClampedArray(a*b*4);} else {this.data=a;this.width=b;this.height=c;} } };
  const { analyze } = require(path.join(root, "vision-worker.js"));
  const buf = fs.readFileSync(path.join(__dirname, "dumps", "photo-05.jpg.1280x720.rgba"));
  const browserPx = { data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length), width: 1280, height: 720 };
  const vB = analyze(browserPx);
  console.log("BROWSER PIXELS -> Node pipeline:", vB.pills ? `${vB.pills.total}/${vB.pills.full}/${vB.pills.empty}` : "no blister", vB.ms + "ms");
  const sharpPx = await loadImageData(cv, path.join(root, "corpus", "photo-05.jpg"));
  const vS = analyze(sharpPx);
  console.log("SHARP PIXELS   -> Node pipeline:", vS.pills ? `${vS.pills.total}/${vS.pills.full}/${vS.pills.empty}` : "no blister", vS.ms + "ms");
  // pixel distance
  let sum = 0, max = 0, n = browserPx.data.length;
  const hist = new Array(8).fill(0);
  for (let i = 0; i < n; i++) { if ((i & 3) === 3) continue; const d = Math.abs(browserPx.data[i] - sharpPx.data[i]); sum += d; if (d > max) max = d; hist[Math.min(7, d)]++; }
  console.log("mean abs diff", (sum / (n * 0.75)).toFixed(3), "max", max, "hist(0..7+)", hist.map(h => (h / (n * 0.75) * 100).toFixed(1) + "%").join(" "));
})().catch(e => { console.error(e); process.exit(1); });
