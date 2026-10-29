# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Standalone, user-space installer for the A2UI CLI on Windows.
#
# Usage:
#   irm https://raw.githubusercontent.com/a2ui-project/a2ui/main/scripts/install_cli.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = if ($env:A2UI_REPO) { $env:A2UI_REPO } else { "a2ui-project/a2ui" }
$InstallDir = if ($env:A2UI_INSTALL_DIR) {
    $env:A2UI_INSTALL_DIR
} else {
    Join-Path $env:LOCALAPPDATA "Programs\a2ui\bin"
}

$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
$Target = "windows-$Arch"

$Version = $env:A2UI_VERSION
if (-not $Version -or $Version -eq "latest") {
    Write-Host "Resolving latest A2UI CLI release from https://github.com/$Repo..."
    try {
        $ReleaseUri = "https://api.github.com/repos/$Repo/releases"
        $Releases = Invoke-RestMethod -Uri $ReleaseUri -Headers @{ "Accept" = "application/vnd.github.v3+json" }
        $CliRelease = $Releases | Where-Object { $_.tag_name -like "cli-v*" } | Select-Object -First 1
        if ($CliRelease) {
            $Tag = $CliRelease.tag_name
        } else {
            throw "No cli-v* releases found"
        }
    } catch {
        Write-Error "Could not automatically resolve latest release version. Set `$env:A2UI_VERSION = '0.1.0' and re-run."
        exit 1
    }
} else {
    if ($Version -like "cli-v*") {
        $Tag = $Version
    } elseif ($Version -like "v*") {
        $Tag = "cli-$Version"
    } else {
        $Tag = "cli-v$Version"
    }
}

$RawVersion = $Tag -replace "^cli-v", ""
$ArchiveName = "a2ui-v$RawVersion-$Target.zip"
$DownloadUrl = "https://github.com/$Repo/releases/download/$Tag/$ArchiveName"
$ChecksumsUrl = "https://github.com/$Repo/releases/download/$Tag/checksums.txt"

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

try {
    $ZipPath = Join-Path $TempDir $ArchiveName
    Write-Host "Downloading A2UI CLI ($Tag) for $Target..."
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipPath

    $ChecksumsPath = Join-Path $TempDir "checksums.txt"
    try {
        Invoke-WebRequest -Uri $ChecksumsUrl -OutFile $ChecksumsPath -ErrorAction SilentlyContinue
        if (Test-Path $ChecksumsPath) {
            Write-Host "Verifying cryptographic SHA-256 checksum..."
            $ChecksumContent = Get-Content $ChecksumsPath
            $ExpectedLine = $ChecksumContent | Where-Object { $_ -match "\s$ArchiveName$" } | Select-Object -First 1
            if ($ExpectedLine) {
                $ExpectedHash = ($ExpectedLine -split "\s+")[0].Trim().ToLower()
                $ActualHash = (Get-FileHash -Path $ZipPath -Algorithm SHA256).Hash.ToLower()
                if ($ActualHash -ne $ExpectedHash) {
                    Write-Error "Cryptographic checksum mismatch for $ArchiveName!`nExpected: $ExpectedHash`nActual:   $ActualHash"
                    exit 1
                }
                Write-Host "✓ SHA-256 checksum verified."
            }
        }
    } catch {
        Write-Warning "Checksum verification skipped."
    }

    Write-Host "Installing to $InstallDir\a2ui.exe..."
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Expand-Archive -Path $ZipPath -DestinationPath $TempDir -Force

    $ExtractedExe = Join-Path $TempDir "a2ui.exe"
    if (-not (Test-Path $ExtractedExe)) {
        Write-Error "Release archive did not contain 'a2ui.exe'."
        exit 1
    }

    Copy-Item -Path $ExtractedExe -Destination (Join-Path $InstallDir "a2ui.exe") -Force
    Write-Host "✓ Successfully installed A2UI CLI ($Tag) to $InstallDir\a2ui.exe"

    # Verify and update User PATH
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($UserPath -notlike "*$InstallDir*") {
        Write-Host "Adding $InstallDir to user PATH environment variable..."
        [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
        $env:Path = "$env:Path;$InstallDir"
        Write-Host "✓ Added $InstallDir to PATH."
    }

    Write-Host "`nGet started by opening a new terminal and running:"
    Write-Host "  a2ui --help"
} finally {
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
