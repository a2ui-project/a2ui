#!/bin/sh
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

# Standalone, user-space installer for the A2UI CLI (a2ui).
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/a2ui-project/a2ui/main/scripts/install_cli.sh | sh
#
# Options (via environment variables):
#   A2UI_VERSION      Version to install (e.g., "0.1.0" or "cli-v0.1.0"). Defaults to latest release.
#   A2UI_INSTALL_DIR  Target install directory. Defaults to $HOME/.local/bin.
#   A2UI_REPO         GitHub repository (owner/repo). Defaults to "a2ui-project/a2ui".

set -eu

REPO="${A2UI_REPO:-a2ui-project/a2ui}"
INSTALL_DIR="${A2UI_INSTALL_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}"

# Determine OS
OS="$(uname -s)"
case "$OS" in
  Linux*)  TARGET_OS="linux" ;;
  Darwin*) TARGET_OS="darwin" ;;
  *)
    echo "Error: Unsupported operating system '$OS'." >&2
    echo "For Windows, use PowerShell: 'irm https://raw.githubusercontent.com/$REPO/main/scripts/install_cli.ps1 | iex'" >&2
    exit 1
    ;;
esac

# Determine Architecture
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)   TARGET_ARCH="x64" ;;
  arm64|aarch64)  TARGET_ARCH="arm64" ;;
  *)
    echo "Error: Unsupported architecture '$ARCH'." >&2
    exit 1
    ;;
esac

TARGET="${TARGET_OS}-${TARGET_ARCH}"

# Determine Version & Tag
VERSION="${A2UI_VERSION:-}"
if [ -z "$VERSION" ] || [ "$VERSION" = "latest" ]; then
  echo "Resolving latest A2UI CLI release from https://github.com/$REPO..."
  RELEASE_DATA="$(curl -sSfL -H "Accept: application/vnd.github.v3+json" "https://api.github.com/repos/$REPO/releases" 2>/dev/null || true)"
  if [ -n "$RELEASE_DATA" ]; then
    TAG="$(printf '%s\n' "$RELEASE_DATA" | grep -m 1 '"tag_name": "cli-v' | sed -E 's/.*"tag_name": "([^"]+)".*/\1/' || true)"
  else
    TAG=""
  fi

  if [ -z "$TAG" ]; then
    echo "Notice: Could not automatically query releases via GitHub API (likely unauthenticated rate limit)." >&2
    echo "Please specify the version explicitly, e.g.:" >&2
    echo "  curl -sSL https://raw.githubusercontent.com/$REPO/main/scripts/install_cli.sh | A2UI_VERSION=0.1.0 sh" >&2
    exit 1
  fi
else
  case "$VERSION" in
    cli-v*) TAG="$VERSION" ;;
    v*)     TAG="cli-$VERSION" ;;
    *)      TAG="cli-v$VERSION" ;;
  esac
fi

RAW_VERSION="$(printf '%s' "$TAG" | sed -E 's/^cli-v//')"
ARCHIVE_NAME="a2ui-v${RAW_VERSION}-${TARGET}.tar.gz"
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/${ARCHIVE_NAME}"
CHECKSUMS_URL="https://github.com/${REPO}/releases/download/${TAG}/checksums.txt"

TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t 'a2ui-install')"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

echo "Downloading A2UI CLI ($TAG) for $TARGET..."
if ! curl -sSfL "$DOWNLOAD_URL" -o "$TMP_DIR/$ARCHIVE_NAME"; then
  echo "Error: Failed to download release archive from:" >&2
  echo "  $DOWNLOAD_URL" >&2
  exit 1
fi

echo "Verifying cryptographic SHA-256 checksum..."
if curl -sSfL "$CHECKSUMS_URL" -o "$TMP_DIR/checksums.txt" 2>/dev/null; then
  EXPECTED_SHA="$(grep "[[:space:]]${ARCHIVE_NAME}\$" "$TMP_DIR/checksums.txt" | awk '{print $1}' || true)"
  if [ -n "$EXPECTED_SHA" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      ACTUAL_SHA="$(sha256sum "$TMP_DIR/$ARCHIVE_NAME" | awk '{print $1}')"
    elif command -v shasum >/dev/null 2>&1; then
      ACTUAL_SHA="$(shasum -a 256 "$TMP_DIR/$ARCHIVE_NAME" | awk '{print $1}')"
    else
      ACTUAL_SHA=""
      echo "Warning: Neither 'sha256sum' nor 'shasum' is installed; skipping hash verification."
    fi

    if [ -n "$ACTUAL_SHA" ]; then
      if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
        echo "Error: Cryptographic checksum mismatch for $ARCHIVE_NAME!" >&2
        echo "  Expected: $EXPECTED_SHA" >&2
        echo "  Actual:   $ACTUAL_SHA" >&2
        exit 1
      fi
      echo "✓ SHA-256 checksum verified."
    fi
  else
    echo "Warning: $ARCHIVE_NAME not found in checksums.txt; proceeding."
  fi
else
  echo "Warning: checksums.txt not available for this release; proceeding."
fi

echo "Installing to $INSTALL_DIR/a2ui..."
mkdir -p "$INSTALL_DIR"
tar -xzf "$TMP_DIR/$ARCHIVE_NAME" -C "$TMP_DIR"

if [ ! -f "$TMP_DIR/a2ui" ]; then
  echo "Error: Release archive did not contain 'a2ui' executable." >&2
  exit 1
fi

mv "$TMP_DIR/a2ui" "$INSTALL_DIR/a2ui"
chmod +x "$INSTALL_DIR/a2ui"

echo "✓ Successfully installed A2UI CLI ($TAG) to $INSTALL_DIR/a2ui"

case ":$PATH:" in
  *":$INSTALL_DIR:"*)
    echo "✓ $INSTALL_DIR is already in your PATH."
    echo ""
    echo "Get started by running:"
    echo "  a2ui --help"
    ;;
  *)
    echo ""
    echo "⚠️  Action Required: $INSTALL_DIR is not currently in your PATH."
    echo "Add it to your shell configuration file to run 'a2ui' from anywhere:"
    echo ""
    CURRENT_SHELL="$(basename "${SHELL:-bash}")"
    if [ "$CURRENT_SHELL" = "zsh" ]; then
      echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc"
      echo "  source ~/.zshrc"
    elif [ "$CURRENT_SHELL" = "bash" ]; then
      echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc"
      echo "  source ~/.bashrc"
    else
      echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    fi
    echo ""
    echo "Or run directly:"
    echo "  $INSTALL_DIR/a2ui --help"
    ;;
esac
