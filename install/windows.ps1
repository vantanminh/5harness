# Automatic Windows install for 5harness (native CLI).
# Documented command:
#   irm https://raw.githubusercontent.com/vantanminh/5harness/main/install/windows.ps1 | iex
# Local artifact (tests / offline):
#   $env:HARNESS_INSTALL_FROM = "D:\path\to\artifact-dir-or-exe"
#   powershell -File install/windows.ps1
#
# HARNESS_INSTALL_FROM may be:
#   - a directory containing harness.exe / harness-x86_64-pc-windows-msvc.exe
#   - a direct path to the .exe
#   - a .zip produced by the release job
# HARNESS_INSTALL_PREFIX overrides the install root (default: %LOCALAPPDATA%\5harness)

$ErrorActionPreference = "Stop"

function Get-Prefix {
  if ($env:HARNESS_INSTALL_PREFIX -and $env:HARNESS_INSTALL_PREFIX.Trim()) {
    return $env:HARNESS_INSTALL_PREFIX.Trim()
  }
  return Join-Path $env:LOCALAPPDATA "5harness"
}

function Find-LocalBinary([string]$from) {
  if (-not $from) { return $null }
  if (Test-Path $from -PathType Leaf) {
    return (Resolve-Path $from).Path
  }
  if (Test-Path $from -PathType Container) {
    $names = @(
      "harness.exe",
      "harness-x86_64-pc-windows-msvc.exe",
      "harness-aarch64-pc-windows-msvc.exe"
    )
    foreach ($n in $names) {
      $p = Join-Path $from $n
      if (Test-Path $p) { return (Resolve-Path $p).Path }
    }
    $nested = Get-ChildItem -Path $from -Recurse -Filter "harness*.exe" -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($nested) { return $nested.FullName }
  }
  if ($from.ToLower().EndsWith(".zip") -and (Test-Path $from)) {
    $extract = Join-Path ([System.IO.Path]::GetTempPath()) ("5harness-unpack-" + [guid]::NewGuid().ToString("n"))
    New-Item -ItemType Directory -Path $extract | Out-Null
    Expand-Archive -Path $from -DestinationPath $extract -Force
    return Find-LocalBinary $extract
  }
  throw "HARNESS_INSTALL_FROM did not contain a harness Windows binary: $from"
}

function Install-Binary([string]$src, [string]$prefix) {
  $binDir = Join-Path $prefix "bin"
  New-Item -ItemType Directory -Path $binDir -Force | Out-Null
  $dest = Join-Path $binDir "harness.exe"
  Copy-Item -Path $src -Destination $dest -Force
  Write-Host "Installed $dest"
  if ($env:HARNESS_INSTALL_SKIP_PATH -eq "1") {
    Write-Host "Skipping user PATH update (HARNESS_INSTALL_SKIP_PATH=1)"
  } else {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not $userPath) { $userPath = "" }
    $parts = $userPath -split ";" | Where-Object { $_ -and $_.Trim() }
    if ($parts -notcontains $binDir) {
      $newPath = if ($userPath.Trim()) { "$userPath;$binDir" } else { $binDir }
      [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
      Write-Host "Added $binDir to user PATH"
    }
  }
  $env:Path = "$binDir;$env:Path"
  & $dest --version
  if ($LASTEXITCODE -ne 0) {
    throw "harness --version failed after install"
  }
}

$prefix = Get-Prefix
$from = $env:HARNESS_INSTALL_FROM
if ($from -and $from.Trim()) {
  $src = Find-LocalBinary $from.Trim()
  Install-Binary $src $prefix
  exit 0
}

$repo = if ($env:HARNESS_INSTALL_REPO) { $env:HARNESS_INSTALL_REPO } else { "vantanminh/5harness" }
$api = "https://api.github.com/repos/$repo/releases/latest"
Write-Host "Downloading latest 5harness Windows binary from GitHub ($repo)..."
$headers = @{ "User-Agent" = "5harness-install" }
$release = Invoke-RestMethod -Uri $api -Headers $headers
$asset = $release.assets | Where-Object {
  $_.name -match "windows" -or $_.name -eq "harness-x86_64-pc-windows-msvc.exe" -or $_.name -match "pc-windows-msvc"
} | Select-Object -First 1
if (-not $asset) {
  throw "No Windows asset on latest GitHub release. Set HARNESS_INSTALL_FROM to a local binary."
}
$tmp = Join-Path $env:TEMP $asset.name
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tmp -Headers $headers
Install-Binary $tmp $prefix
