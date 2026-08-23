/* MedLens Vision — AWS Lambda evaluation backbone.
   Pulls the hand-labeled photo corpus from S3, runs the EXACT on-device
   OpenCV 5 pipeline (vision-worker.js + the self-compiled WASM) headlessly,
   scores it, and writes the full result set back to S3. Deployed twice —
   arm64 (Graviton) and x86_64 — so the same run doubles as the COOL
   cost/latency comparison. Zero browser, zero AI: deterministic code only. */
"use strict";
const fs = require("fs");
const path = require("path");
const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { main } = require("./eval.js");

const s3 = new S3Client({});
const BUCKET = process.env.CORPUS_BUCKET;
const PREFIX = process.env.CORPUS_PREFIX || "corpus/";

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

async function downloadCorpus(dir) {
  fs.mkdirSync(dir, { recursive: true });
  let token, n = 0;
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token }));
    for (const obj of res.Contents || []) {
      const name = path.basename(obj.Key);
      if (!/\.(jpe?g|json)$/i.test(name)) continue;
      const body = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
      fs.writeFileSync(path.join(dir, name), await streamToBuffer(body.Body));
      n++;
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return n;
}

exports.handler = async (event) => {
  const t0 = Date.now();
  const corpusDir = "/tmp/corpus";
  const files = await downloadCorpus(corpusDir);
  const { summary, rows } = await main({ root: __dirname, corpusDir, verbose: false });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const arch = process.arch;
  const report = {
    generatedAt: new Date().toISOString(),
    lambda: { arch, node: process.version, memoryMB: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE, region: process.env.AWS_REGION,
              functionName: process.env.AWS_LAMBDA_FUNCTION_NAME, corpusFiles: files, downloadMs: undefined, totalMs: Date.now() - t0 },
    summary, rows,
  };
  const key = `results/eval-${stamp}-${arch}.json`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: JSON.stringify(report, null, 2), ContentType: "application/json" }));
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `results/latest-${arch}.json`, Body: JSON.stringify(report, null, 2), ContentType: "application/json" }));
  return { ok: true, key, arch, summary, totalMs: Date.now() - t0 };
};
