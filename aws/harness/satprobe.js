/* Measure the saturation pass on photo-05 (real salmon pills, currently missed)
   vs photo-15 (Feroglobin bottle whose red label text once formed a fake grid).
   Goal: find a measurable pill-ness cue that licenses the sat pass without a
   label quad, keeping the bottle at zero. */
const path = require("path");
const { loadImageData } = require("./eval.js");
(async () => {
  const root = path.resolve(__dirname, "..", "..");
  const cv = await require(path.join(root, "opencv.js")); global.cv = cv;
  global.ImageData = class { constructor(a,b,c){ if (typeof a==="number"){this.width=a;this.height=b;this.data=new Uint8ClampedArray(a*b*4);} else {this.data=a;this.width=b;this.height=c;} } };
  const { _internals } = require(path.join(root, "vision-worker.js"));
  const { saturationChannel, detectCellsByContour, gateUniform, gridOK } = _internals;

  for (const name of ["photo-05", "photo-15", "photo-11", "photo-13"]) {
    const px = await loadImageData(cv, path.join(root, "corpus", name + ".jpg"));
    const src = cv.matFromImageData(px);
    const sat = saturationChannel(src);
    const cells = detectCellsByContour(sat, false, 15);
    const fam = gateUniform(cells);
    const ok = fam ? gridOK(fam) : false;
    console.log(`${name}: satBlobs=${cells.length} fam=${fam?fam.length:0} gridOK=${ok}`);
    if (fam) {
      // pill-ness candidate metrics per cell: interior color variance + sat contrast
      const d = src.data, W = src.cols; const sd = sat.data, SW = sat.cols;
      for (const c of fam.slice(0, 12)) {
        const half = Math.max(3, Math.round(c.r*0.5));
        let n=0, sr=0,sg=0,sb=0, srr=0,sgg=0,sbb=0, satIn=0, satRing=0, nR=0;
        for (let y=Math.round(c.cy-half); y<c.cy+half; y+=2) for (let x=Math.round(c.cx-half); x<c.cx+half; x+=2) {
          if (y<0||x<0||y>=src.rows||x>=W) continue;
          const i=(y*W+x)*4; const r=d[i],g=d[i+1],b=d[i+2];
          sr+=r;sg+=g;sb+=b; srr+=r*r;sgg+=g*g;sbb+=b*b; n++;
          satIn += sd[y*SW+x];
        }
        const rOut0=c.r*1.15, rOut1=c.r*1.4;
        for (let a=0;a<40;a++){ const th=a/40*2*Math.PI; const rr=(rOut0+rOut1)/2;
          const x=Math.round(c.cx+Math.cos(th)*rr), y=Math.round(c.cy+Math.sin(th)*rr);
          if (y<0||x<0||y>=src.rows||x>=W) continue; satRing += sd[y*SW+x]; nR++; }
        const varSum = n? ((srr/n-(sr/n)**2)+(sgg/n-(sg/n)**2)+(sbb/n-(sb/n)**2)) : 0;
        console.log(`  cell (${Math.round(c.cx)},${Math.round(c.cy)}) r=${Math.round(c.r)} colorVar=${Math.round(varSum)} satIn=${n?Math.round(satIn/n):0} satRing=${nR?Math.round(satRing/nR):0}`);
      }
    }
    sat.delete(); src.delete();
  }
})().catch(e => { console.error(e); process.exit(1); });
