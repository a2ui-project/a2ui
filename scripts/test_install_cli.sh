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

TEST_TMP=$(mktemp -d)
trap 'rm -rf "$TEST_TMP"' EXIT

STUB_BIN="$TEST_TMP/stubs"
mkdir -p "$STUB_BIN"

REAL_UNAME="$(command -v uname)"

# Create mock 'uname' stub
cat <<EOF > "$STUB_BIN/uname"
#!/bin/sh
if [ "\${1:-}" = "-s" ]; then
  echo "\${MOCK_UNAME_S:-\$("$REAL_UNAME" -s)}"
elif [ "\${1:-}" = "-m" ]; then
  echo "\${MOCK_UNAME_M:-\$("$REAL_UNAME" -m)}"
else
  exec "$REAL_UNAME" "\$@"
fi
EOF
chmod +x "$STUB_BIN/uname"

# Create mock 'curl' stub
cat <<'EOF' > "$STUB_BIN/curl"
#!/bin/sh
out=""
url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o)
      out="$2"
      shift 2
      ;;
    http*)
      url="$1"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [ -n "${MOCK_CURL_FAIL:-}" ]; then
  exit 1
fi

case "$url" in
  *checksums.txt)
    if [ -n "${MOCK_CHECKSUMS_FILE:-}" ] && [ -f "$MOCK_CHECKSUMS_FILE" ]; then
      cp "$MOCK_CHECKSUMS_FILE" "$out"
    else
      exit 22
    fi
    ;;
  *.tar.gz)
    if [ -n "${MOCK_ARCHIVE_FILE:-}" ] && [ -f "$MOCK_ARCHIVE_FILE" ]; then
      cp "$MOCK_ARCHIVE_FILE" "$out"
    else
      exit 22
    fi
    ;;
  *api.github.com/repos/*/releases*)
    if [ -n "${MOCK_RELEASES_API_FILE:-}" ] && [ -f "$MOCK_RELEASES_API_FILE" ]; then
      cat "$MOCK_RELEASES_API_FILE"
    else
      exit 22
    fi
    ;;
  *)
    exit 22
    ;;
esac
EOF
chmod +x "$STUB_BIN/curl"

# Test 1: Unsupported OS fails cleanly
echo "Test 1: Unsupported OS fails cleanly"
OUTPUT=$(PATH="$STUB_BIN:$PATH" MOCK_UNAME_S="Solaris" /bin/sh "$INSTALLER" 2>&1 || true)
if [[ "$OUTPUT" != *"Unsupported operating system 'Solaris'"* ]]; then
  echo "FAIL: Expected unsupported OS error, got:"
  echo "$OUTPUT"
  exit 1
fi
echo "✓ Test 1 passed"

# Setup shared test assets
MOCK_ASSETS_DIR="$TEST_TMP/assets"
mkdir -p "$MOCK_ASSETS_DIR"

HOST_OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
HOST_ARCH="$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')"
TARGET="${HOST_OS}-${HOST_ARCH}"
VERSION="0.9.9"
ARCHIVE_NAME="a2ui-v${VERSION}-${TARGET}.tar.gz"

MOCK_STAGING="$TEST_TMP/staging"
mkdir -p "$MOCK_STAGING"
cat <<'EOF' > "$MOCK_STAGING/a2ui"
#!/bin/sh
echo "a2ui mock CLI v0.9.9"
EOF
chmod +x "$MOCK_STAGING/a2ui"

tar -czf "$MOCK_ASSETS_DIR/$ARCHIVE_NAME" -C "$MOCK_STAGING" a2ui
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$MOCK_ASSETS_DIR" && sha256sum "$ARCHIVE_NAME" > checksums.txt)
elif command -v shasum >/dev/null 2>&1; then
  (cd "$MOCK_ASSETS_DIR" && shasum -a 256 "$ARCHIVE_NAME" > checksums.txt)
else
  echo "FAIL: Neither sha256sum nor shasum is available to run tests."
  exit 1
fi

# Test 2: Successful mock installation across available shells (/bin/sh, dash, bash)
echo "Test 2: Successful installation and checksum verification across shells"
SHELLS_TO_TEST="/bin/sh"
if command -v dash >/dev/null 2>&1; then
  SHELLS_TO_TEST="$SHELLS_TO_TEST dash"
fi
if command -v bash >/dev/null 2>&1; then
  SHELLS_TO_TEST="$SHELLS_TO_TEST bash"
fi

for SH in $SHELLS_TO_TEST; do
  echo "  Testing with shell: $SH"
  MOCK_INSTALL_DIR="$TEST_TMP/bin_$SH"
  mkdir -p "$MOCK_INSTALL_DIR"

  TEST_OUTPUT=$(
    PATH="$STUB_BIN:$PATH" \
    MOCK_ARCHIVE_FILE="$MOCK_ASSETS_DIR/$ARCHIVE_NAME" \
    MOCK_CHECKSUMS_FILE="$MOCK_ASSETS_DIR/checksums.txt" \
    A2UI_VERSION="$VERSION" \
    A2UI_INSTALL_DIR="$MOCK_INSTALL_DIR" \
    $SH "$INSTALLER" 2>&1
  )

  if [ ! -x "$MOCK_INSTALL_DIR/a2ui" ]; then
    echo "FAIL: a2ui was not installed to $MOCK_INSTALL_DIR with $SH"
    echo "$TEST_OUTPUT"
    exit 1
  fi

  MOCK_CLI_RUN=$("$MOCK_INSTALL_DIR/a2ui")
  if [[ "$MOCK_CLI_RUN" != *"a2ui mock CLI v0.9.9"* ]]; then
    echo "FAIL: unexpected binary execution output with $SH: $MOCK_CLI_RUN"
    exit 1
  fi

  if [[ "$TEST_OUTPUT" != *"SHA-256 checksum verified"* ]]; then
    echo "FAIL: Expected checksum verification message with $SH:"
    echo "$TEST_OUTPUT"
    exit 1
  fi
done
echo "✓ Test 2 passed"

# Test 3: Checksum mismatch halts installation
echo "Test 3: Checksum mismatch halts installation"
MOCK_INSTALL_DIR_3="$TEST_TMP/bin3"
mkdir -p "$MOCK_INSTALL_DIR_3"

echo "0000000000000000000000000000000000000000000000000000000000000000  $ARCHIVE_NAME" > "$MOCK_ASSETS_DIR/bad_checksums.txt"

MISMATCH_OUTPUT=$(
  PATH="$STUB_BIN:$PATH" \
  MOCK_ARCHIVE_FILE="$MOCK_ASSETS_DIR/$ARCHIVE_NAME" \
  MOCK_CHECKSUMS_FILE="$MOCK_ASSETS_DIR/bad_checksums.txt" \
  A2UI_VERSION="$VERSION" \
  A2UI_INSTALL_DIR="$MOCK_INSTALL_DIR_3" \
  /bin/sh "$INSTALLER" 2>&1 || true
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

# Test 4: Missing archive entry in checksums.txt halts installation
echo "Test 4: Missing archive entry in checksums.txt halts installation"
MOCK_INSTALL_DIR_4="$TEST_TMP/bin4"
mkdir -p "$MOCK_INSTALL_DIR_4"

echo "1111111111111111111111111111111111111111111111111111111111111111  some-other-file.tar.gz" > "$MOCK_ASSETS_DIR/missing_entry_checksums.txt"

MISSING_ENTRY_OUTPUT=$(
  PATH="$STUB_BIN:$PATH" \
  MOCK_ARCHIVE_FILE="$MOCK_ASSETS_DIR/$ARCHIVE_NAME" \
  MOCK_CHECKSUMS_FILE="$MOCK_ASSETS_DIR/missing_entry_checksums.txt" \
  A2UI_VERSION="$VERSION" \
  A2UI_INSTALL_DIR="$MOCK_INSTALL_DIR_4" \
  /bin/sh "$INSTALLER" 2>&1 || true
)

if [ -f "$MOCK_INSTALL_DIR_4/a2ui" ]; then
  echo "FAIL: Binary should not be installed when archive is missing from checksums.txt!"
  exit 1
fi

if [[ "$MISSING_ENTRY_OUTPUT" != *"not found in checksums.txt"* ]]; then
  echo "FAIL: Expected missing entry error, got:"
  echo "$MISSING_ENTRY_OUTPUT"
  exit 1
fi
echo "✓ Test 4 passed"

# Test 5: Missing checksums.txt halts installation unless A2UI_SKIP_CHECKSUM=1
echo "Test 5: Missing checksums.txt halts installation"
MOCK_INSTALL_DIR_5="$TEST_TMP/bin5"
mkdir -p "$MOCK_INSTALL_DIR_5"

MISSING_CHECKSUMS_OUTPUT=$(
  PATH="$STUB_BIN:$PATH" \
  MOCK_ARCHIVE_FILE="$MOCK_ASSETS_DIR/$ARCHIVE_NAME" \
  A2UI_VERSION="$VERSION" \
  A2UI_INSTALL_DIR="$MOCK_INSTALL_DIR_5" \
  /bin/sh "$INSTALLER" 2>&1 || true
)

if [ -f "$MOCK_INSTALL_DIR_5/a2ui" ]; then
  echo "FAIL: Binary should not be installed when checksums.txt download fails!"
  exit 1
fi

if [[ "$MISSING_CHECKSUMS_OUTPUT" != *"Failed to download checksums.txt"* ]]; then
  echo "FAIL: Expected failed download message, got:"
  echo "$MISSING_CHECKSUMS_OUTPUT"
  exit 1
fi
echo "✓ Test 5 passed"

# Test 6: A2UI_SKIP_CHECKSUM=1 bypasses missing checksums.txt
echo "Test 6: A2UI_SKIP_CHECKSUM=1 bypasses missing checksums.txt"
MOCK_INSTALL_DIR_6="$TEST_TMP/bin6"
mkdir -p "$MOCK_INSTALL_DIR_6"

SKIP_OUTPUT=$(
  PATH="$STUB_BIN:$PATH" \
  MOCK_ARCHIVE_FILE="$MOCK_ASSETS_DIR/$ARCHIVE_NAME" \
  A2UI_VERSION="$VERSION" \
  A2UI_INSTALL_DIR="$MOCK_INSTALL_DIR_6" \
  A2UI_SKIP_CHECKSUM=1 \
  /bin/sh "$INSTALLER" 2>&1
)

if [ ! -x "$MOCK_INSTALL_DIR_6/a2ui" ]; then
  echo "FAIL: Binary should be installed when A2UI_SKIP_CHECKSUM=1 is set!"
  echo "$SKIP_OUTPUT"
  exit 1
fi

if [[ "$SKIP_OUTPUT" != *"skipping checksum verification"* ]]; then
  echo "FAIL: Expected skip warning, got:"
  echo "$SKIP_OUTPUT"
  exit 1
fi
echo "✓ Test 6 passed"

echo "=== All A2UI CLI Installer tests passed successfully! ==="
