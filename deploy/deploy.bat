@echo off
rem MedLens Vision production deploy - dist\ is a CLEAN mirror of the runtime files; any copy failure aborts
cd /d "%~dp0"
if exist dist rmdir /s /q dist
mkdir dist
for %%f in (index.html sw.js manifest.webmanifest icon.svg icon-192.png icon-512.png icon-512-maskable.png apple-touch-icon.png opencv.js vision-worker.js) do (
  copy /y "..\%%f" dist\ >nul
  if errorlevel 1 (
    echo COPY FAILED: %%f - aborting deploy
    exit /b 1
  )
)
echo dist\ refreshed.
call npx wrangler deploy
