@echo off
rem MedLens Vision production deploy - dist\ is a CLEAN mirror of the runtime files; any copy failure aborts
cd /d "%~dp0"
if exist dist rmdir /s /q dist
mkdir dist
for %%f in (index.html sw.js manifest.webmanifest icon.svg icon-192.png icon-512.png icon-512-maskable.png apple-touch-icon.png opencv.js vision-worker.js README.md) do (
  copy /y "..\%%f" dist\ >nul
  if errorlevel 1 (
    echo COPY FAILED: %%f - aborting deploy
    exit /b 1
  )
)
rem the eval page and the Devpost links depend on these - losing them breaks /?eval=1 and /onepager.pdf
copy /y "..\submission\MedLensVision-OnePager.pdf" dist\onepager.pdf >nul
if errorlevel 1 (
  echo COPY FAILED: onepager.pdf - aborting deploy
  exit /b 1
)
xcopy /y /i /q "..\corpus\*.jpg" dist\corpus\ >nul
if errorlevel 1 (
  echo COPY FAILED: corpus photos - aborting deploy
  exit /b 1
)
copy /y "..\corpus\manifest.json" dist\corpus\ >nul
if errorlevel 1 (
  echo COPY FAILED: corpus manifest - aborting deploy
  exit /b 1
)
echo dist\ refreshed.
call npx wrangler deploy
