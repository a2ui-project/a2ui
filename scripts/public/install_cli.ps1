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
#   irm https://raw.githubusercontent.com/a2ui-project/a2ui/main/scripts/public/install_cli.ps1 | iex

& {
    $ErrorActionPreference = "Stop"

    # Ensure TLS 1.2 is enabled for older PowerShell environments without overwriting other protocols
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $Repo = if ($env:A2UI_REPO) { $env:A2UI_REPO } else { "a2ui-project/a2ui" }
    $InstallDir = if ($env:A2UI_INSTALL_DIR) {
        $env:A2UI_INSTALL_DIR.TrimEnd("\/")
    } else {
        Join-Path $env:LOCALAPPDATA "Programs\a2ui\bin"
    }

    # Release matrix produces windows-x64 executables (supported on x64 and ARM64 via Windows 11 emulation)
    $NativeArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    if ($NativeArch -ne "AMD64" -and $NativeArch -ne "ARM64") {
        throw "Unsupported Windows architecture: $NativeArch. The A2UI CLI binary requires an x64 or ARM64 host."
    }
    $Target = "windows-x64"

    $Version = $env:A2UI_VERSION
    if (-not $Version -or $Version -eq "latest") {
        Write-Host "Resolving latest A2UI CLI release from https://github.com/$Repo..."
        try {
            $ReleaseUri = "https://api.github.com/repos/$Repo/releases?per_page=100"
            $Releases = Invoke-RestMethod -Uri $ReleaseUri -Headers @{ "Accept" = "application/vnd.github+json" }
            $CliRelease = $Releases | Where-Object { $_.tag_name -like "cli-v*" -and -not $_.prerelease -and -not $_.draft } | Select-Object -First 1
            if ($CliRelease) {
                $Tag = $CliRelease.tag_name
            } else {
                throw "No eligible 'cli-v*' release found in repository $Repo."
            }
        } catch {
            throw "Could not resolve latest release: $($_.Exception.Message). Specify the version explicitly with: `$env:A2UI_VERSION = '0.1.0'"
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
        try {
            Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipPath -UseBasicParsing
        } catch {
            throw "Failed to download release archive from $DownloadUrl: $($_.Exception.Message)"
        }

        if (-not $env:A2UI_SKIP_CHECKSUM -or $env:A2UI_SKIP_CHECKSUM -ne "1") {
            $ChecksumsPath = Join-Path $TempDir "checksums.txt"
            Write-Host "Verifying cryptographic SHA-256 checksum..."
            try {
                Invoke-WebRequest -Uri $ChecksumsUrl -OutFile $ChecksumsPath -UseBasicParsing
            } catch {
                throw "Failed to download checksums.txt from $ChecksumsUrl: $($_.Exception.Message). Set `$env:A2UI_SKIP_CHECKSUM = '1' to bypass."
            }

            $ChecksumContent = Get-Content $ChecksumsPath
            $ExpectedLine = $ChecksumContent | Where-Object { $_ -match "(\s|\*)" + [regex]::Escape($ArchiveName) + "$" } | Select-Object -First 1
            if (-not $ExpectedLine) {
                throw "Archive $ArchiveName not found in checksums.txt!"
            }
            $ExpectedHash = ($ExpectedLine.Trim() -split "\s+")[0].ToLower()
            $ActualHash = (Get-FileHash -Path $ZipPath -Algorithm SHA256).Hash.ToLower()
            if ($ActualHash -ne $ExpectedHash) {
                throw "Cryptographic checksum mismatch for $ArchiveName!`nExpected: $ExpectedHash`nActual:   $ActualHash"
            }
            Write-Host "[OK] SHA-256 checksum verified."
        } else {
            Write-Warning "A2UI_SKIP_CHECKSUM=1 set; skipping checksum verification."
        }

        Write-Host "Installing to $InstallDir\a2ui.exe..."
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        Expand-Archive -Path $ZipPath -DestinationPath $TempDir -Force

        $ExtractedExe = Join-Path $TempDir "a2ui.exe"
        if (-not (Test-Path $ExtractedExe)) {
            throw "Release archive did not contain 'a2ui.exe'."
        }

        Copy-Item -Path $ExtractedExe -Destination (Join-Path $InstallDir "a2ui.exe") -Force
        Write-Host "[OK] Successfully installed A2UI CLI ($Tag) to $InstallDir\a2ui.exe"

        # Verify and update User PATH
        $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
        $PathParts = if ($UserPath) { $UserPath -split ";" } else { @() }
        if ($PathParts -notcontains $InstallDir) {
            Write-Host "Adding $InstallDir to user PATH environment variable..."
            $NewUserPath = if ($UserPath) { "$UserPath;$InstallDir" } else { $InstallDir }
            [Environment]::SetEnvironmentVariable("Path", $NewUserPath, "User")
            $env:Path = "$env:Path;$InstallDir"
            Write-Host "[OK] Added $InstallDir to PATH."
        }

        Write-Host "`nGet started by opening a new terminal and running:"
        Write-Host "  a2ui --help"
    } finally {
        Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
