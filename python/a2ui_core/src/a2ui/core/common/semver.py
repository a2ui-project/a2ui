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

"""Semantic Versioning 2.0.0 parsing and comparison utilities."""

from dataclasses import dataclass
import re
from typing import Any, Optional, Sequence


@dataclass(frozen=True)
class SemVer:
    """Structured representation of a semantic version per SemVer 2.0.0.

    Attributes:
        major: Major version number indicating breaking API changes.
        minor: Minor version number indicating backwards-compatible features.
        patch: Patch version number indicating backwards-compatible bug fixes.
        prerelease: Sequence of dot-separated pre-release identifiers.
        build: Sequence of dot-separated build metadata identifiers.
    """

    major: int
    minor: int
    patch: int
    prerelease: tuple[str, ...] = ()
    build: tuple[str, ...] = ()


# Official SemVer 2.0.0 regular expression from https://semver.org/,
# extended with optional leading 'v'/'V' and optional patch component for protocol compatibility.
_SEMVER_PATTERN = re.compile(
    r"^[vV]?(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?"
    r"(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    r"(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$",
    re.ASCII,
)


def normalize_version_string(version: Any) -> str:
    """Normalizes a version string by stripping any leading 'v'/'V' and replacing underscores with dots in the core release segment.

    Preserves pre-release ('-') and build metadata ('+') suffixes intact.

    Args:
        version: The raw version string or bytes to normalize (e.g. 'v1_0', 'v0_9_1').

    Returns:
        The normalized version string, or an empty string if version is falsy or invalid.

    Examples:
        'v1_0' -> '1.0'
        'V1_0' -> '1.0'
        'v0_9_1' -> '0.9.1'
        '1_0_0-dev_release' -> '1.0.0-dev_release'
    """
    if isinstance(version, bytes):
        version = version.decode("utf-8", errors="replace")
    if not version or not isinstance(version, str):
        return ""
    text = version.strip()
    if text.startswith(("v", "V")):
        text = text[1:]
    delims = [i for i in (text.find("-"), text.find("+")) if i != -1]
    split_idx = min(delims) if delims else len(text)
    core = text[:split_idx].replace("_", ".")
    return f"{core}{text[split_idx:]}"


def parse_semver(version_str: Any) -> Optional[SemVer]:
    """Parses a semantic version string according to SemVer 2.0.0.

    Args:
        version_str: The version string to parse.

    Returns:
        A SemVer object if valid, or None if the string cannot be parsed.
    """
    if isinstance(version_str, bytes):
        version_str = version_str.decode("utf-8", errors="replace")
    if not version_str or not isinstance(version_str, str):
        return None
    text = version_str.strip()
    match = _SEMVER_PATTERN.match(text)
    if not match:
        return None
    major = int(match.group(1))
    minor = int(match.group(2))
    patch = int(match.group(3)) if match.group(3) is not None else 0
    prerelease = tuple(match.group(4).split(".")) if match.group(4) else ()
    build = tuple(match.group(5).split(".")) if match.group(5) else ()
    return SemVer(
        major=major,
        minor=minor,
        patch=patch,
        prerelease=prerelease,
        build=build,
    )


def _to_semver(v: str | bytes | SemVer | None) -> Optional[SemVer]:
    """Converts a version string or SemVer instance into a SemVer object."""
    if isinstance(v, SemVer):
        return v
    if v is None:
        return None
    return parse_semver(normalize_version_string(v))


def to_canonical_version(version: str | bytes | SemVer | None) -> str | None:
    """Formats a semantic version into a canonical string representation.

    For standard versions with zero patch and no pre-release or build metadata,
    returns f"{major}.{minor}" (e.g. '0.8', '0.9', '1.0').
    For versions with non-zero patch, pre-release identifiers, or build metadata,
    returns the full SemVer string (e.g. '0.9.1', '1.0.0-beta.1').

    Args:
        version: The version string, bytes, or SemVer object to canonicalize.

    Returns:
        The canonical version string, or None if the input cannot be parsed.
    """
    if not version:
        return None
    parsed = _to_semver(version)
    if not parsed:
        return None
    if parsed.patch == 0 and not parsed.prerelease and not parsed.build:
        return f"{parsed.major}.{parsed.minor}"
    pre = f"-{'.'.join(parsed.prerelease)}" if parsed.prerelease else ""
    bld = f"+{'.'.join(parsed.build)}" if parsed.build else ""
    return f"{parsed.major}.{parsed.minor}.{parsed.patch}{pre}{bld}"


def _compare_prerelease_id(id_a: str, id_b: str) -> int:
    """Compares two dot-separated pre-release identifiers per SemVer 2.0.0 Rule 11.4."""
    is_num_a = id_a.isascii() and id_a.isdigit()
    is_num_b = id_b.isascii() and id_b.isdigit()
    if is_num_a and is_num_b:
        return int(id_a) - int(id_b)
    if is_num_a:
        return -1  # Numeric identifiers have lower precedence than non-numeric
    if is_num_b:
        return 1
    if id_a < id_b:
        return -1
    if id_a > id_b:
        return 1
    return 0


def _compare_prerelease_lists(pre_a: Sequence[str], pre_b: Sequence[str]) -> int:
    """Compares pre-release identifier lists per SemVer 2.0.0 Rules 11.3 and 11.4."""
    if not pre_a and not pre_b:
        return 0
    if not pre_a:
        return 1  # Normal version has higher precedence than pre-release version
    if not pre_b:
        return -1

    for id_a, id_b in zip(pre_a, pre_b):
        diff = _compare_prerelease_id(id_a, id_b)
        if diff != 0:
            return diff

    return len(pre_a) - len(pre_b)


def compare_semver(
    a: str | bytes | SemVer | None,
    b: str | bytes | SemVer | None,
) -> int:
    """Compares two semantic version strings or SemVer objects per SemVer 2.0.0 precedence (Section 11).

    Args:
        a: First version string or SemVer object.
        b: Second version string or SemVer object.

    Returns:
        Negative integer if a < b, 0 if a == b, positive integer if a > b.
    """
    version_a = _to_semver(a)
    version_b = _to_semver(b)
    if not version_a and not version_b:
        return 0
    if not version_a:
        return -1
    if not version_b:
        return 1

    if version_a.major != version_b.major:
        return version_a.major - version_b.major
    if version_a.minor != version_b.minor:
        return version_a.minor - version_b.minor
    if version_a.patch != version_b.patch:
        return version_a.patch - version_b.patch

    return _compare_prerelease_lists(version_a.prerelease, version_b.prerelease)


def is_at_least_version(
    version: str | bytes | SemVer | None,
    min_version: str | bytes | SemVer,
) -> bool:
    """Checks if a given version string is at least the target minimum version.

    Args:
        version: The version string to check (e.g. 'v1.0', '1.1.0').
        min_version: The minimum version requirement (e.g. 'v1.0', '1.0.0').

    Returns:
        True if version is valid and >= min_version, False otherwise.
    """
    if not version:
        return False
    parsed = _to_semver(version)
    min_parsed = _to_semver(min_version)
    if not parsed or not min_parsed:
        return False
    return compare_semver(parsed, min_parsed) >= 0
