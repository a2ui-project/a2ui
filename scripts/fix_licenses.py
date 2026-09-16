#!/usr/bin/env python3
# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Fixes and validates copyright notices and Apache 2.0 license headers.

This script ensures that all source files in the repository contain proper
Apache 2.0 license headers, copyright year 2024 for Google LLC, and HTTPS
links for Apache license URLs. It handles edge cases such as generated files,
empty files, shebang preservation, line ending normalization, and custom ignore patterns.
"""

import argparse
import fnmatch
import os
import re
import shutil
import subprocess
import sys
from typing import List, Optional

# Configuration: Relative glob patterns for files and directories ignored
# during license header scanning and processing.
IGNORE_PATTERNS = [
    "LICENSE",
    ".yarn/**",
    "**/pnpm-lock.yaml",
    "**/package-lock.json",
    "**/yarn.lock",
    "**/pubspec.lock",
    "**/uv.lock",
    "**/.venv/**",
    "**/node_modules/**",
    "**/build/**",
    "**/.dart_tool/**",
    "**/generated/**",
    "**/third_party/**",
    "eval/bin/transcrypt",
    "eval/datasets/*.yaml",
]


def should_ignore(rel_path: str) -> bool:
    """Determines if a given relative file path should be ignored.

    Args:
        rel_path: Relative path of the file from repository root.

    Returns:
        True if the file matches any pattern in IGNORE_PATTERNS, False otherwise.
    """
    normalized_path = rel_path.replace(os.sep, "/")
    for pattern in IGNORE_PATTERNS:
        clean_pat = pattern.lstrip("/")
        if fnmatch.fnmatch(normalized_path, clean_pat):
            return True
        if clean_pat.startswith("**/"):
            base_pat = clean_pat[3:]
            if fnmatch.fnmatch(normalized_path, base_pat):
                return True
            if "/" not in base_pat and fnmatch.fnmatch(
                os.path.basename(normalized_path), base_pat
            ):
                return True
        elif "/" not in clean_pat and fnmatch.fnmatch(
            os.path.basename(normalized_path), clean_pat
        ):
            return True
    return False


def is_generated_file(content: str) -> bool:
    """Checks if a file contains a generated code header in its first 10 lines.

    Args:
        content: The text content of the file.

    Returns:
        True if the file contains markers indicating it was generated, False otherwise.
    """
    lines = content.splitlines()[:10]
    pattern = re.compile(r"generated.*(file|code)|auto-generated", re.IGNORECASE)
    return any(pattern.search(line) for line in lines)


def strip_incorrect_headers(content: str) -> str:
    """Strips non-compliant license headers (headers with Copyright that lack Apache License).

    Removing non-Apache headers allows addlicense to insert standard Apache 2.0 headers.

    Args:
        content: The text content of the file.

    Returns:
        The content with incorrect license headers removed.
    """
    # 1. Match C-style block comment at top of file: /* ... */
    c_block = re.match(r"^\s*/\*.*?\*/\s*\n?", content, re.DOTALL)
    if c_block:
        header_text = c_block.group(0)
        if "copyright" in header_text.lower():
            if (
                "apache license" not in header_text.lower()
                and "apache.org/licenses" not in header_text.lower()
            ):
                return content[c_block.end() :]

    # 2. Match line comment block at top of file: # or //
    line_block = re.match(
        r"^(?:\s*(?:#|//).*?\n)*"
        r"\s*(?:#|//)\s*Copyright\s+(?:\(c\)|©|\u00a9)?\s*(?:\d{4}|\d{4}-\d{4}).*?\n"
        r"(?:\s*(?:#|//).*?\n)*\s*",
        content,
        re.IGNORECASE,
    )
    if line_block:
        header_text = line_block.group(0)
        if (
            "apache license" not in header_text.lower()
            and "apache.org/licenses" not in header_text.lower()
        ):
            return content[line_block.end() :]

    return content


def find_addlicense() -> Optional[str]:
    """Locates the addlicense executable binary.

    Checks PATH first, then falls back to the user's Go bin directory
    ($GOPATH/bin or ~/go/bin).

    Returns:
        The path to the addlicense binary if found, or None.
    """
    which_path = shutil.which("addlicense")
    if which_path:
        return which_path
    gopath = os.environ.get("GOPATH", os.path.expanduser("~/go"))
    candidate = os.path.join(gopath, "bin", "addlicense")
    if os.access(candidate, os.X_OK):
        return candidate
    return None


def ensure_addlicense() -> str:
    """Ensures that the addlicense tool is installed and available.

    Attempts to locate addlicense. If missing, attempts to run `go install`
    to automatically install it. Exits the process if installation fails or
    Go is unavailable.

    Returns:
        The path or name of the verified addlicense binary.
    """
    bin_path = find_addlicense()
    if bin_path:
        return bin_path

    go_bin = shutil.which("go")
    if go_bin:
        print(
            "`addlicense` not found. Installing via `go install"
            " github.com/google/addlicense@v1.1.1`..."
        )
        res = subprocess.run([go_bin, "install", "github.com/google/addlicense@v1.1.1"])
        if res.returncode == 0:
            gopath = os.environ.get("GOPATH", os.path.expanduser("~/go"))
            gobin_path = os.path.join(gopath, "bin")
            if gobin_path not in os.environ.get("PATH", ""):
                os.environ["PATH"] = f"{gobin_path}:{os.environ.get('PATH', '')}"
            bin_path = find_addlicense()
            if bin_path:
                return bin_path

    print(
        "Error: `addlicense` not found and could not be installed"
        " automatically via `go`.",
        file=sys.stderr,
    )
    print(
        "Please install Go (https://go.dev) or install addlicense manually:",
        file=sys.stderr,
    )
    print("  go install github.com/google/addlicense@v1.1.1", file=sys.stderr)
    sys.exit(1)


def run_addlicense(addlicense_bin: str, check_mode: bool, repo_root: str) -> bool:
    """Runs the addlicense Go tool across the repository.

    Args:
        addlicense_bin: Path to the addlicense binary.
        check_mode: Whether to run in check-only mode (-check).
        repo_root: Absolute path to the repository root directory.

    Returns:
        True if addlicense completed successfully (or found no missing headers
        in check mode), False otherwise.
    """
    cmd = [addlicense_bin]
    if check_mode:
        cmd.append("-check")
    cmd.extend(["-l", "apache", "-c", "Google LLC", "-y", "2024"])
    for pat in IGNORE_PATTERNS:
        if pat != "LICENSE":
            cmd.extend(["-ignore", pat])
    cmd.append(".")

    res = subprocess.run(cmd, cwd=repo_root)
    return res.returncode == 0


def get_tracked_files(repo_root: str) -> List[str]:
    """Retrieves all git-tracked files in the repository.

    Args:
        repo_root: Absolute path to the repository root directory.

    Returns:
        A list of absolute file paths tracked by git.
    """
    res = subprocess.run(
        ["git", "ls-files"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=True,
    )
    return [os.path.join(repo_root, f) for f in res.stdout.splitlines()]


def process_files(repo_root: str, check_mode: bool) -> List[str]:
    """Scans and fixes or checks copyright years and Apache URL schemes.

    addlicense only adds missing headers to un-headared files; it skips
    files with existing headers. This function inspects existing headers
    to standardize Google LLC copyright years to 2024, strip non-compliant
    headers so addlicense can insert Apache headers, and convert HTTP Apache
    license links to HTTPS. Handles edge cases like empty files, generated files,
    multi-year ranges, and CRLF line endings.

    Args:
        repo_root: Absolute path to the repository root directory.
        check_mode: Whether to return errors without modifying files.

    Returns:
        A list of error message strings found in check mode (empty if compliant).
    """
    files = get_tracked_files(repo_root)
    errors = []

    # Pattern matching any Google LLC copyright notice where the year(s) is not strictly 2024
    google_year_pattern = re.compile(
        r"Copyright\s+(?!\b2024\s+Google LLC\b)(?:[\d\s,-]+)\s+Google LLC"
    )
    # Pattern matching HTTP Apache license URLs
    http_apache_pattern = re.compile(r"http:" + r"//www.apache.org/licenses")
    # Pattern matching top-of-file copyright headers
    comment_block_pattern = re.compile(
        r"^(?:\s*(?:#|//|/\*|\*|\*/).*?\n)*"
        r"\s*(?:#|//|/\*|\*)\s*Copyright\s+(?:\(c\)|©|\u00a9)?\s*(?:\d{4}|\d{4}-\d{4}).*?\n"
        r"(?:\s*(?:#|//|/\*|\*|\*/).*?\n)*\s*",
        re.IGNORECASE,
    )

    for filepath in files:
        rel_path = os.path.relpath(filepath, repo_root)
        if should_ignore(rel_path):
            continue

        try:
            with open(filepath, "r", encoding="utf-8") as f:
                original_content = f.read()
        except Exception:
            continue

        content = original_content

        # Skip empty files or auto-generated code
        if not content.strip() or is_generated_file(content):
            continue

        # Strip any non-Apache headers in fix mode
        if not check_mode:
            content = strip_incorrect_headers(content)

        # Normalize Windows CRLF line endings
        normalized_content = content.replace("\r\n", "\n")

        if check_mode:
            c_block = re.match(r"^\s*/\*.*?\*/\s*\n?", normalized_content, re.DOTALL)
            if c_block:
                hdr = c_block.group(0)
                hdr_lower = hdr.lower()
                if "copyright" in hdr_lower:
                    if (
                        "apache license" not in hdr_lower
                        and "apache.org/licenses" not in hdr_lower
                    ):
                        errors.append(f"Non-Apache license header found in: {rel_path}")
                    if hdr.lstrip().startswith("/**"):
                        errors.append(
                            f"Javadoc-style (/**) copyright header found in: {rel_path}"
                        )
            else:
                line_block = re.match(
                    r"^(?:\s*(?:#|//).*?\n)*"
                    r"\s*(?:#|//)\s*Copyright\s+(?:\(c\)|©|\u00a9)?\s*(?:\d{4}|\d{4}-\d{4}).*?\n"
                    r"(?:\s*(?:#|//).*?\n)*\s*",
                    normalized_content,
                    re.IGNORECASE,
                )
                if line_block:
                    hdr = line_block.group(0).lower()
                    if "apache license" not in hdr and "apache.org/licenses" not in hdr:
                        errors.append(f"Non-Apache license header found in: {rel_path}")

            if google_year_pattern.search(normalized_content):
                errors.append(f"Non-2024 Google copyright year found in: {rel_path}")
            if http_apache_pattern.search(normalized_content):
                errors.append(f"HTTP Apache license URL found in: {rel_path}")
        else:
            new_content = re.sub(
                r"Copyright\s+(?:[\d\s,-]+)\s+Google LLC",
                "Copyright 2024 Google LLC",
                normalized_content,
            )
            new_content = http_apache_pattern.sub(
                "https://www.apache.org/licenses", new_content
            )
            c_block = re.match(r"^\s*/\*.*?\*/\s*\n?", new_content, re.DOTALL)
            if c_block and "copyright" in c_block.group(0).lower():
                if c_block.group(0).lstrip().startswith("/**"):
                    new_content = re.sub(
                        r"^(\s*)/\*[*]+", r"\1/*", new_content, count=1
                    )

            # Write back if content modified or line endings normalized
            if new_content != original_content:
                with open(filepath, "w", encoding="utf-8") as f:
                    f.write(new_content)

    # Handle root LICENSE file separately
    license_path = os.path.join(repo_root, "LICENSE")
    if os.path.exists(license_path):
        with open(license_path, "r", encoding="utf-8") as f:
            lic_content = f.read()
        if check_mode:
            if ("http:" + "//www.apache.org/licenses") in lic_content:
                errors.append("HTTP Apache URL found in root LICENSE")
        else:
            new_lic = lic_content.replace(
                "http:" + "//www.apache.org/licenses",
                "https://www.apache.org/licenses",
            )
            if new_lic != lic_content:
                with open(license_path, "w", encoding="utf-8") as f:
                    f.write(new_lic)

    return errors


def main(argv: Optional[List[str]] = None) -> None:
    """Main CLI entrypoint for license checking and fixing.

    Args:
        argv: Optional list of command-line arguments (defaults to sys.argv[1:]).
    """
    parser = argparse.ArgumentParser(
        description="Fix or check copyright notices and license headers."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check license headers without modifying files",
    )
    args = parser.parse_args(argv)

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    addlicense_bin = ensure_addlicense()

    if args.check:
        print("Running addlicense check...")
        addlicense_ok = run_addlicense(
            addlicense_bin, check_mode=True, repo_root=repo_root
        )
        print("Checking copyright years and HTTPS URLs...")
        errors = process_files(repo_root, check_mode=True)

        if not addlicense_ok or errors:
            print("\nLicense checks failed:", file=sys.stderr)
            for err in errors:
                print(f" - {err}", file=sys.stderr)
            sys.exit(1)
        print("All license and copyright checks passed successfully!")
    else:
        print("Pre-processing files to remove incorrect headers...")
        process_files(repo_root, check_mode=False)
        print("Adding missing Apache 2.0 license headers...")
        run_addlicense(addlicense_bin, check_mode=False, repo_root=repo_root)
        print("Updating copyright notices and HTTPS links...")
        process_files(repo_root, check_mode=False)
        print("License and copyright fixes applied successfully.")


if __name__ == "__main__":
    main()
