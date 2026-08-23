const fs = require("fs"), path = require("path");
const { loadImageData } = require("./eval.js");
(async () => {
  const root = path.resolve(__dirname, "..", "..");
  const cv = await require(path.join(root, "opencv.js")); global.cv = cv;
  global.ImageData = class { constructor(a,b,c){ if (typeof a==="number"){this.width=a;this.height=b;this.data=new Uint8ClampedArray(a*b*4);} else {this.data=a;this.width=b;this.height=c;} } };
  const { analyze } = require(path.join(root, "vision-worker.js"));
  const buf = fs.readFileSync(path.join(__dirname, "dumps", "photo-05.jpg.1280x720.rgba"));
  const B = { data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length), width: 1280, height: 720 };
  const S = await loadImageData(cv, path.join(root, "corpus", "photo-05.jpg"));
  const strip = (d) => { if (!d) return null; const { art, bTrace, dTrace, ...rest } = d; return rest; };
  const vB = analyze(B), vS = analyze(S);
  console.log("BROWSER dbg:", JSON.stringify(strip(vB.dbg)), "deskewed", vB.deskewed, "rectifiedCount", vB.rectifiedCount);
  console.log("SHARP   dbg:", JSON.stringify(strip(vS.dbg)), "deskewed", vS.deskewed, "rectifiedCount", vS.rectifiedCount);
  console.log("BROWSER rescue:", JSON.stringify(vB.rescueDbg && vB.rescueDbg.slice(0,3)));
  console.log("SHARP   rescue:", JSON.stringify(vS.rescueDbg && vS.rescueDbg.slice(0,3)));
})().catch(e => { console.error(e); process.exit(1); });
