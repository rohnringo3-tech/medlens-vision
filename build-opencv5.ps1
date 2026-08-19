# Builds a single-threaded OpenCV 5.x opencv.js from source.
# Why: the official docs.opencv.org/5.x build uses pthreads and hard-hangs
# browsers without cross-origin isolation. Threads are OFF by default in
# build_js.py, so a plain source build gives us a safe 5.x binary.
# Output: opencv5-build\build_js\bin\opencv.js
$ErrorActionPreference = "Stop"
$work = "C:\Users\LEGION\Desktop\MedLens Vision\opencv5-build"
$log = "$work\build.log"
New-Item -ItemType Directory -Force $work | Out-Null
function Step($m) { $line = "{0} {1}" -f (Get-Date -Format "HH:mm:ss"), $m; $line | Out-File -FilePath $log -Append -Encoding utf8; Write-Host $line }

Step "=== OpenCV 5 single-threaded WASM build ==="

# ---- tooling checks ----
Step "checking tools"
$haveCmake = $null -ne (Get-Command cmake -ErrorAction SilentlyContinue)
$haveNinja = $null -ne (Get-Command ninja -ErrorAction SilentlyContinue)
Step "cmake: $haveCmake  ninja: $haveNinja"
if (-not $haveCmake) {
  Step "installing cmake via winget"
  winget install --id Kitware.CMake -e --accept-package-agreements --accept-source-agreements --silent | Out-File $log -Append -Encoding utf8
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
if (-not $haveNinja) {
  Step "installing ninja via winget"
  winget install --id Ninja-build.Ninja -e --accept-package-agreements --accept-source-agreements --silent | Out-File $log -Append -Encoding utf8
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

# ---- emsdk ----
# NOTE: native tools write progress to stderr; under ErrorActionPreference=Stop
# that becomes a fake terminating error in PS 5.1 — route them through cmd /c.
Set-Location $work
# a previous crashed run can leave a half-cloned emsdk — verify the entry script exists
if ((Test-Path "$work\emsdk") -and -not (Test-Path "$work\emsdk\emsdk.bat")) {
  Step "emsdk dir is a broken partial clone - removing"
  Remove-Item -Recurse -Force "$work\emsdk"
}
if (-not (Test-Path "$work\emsdk")) {
  Step "cloning emsdk"
  cmd /c "git clone --depth 1 https://github.com/emscripten-core/emsdk.git >> `"$log`" 2>&1"
  if ($LASTEXITCODE -ne 0) { Step "emsdk clone failed"; exit 1 }
}
# re-resolve build tools after any winget install; hard-fail early if absent
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") + ";" + $env:Path
if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
  if (Test-Path "C:\Program Files\CMake\bin\cmake.exe") { $env:Path = "C:\Program Files\CMake\bin;$env:Path" }
  else { Step "cmake unavailable after install - aborting"; exit 1 }
}
if (-not (Get-Command ninja -ErrorAction SilentlyContinue)) {
  $nj = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ninja.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($nj) { $env:Path = "$($nj.DirectoryName);$env:Path" }
  else { Step "ninja unavailable after install - aborting"; exit 1 }
}
Step "tools ok: cmake=$((Get-Command cmake).Source) ninja=$((Get-Command ninja).Source)"
# Start-Process with -WorkingDirectory sidesteps both PS cwd desync AND
# cmd /c quote-stripping on paths with spaces
function RunTool($file, $argList, $dir, $tag) {
  $out = "$work\$tag.out"; $err = "$work\$tag.err"
  $p = Start-Process -FilePath $file -ArgumentList $argList -WorkingDirectory $dir -NoNewWindow -Wait -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  Get-Content $out -ErrorAction SilentlyContinue | Out-File $log -Append -Encoding utf8
  Get-Content $err -ErrorAction SilentlyContinue | Out-File $log -Append -Encoding utf8
  return $p.ExitCode
}
# PINNED: the shipped binary was built with emscripten 6.0.6 — "latest" would drift
Step "emsdk install 6.0.6 (pinned; downloads ~1GB toolchain, be patient)"
if ((RunTool "$work\emsdk\emsdk.bat" @("install", "6.0.6") "$work\emsdk" "emsdk-install") -ne 0) { Step "emsdk install failed"; exit 1 }
Step "emsdk activate 6.0.6"
if ((RunTool "$work\emsdk\emsdk.bat" @("activate", "6.0.6") "$work\emsdk" "emsdk-activate") -ne 0) { Step "emsdk activate failed"; exit 1 }

# pick up the env emsdk_env.bat would set
$env:EMSDK = "$work\emsdk"
$emscripten = Get-ChildItem "$work\emsdk\upstream\emscripten" -ErrorAction Stop | Out-Null
$env:Path = "$work\emsdk;$work\emsdk\upstream\emscripten;$env:Path"
$py = Get-ChildItem "$work\emsdk\python" -Directory | Select-Object -First 1
if ($py) { $env:Path = "$($py.FullName);$env:Path" }
Step "emsdk ready at $env:EMSDK"

# ---- opencv 5.x source ----
if ((Test-Path "$work\opencv") -and -not (Test-Path "$work\opencv\platforms\js\build_js.py")) {
  Step "opencv dir is a broken partial clone - removing"
  Remove-Item -Recurse -Force "$work\opencv"
}
if (-not (Test-Path "$work\opencv")) {
  # PINNED: the shipped opencv.js was built from 5.x commit 96fcd0c (2026-08-15).
  # A depth-1 branch clone would drift as 5.x moves; fetch that exact commit so
  # the binary is reproducible byte-for-byte in spirit (same source tree).
  Step "cloning opencv 5.x @ 96fcd0c (pinned)"
  if ((RunTool "git" @("clone", "--filter=blob:none", "--branch", "5.x", "https://github.com/opencv/opencv.git") $work "opencv-clone") -ne 0) { Step "opencv clone failed"; exit 1 }
  if ((RunTool "git" @("checkout", "96fcd0cdbe1b7de0dc52152eeb30d9e74234ca05") "$work\opencv" "opencv-pin") -ne 0) { Step "opencv pin checkout failed"; exit 1 }
}

# ---- build (threads OFF by default; default whitelist = full standard API) ----
Step "starting build_js.py (Ninja) - this takes 20-60 min"
$python = (Get-Command python -ErrorAction SilentlyContinue)
if (-not $python) { $python = (Get-Command py -ErrorAction SilentlyContinue) }
if (-not $python) { Step "no system python - using emsdk's"; $python = @{ Source = (Get-ChildItem "$work\emsdk\python\*\python.exe" | Select-Object -First 1).FullName } }
Step "python: $($python.Source)"
$code = RunTool $python.Source @("`"$work\opencv\platforms\js\build_js.py`"", "`"$work\build_js`"", "--emscripten_dir", "`"$work\emsdk\upstream\emscripten`"", "--cmake_option=-GNinja") $work "buildjs"
if ($code -ne 0) { Step "build_js.py exited $code - checking for output anyway" }

if (Test-Path "$work\build_js\bin\opencv.js") {
  $size = (Get-Item "$work\build_js\bin\opencv.js").Length
  Step "SUCCESS: opencv.js built, $size bytes at $work\build_js\bin\opencv.js"
} else {
  Step "FAILED: no opencv.js produced - read $log"
  exit 1
}
