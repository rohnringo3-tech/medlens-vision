const fs = require("fs"), path = require("path");
const { loadImageData } = require("./eval.js");
(async () => {
  const root = path.resolve(__dirname, "..", "..");
  const cv = await require(path.join(root, "opencv.js")); global.cv = cv;
  const buf = fs.readFileSync(path.join(__dirname, "dumps", "photo-05.jpg.1280x720.rgba"));
  const B = { data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length), width: 1280, height: 720 };
  const S = await loadImageData(cv, path.join(root, "corpus", "photo-05.jpg"));
  const hough = (px) => {
    const src = cv.matFromImageData(px), gray = new cv.Mat(), blurred = new cv.Mat(), circles = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY); cv.medianBlur(gray, blurred, 5);
    const minDim = Math.min(gray.rows, gray.cols);
    cv.HoughCircles(blurred, circles, cv.HOUGH_GRADIENT, 1, minDim/10, 100, 30, Math.round(minDim/22), Math.round(minDim/5));
    const out = []; for (let i = 0; i < circles.cols; i++) out.push([Math.round(circles.data32F[i*3]), Math.round(circles.data32F[i*3+1]), Math.round(circles.data32F[i*3+2])]);
    src.delete(); gray.delete(); blurred.delete(); circles.delete(); return out;
  };
  const hb = hough(B), hs = hough(S);
  console.log("BROWSER hough:", JSON.stringify(hb));
  console.log("SHARP   hough:", JSON.stringify(hs));
  const areas = (h) => h.map(c => Math.round(Math.PI*c[2]*c[2])).sort((a,b)=>a-b);
  console.log("areas B:", areas(hb).join(","), " median", areas(hb)[Math.floor(hb.length/2)]);
  console.log("areas S:", areas(hs).join(","), " median", areas(hs)[Math.floor(hs.length/2)]);
})().catch(e => { console.error(e); process.exit(1); });
