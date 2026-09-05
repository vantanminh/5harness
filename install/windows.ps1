# Automatic Windows install for 5harness (native CLI).
# Documented command:
#   irm https://raw.githubusercontent.com/vantanminh/5harness/main/install/windows.ps1 | iex
# Local artifact (tests / offline):
#   $env:HARNESS_INSTALL_FROM = "D:\path\to\artifact-dir-or-exe-or-zip"
#   powershell -File install/windows.ps1
#
# HARNESS_INSTALL_PREFIX overrides the install root (default:
# %LOCALAPPDATA%\5harness). HARNESS_INSTALL_SKIP_PATH=1 is useful in CI.
$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  throw "5harness install: $Message"
}

function Get-Prefix {
  if ($env:HARNESS_INSTALL_PREFIX -and $env:HARNESS_INSTALL_PREFIX.Trim()) {
    return $env:HARNESS_INSTALL_PREFIX.Trim()
  }
  $base = if ($env:LOCALAPPDATA -and $env:LOCALAPPDATA.Trim()) {
    $env:LOCALAPPDATA
  } elseif ($env:USERPROFILE -and $env:USERPROFILE.Trim()) {
    $env:USERPROFILE
  } else {
    Fail "LOCALAPPDATA or USERPROFILE is required"
  }
  return Join-Path $base "5harness"
}

function Get-Target {
  $architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  switch ($architecture) {
    "X64" { return "x86_64-pc-windows-msvc" }
    "Arm64" { return "aarch64-pc-windows-msvc" }
    default { Fail "unsupported Windows architecture: $architecture (supported: X64, Arm64)" }
  }
}

$script:TemporaryRoots = New-Object System.Collections.Generic.List[string]

function Find-LocalBinary([string]$From, [string]$Target) {
  if (-not $From -or -not $From.Trim()) { return $null }
  $path = [System.IO.Path]::GetFullPath($From.Trim())
  if (-not (Test-Path -LiteralPath $path)) {
    Fail "HARNESS_INSTALL_FROM does not exist: $From"
  }

  # Check archives before the generic leaf path branch. A .zip is an input
  # bundle, never a native executable to copy to harness.exe.
  if ((Test-Path -LiteralPath $path -PathType Leaf) -and ($path -match '(?i)\.zip$')) {
    $extract = Join-Path ([System.IO.Path]::GetTempPath()) ("5harness-unpack-" + [guid]::NewGuid().ToString("n"))
    New-Item -ItemType Directory -Path $extract -Force | Out-Null
    Expand-Archive -LiteralPath $path -DestinationPath $extract -Force
    $script:TemporaryRoots.Add($extract)
    return Find-LocalBinary $extract $Target
  }

  if (Test-Path -LiteralPath $path -PathType Leaf) {
    if ($path -notmatch '(?i)\.exe$') {
      Fail "HARNESS_INSTALL_FROM must point to a .exe, directory, or .zip: $From"
    }
    return (Resolve-Path -LiteralPath $path).Path
  }

  $names = @("harness-$Target.exe", "harness.exe")
  foreach ($name in $names) {
    $candidate = Join-Path $path $name
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  foreach ($name in $names) {
    $nested = Get-ChildItem -LiteralPath $path -Recurse -File -Filter $name -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($nested) { return $nested.FullName }
  }
  Fail "HARNESS_INSTALL_FROM did not contain a harness Windows binary for ${Target}: $From"
}

function Add-UserPath([string]$BinDir) {
  if ($env:HARNESS_INSTALL_SKIP_PATH -eq "1") {
    Write-Host "Skipping user PATH update (HARNESS_INSTALL_SKIP_PATH=1)"
    return
  }
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not $userPath) { $userPath = "" }
  $normalized = ([System.IO.Path]::GetFullPath($BinDir)).TrimEnd([char[]]@('\', '/'))
  $parts = @($userPath -split ';' | Where-Object { $_ -and $_.Trim() })
  $alreadyPresent = $false
  foreach ($part in $parts) {
    try {
      $candidate = ([System.IO.Path]::GetFullPath($part.Trim())).TrimEnd([char[]]@('\', '/'))
      if ($candidate -ieq $normalized) { $alreadyPresent = $true; break }
    } catch {
      # Keep unrelated malformed PATH entries untouched.
    }
  }
  if (-not $alreadyPresent) {
    $newPath = if ($userPath.Trim()) { "$userPath;$BinDir" } else { $BinDir }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Host "Added $BinDir to user PATH"
  }
}

function Install-Binary([string]$Source, [string]$Prefix) {
  if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    Fail "native binary not found: $Source"
  }
  $binDir = Join-Path $Prefix "bin"
  New-Item -ItemType Directory -Path $binDir -Force | Out-Null
  $destination = Join-Path $binDir "harness.exe"
  Copy-Item -LiteralPath $Source -Destination $destination -Force
  Write-Host "Installed $destination"
  Add-UserPath $binDir
  $env:Path = "$binDir;$env:Path"
  & $destination --version
  if ($LASTEXITCODE -ne 0) {
    Fail "harness --version failed after install"
  }
}

$prefix = Get-Prefix
$target = Get-Target
$from = $env:HARNESS_INSTALL_FROM

try {
  if ($from -and $from.Trim()) {
    $source = Find-LocalBinary $from $target
    Install-Binary $source $prefix
    exit 0
  }

  $repo = if ($env:HARNESS_INSTALL_REPO -and $env:HARNESS_INSTALL_REPO.Trim()) {
    $env:HARNESS_INSTALL_REPO.Trim()
  } else {
    "vantanminh/5harness"
  }
  $version = if ($env:HARNESS_INSTALL_VERSION -and $env:HARNESS_INSTALL_VERSION.Trim()) {
    $env:HARNESS_INSTALL_VERSION.Trim()
  } else {
    "latest"
  }
  if ($version -eq "latest") {
    $api = "https://api.github.com/repos/$repo/releases/latest"
    Write-Host "Resolving latest 5harness release from GitHub ($repo)..."
    $release = Invoke-RestMethod -Uri $api -Headers @{ "User-Agent" = "5harness-install" }
    $tag = [string]$release.tag_name
    if (-not $tag) { Fail "latest GitHub release did not contain a tag" }
    $asset = $release.assets | Where-Object { $_.name -eq "harness-$target.exe" } | Select-Object -First 1
    if (-not $asset) { Fail "release $tag has no harness-$target.exe asset" }
    $url = [string]$asset.browser_download_url
  } else {
    if ($version -notmatch '^v?[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$') {
      Fail "HARNESS_INSTALL_VERSION must be semver (for example 0.25.3 or v0.25.3)"
    }
    $tag = "v" + $version.TrimStart('v')
    $url = "https://github.com/$repo/releases/download/$tag/harness-$target.exe"
  }

  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("5harness-$target-" + [guid]::NewGuid().ToString("n") + ".exe")
  $script:TemporaryRoots.Add($tmp)
  Write-Host "Downloading 5harness $tag ($target) from GitHub ($repo)..."
  Invoke-WebRequest -Uri $url -OutFile $tmp -Headers @{ "User-Agent" = "5harness-install" }
  Install-Binary $tmp $prefix
} finally {
  foreach ($temporary in $script:TemporaryRoots) {
    try {
      if (Test-Path -LiteralPath $temporary -PathType Container) {
        Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
      } elseif (Test-Path -LiteralPath $temporary -PathType Leaf) {
        Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
      }
    } catch {
      # Temporary cleanup must not hide a successful installation.
    }
  }
}
