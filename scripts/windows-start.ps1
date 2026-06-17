$ErrorActionPreference = "Stop"

function Info($message) {
  Write-Host "[Refresh] $message" -ForegroundColor Cyan
}

function Warn($message) {
  Write-Host "[Refresh] $message" -ForegroundColor Yellow
}

function Command-Exists($name) {
  return $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

function Add-Path-IfExists($path) {
  if ($path -and (Test-Path $path) -and (($env:Path -split ';') -notcontains $path)) {
    $env:Path = "$path;$env:Path"
  }
}

function Find-Chrome {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      return $candidate
    }
  }
  return $null
}

function Install-Bun {
  Info "Bun was not found. Installing Bun for the current user..."
  try {
    powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"
  } catch {
    Warn "Bun official installer failed: $($_.Exception.Message)"
    if (Command-Exists "winget") {
      Warn "Trying winget fallback..."
      winget install Oven-sh.Bun -e --accept-package-agreements --accept-source-agreements
    } else {
      throw "Bun install failed and winget is not available. Install Bun manually: https://bun.sh"
    }
  }
}

function Bun-Install-WithFallback {
  $registries = @()
  if ($env:REFRESH_NPM_REGISTRY) {
    $registries += $env:REFRESH_NPM_REGISTRY
  } else {
    $registries += ""
    $registries += "https://registry.npmmirror.com"
  }

  $lastError = $null
  foreach ($registry in $registries) {
    try {
      if ($registry) {
        Info "Installing dependencies with registry: $registry"
        bun install --registry $registry
      } else {
        Info "Installing dependencies with default registry..."
        bun install
      }
      return
    } catch {
      $lastError = $_
      if ($registry) {
        Warn "Dependency install failed with $registry"
      } else {
        Warn "Dependency install failed with default registry, trying China mirror..."
      }
    }
  }

  throw "Dependency install failed. Last error: $($lastError.Exception.Message)"
}

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

Info "Working directory: $Root"

Add-Path-IfExists "$env:USERPROFILE\.bun\bin"

if (-not (Command-Exists "bun")) {
  Install-Bun
  Add-Path-IfExists "$env:USERPROFILE\.bun\bin"
}

if (-not (Command-Exists "bun")) {
  throw "Bun is still not available. Open a new terminal or install Bun manually: https://bun.sh"
}

$chrome = Find-Chrome
if ($chrome) {
  $env:RADAR_CHROME_BIN = $chrome
  Info "Chrome/Edge found: $chrome"
} else {
  Warn "Chrome/Edge was not found. Install Chrome, or set RADAR_CHROME_BIN before starting."
}

Bun-Install-WithFallback

$env:PORT = if ($env:PORT) { $env:PORT } else { "3001" }
$env:REFRESH_API_TARGET = if ($env:REFRESH_API_TARGET) { $env:REFRESH_API_TARGET } else { "http://localhost:$($env:PORT)" }
$env:RADAR_PROFILE_DIR = if ($env:RADAR_PROFILE_DIR) { $env:RADAR_PROFILE_DIR } else { Join-Path $Root "profiles\main" }

Info "Starting Refresh..."
Info "Frontend: http://localhost:5173"
Info "Backend:  http://localhost:$($env:PORT)"
Info "Keep this window open while using Refresh."
Write-Host ""

Start-Job -ScriptBlock {
  Start-Sleep -Seconds 3
  Start-Process "http://localhost:5173"
} | Out-Null

bun run start
