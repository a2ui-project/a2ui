#!/bin/bash
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

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$SCRIPT_DIR/install_cli.sh"

echo "=== Running A2UI CLI Installer Test Suite ==="

# Test 1: Unsupported OS fails cleanly
echo "Test 1: Unsupported OS fails cleanly"
OUTPUT=$(OS_OVERRIDE="Solaris" bash -c '
  uname() {
    if [ "$1" = "-s" ]; then echo "Solaris"; else command uname "$@"; fi
  }
  export -f uname
  "'"$INSTALLER"'"
' 2>&1 || true)
if [[ "$OUTPUT" != *"Unsupported operating system 'Solaris'"* ]]; then
  echo "FAIL: Expected unsupported OS error, got:"
  echo "$OUTPUT"
  exit 1
fi
echo "✓ Test 1 passed"

# Test 2: Successful installation with valid checksum and mock assets
echo "Test 2: Successful mock installation and checksum verification"
TEST_TMP=$(mktemp -d)
trap 'rm -rf "$TEST_TMP"' EXIT

MOCK_INSTALL_DIR="$TEST_TMP/bin"
MOCK_ASSETS_DIR="$TEST_TMP/assets"
mkdir -p "$MOCK_ASSETS_DIR" "$MOCK_INSTALL_DIR"

# Detect host target matching installer logic
HOST_OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
HOST_ARCH="$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')"
TARGET="${HOST_OS}-${HOST_ARCH}"
VERSION="0.9.9"
ARCHIVE_NAME="a2ui-v${VERSION}-${TARGET}.tar.gz"

# Create a mock 'a2ui' executable inside staging
MOCK_STAGING="$TEST_TMP/staging"
mkdir -p "$MOCK_STAGING"
cat <<'EOF' > "$MOCK_STAGING/a2ui"
#!/bin/sh
echo "a2ui mock CLI v0.9.9"
EOF
chmod +x "$MOCK_STAGING/a2ui"

# Package archive
tar -czf "$MOCK_ASSETS_DIR/$ARCHIVE_NAME" -C "$MOCK_STAGING" a2ui
# Generate checksums.txt
(cd "$MOCK_ASSETS_DIR" && sha256sum "$ARCHIVE_NAME" > checksums.txt)

# Run installer with mock curl function injected
TEST_OUTPUT=$(
  MOCK_ASSETS_DIR="$MOCK_ASSETS_DIR" \
  A2UI_VERSION="$VERSION" \
  A2UI_INSTALL_DIR="$MOCK_INSTALL_DIR" \
  bash -c '
    curl() {
      url=""
      out=""
      while [ $# -gt 0 ]; do
        case "$1" in
          -o) out="$2"; shift 2 ;;
          http*) url="$1"; shift ;;
          *) shift ;;
        esac
      done
      case "$url" in
        *checksums.txt) cp "$MOCK_ASSETS_DIR/checksums.txt" "$out" ;;
        *.tar.gz)       cp "$MOCK_ASSETS_DIR/'"$ARCHIVE_NAME"'" "$out" ;;
        *) return 1 ;;
      esac
    }
    export -f curl
    "'"$INSTALLER"'"
  ' 2>&1
)

if [ ! -x "$MOCK_INSTALL_DIR/a2ui" ]; then
  echo "FAIL: a2ui was not installed to $MOCK_INSTALL_DIR"
  echo "$TEST_OUTPUT"
  exit 1
fi

MOCK_CLI_RUN=$("$MOCK_INSTALL_DIR/a2ui")
if [[ "$MOCK_CLI_RUN" != *"a2ui mock CLI v0.9.9"* ]]; then
  echo "FAIL: unexpected binary execution output: $MOCK_CLI_RUN"
  exit 1
fi

if [[ "$TEST_OUTPUT" != *"SHA-256 checksum verified"* ]]; then
  echo "FAIL: Expected checksum verification message in output:"
  echo "$TEST_OUTPUT"
  exit 1
fi
echo "✓ Test 2 passed"

# Test 3: Checksum mismatch is detected and halts installation
echo "Test 3: Checksum mismatch halts installation"
MOCK_INSTALL_DIR_3="$TEST_TMP/bin3"
mkdir -p "$MOCK_INSTALL_DIR_3"

# Corrupt the checksum file
echo "0000000000000000000000000000000000000000000000000000000000000000  $ARCHIVE_NAME" > "$MOCK_ASSETS_DIR/bad_checksums.txt"

MISMATCH_OUTPUT=$(
  MOCK_ASSETS_DIR="$MOCK_ASSETS_DIR" \
  A2UI_VERSION="$VERSION" \
  A2UI_INSTALL_DIR="$MOCK_INSTALL_DIR_3" \
  bash -c '
    curl() {
      url=""
      out=""
      while [ $# -gt 0 ]; do
        case "$1" in
          -o) out="$2"; shift 2 ;;
          http*) url="$1"; shift ;;
          *) shift ;;
        esac
      done
      case "$url" in
        *checksums.txt) cp "$MOCK_ASSETS_DIR/bad_checksums.txt" "$out" ;;
        *.tar.gz)       cp "$MOCK_ASSETS_DIR/'"$ARCHIVE_NAME"'" "$out" ;;
        *) return 1 ;;
      esac
    }
    export -f curl
    "'"$INSTALLER"'"
  ' 2>&1 || true
)

if [ -f "$MOCK_INSTALL_DIR_3/a2ui" ]; then
  echo "FAIL: Binary should not be installed when checksum fails!"
  exit 1
fi

if [[ "$MISMATCH_OUTPUT" != *"Cryptographic checksum mismatch"* ]]; then
  echo "FAIL: Expected checksum mismatch message, got:"
  echo "$MISMATCH_OUTPUT"
  exit 1
fi
echo "✓ Test 3 passed"

echo "=== All A2UI CLI Installer tests passed successfully! ==="
