#!/usr/bin/env bash
# Assemble the two Lambda deployment zips (arm64 + x64). Run from aws/lambda.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
for ARCH in arm64 x64; do
  OUT="dist-$ARCH"
  rm -rf "$OUT" && mkdir -p "$OUT"
  cp handler.js "$OUT/"
  cp ../harness/eval.js "$OUT/"
  cp "$ROOT/vision-worker.js" "$OUT/"
  cp "$ROOT/opencv.js" "$OUT/"
  cat > "$OUT/package.json" <<PKG
{ "name": "medlens-vision-eval", "version": "1.0.0", "private": true, "main": "handler.js",
  "dependencies": { "sharp": "0.34.3" } }
PKG
  ( cd "$OUT" && npm install --omit=dev --os=linux --cpu=$ARCH --libc=glibc --silent 2>&1 | tail -2 )
  rm -f "medlens-eval-$ARCH.zip"
  ( cd "$OUT" && powershell -NoProfile -Command "Compress-Archive -Path * -DestinationPath ../medlens-eval-$ARCH.zip -Force" )
  ls -la "medlens-eval-$ARCH.zip"
done
