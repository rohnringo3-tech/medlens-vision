const t0 = Date.now();
const mod = require("../../opencv.js");
console.log("typeof", typeof mod, "then?", typeof mod.then, "Mat?", !!mod.Mat);
const timer = setTimeout(() => { console.log("TIMEOUT: no init after 60s; Mat?", !!mod.Mat); process.exit(2); }, 60000);
Promise.resolve(mod).then ? null : null;
if (typeof mod.then === "function") {
  mod.then((cv) => {
    clearTimeout(timer);
    console.log("resolved in", Date.now() - t0, "ms; Mat?", !!cv.Mat, "version", cv.getBuildInformation ? cv.getBuildInformation().split("\n")[0] : "?");
    const m = new cv.Mat(4, 4, cv.CV_8UC1); console.log("mat ok", m.rows, m.cols); m.delete();
    process.exit(0);
  }).catch(e => { console.log("then rejected:", e && e.message); process.exit(3); });
} else {
  mod.onRuntimeInitialized = () => { clearTimeout(timer); console.log("onRuntimeInitialized in", Date.now() - t0, "ms"); process.exit(0); };
}
