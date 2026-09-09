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

"""Unit tests for SemVer 2.0.0 parsing and comparison utilities."""

from a2ui.core.common.semver import (
    SemVer,
    compare_semver,
    is_at_least_version,
    normalize_version_string,
    parse_semver,
    to_canonical_version,
)


def test_parse_semver_basic():
    """Tests basic SemVer string parsing with and without leading 'v'/'V' and bytes."""
    assert parse_semver("v1.0") == SemVer(1, 0, 0, (), ())
    assert parse_semver("V1.0") == SemVer(1, 0, 0, (), ())
    assert parse_semver("1.0") == SemVer(1, 0, 0, (), ())
    assert parse_semver("v0.9.1") == SemVer(0, 9, 1, (), ())
    assert parse_semver("V0.9.1") == SemVer(0, 9, 1, (), ())
    assert parse_semver("v0.10.0") == SemVer(0, 10, 0, (), ())
    assert parse_semver("v1.10.2") == SemVer(1, 10, 2, (), ())
    assert parse_semver(b"v1.0") == SemVer(1, 0, 0, (), ())
    assert parse_semver(b"0.9.1") == SemVer(0, 9, 1, (), ())
    assert parse_semver("invalid") is None
    assert parse_semver(None) is None
    assert parse_semver("") is None


def test_normalize_version_string():
    """Tests version normalization with underscores, leading 'v'/'V', and bytes."""
    assert normalize_version_string("v1_0") == "1.0"
    assert normalize_version_string("V1_0") == "1.0"
    assert normalize_version_string("v0_9_1") == "0.9.1"
    assert normalize_version_string("V0_9_1") == "0.9.1"
    assert normalize_version_string("1_0_0-alpha.1") == "1.0.0-alpha.1"
    assert normalize_version_string("v1_0_0-alpha.1") == "1.0.0-alpha.1"
    assert normalize_version_string("V1_0_0-alpha.1") == "1.0.0-alpha.1"
    assert normalize_version_string("1_0_0-dev_release") == "1.0.0-dev_release"
    assert normalize_version_string("v1_0_0-dev_release") == "1.0.0-dev_release"
    assert normalize_version_string("1.0.0-dev_release") == "1.0.0-dev_release"
    assert normalize_version_string("v1_0+build_123") == "1.0+build_123"
    assert normalize_version_string("V1_0+build_123") == "1.0+build_123"
    assert normalize_version_string(b"v1_0") == "1.0"
    assert normalize_version_string(b"V0_9_1") == "0.9.1"
    assert normalize_version_string("") == ""
    assert normalize_version_string(None) == ""


def test_parse_semver_prerelease_and_build():
    """Tests parsing of pre-release and build metadata per SemVer 2.0.0."""
    assert parse_semver("1.0.0-alpha") == SemVer(1, 0, 0, ("alpha",), ())
    assert parse_semver("1.0.0-alpha.1") == SemVer(1, 0, 0, ("alpha", "1"), ())
    assert parse_semver("1.0.0-0.3.7") == SemVer(1, 0, 0, ("0", "3", "7"), ())
    assert parse_semver("1.0.0-x.7.z.92") == SemVer(1, 0, 0, ("x", "7", "z", "92"), ())
    assert parse_semver("1.0.0+20130313144700") == SemVer(
        1, 0, 0, (), ("20130313144700",)
    )
    assert parse_semver("1.0.0-beta+exp.sha.5114f85") == SemVer(
        1, 0, 0, ("beta",), ("exp", "sha", "5114f85")
    )


def test_reject_invalid_leading_zeros():
    """Tests rejection of versions with invalid leading zeros in numeric components."""
    # SemVer 2.0.0 Rule 2: MUST NOT contain leading zeroes
    assert parse_semver("01.0.0") is None
    assert parse_semver("1.01.0") is None
    assert parse_semver("1.0.01") is None
    # SemVer 2.0.0 Rule 9: Numeric pre-release identifiers MUST NOT include leading zeroes
    assert parse_semver("1.0.0-01") is None
    assert parse_semver("1.0.0-alpha.01") is None
    # Single zero is allowed
    assert parse_semver("1.0.0-alpha.0") is not None
    # Trailing hyphens or pluses without identifiers are invalid
    assert parse_semver("1.0.0-") is None
    assert parse_semver("1.0.0+") is None
    assert parse_semver("1.0.0-alpha..1") is None


def test_compare_semver_multi_digit():
    """Tests comparing multi-digit minor versions per SemVer rules."""
    assert compare_semver("v0.10.0", "v0.9.1") > 0
    assert compare_semver("v0.9.1", "v0.10.0") < 0
    assert compare_semver("v1.10.0", "v1.2.0") > 0
    assert compare_semver("v1.2.0", "v1.10.0") < 0
    assert compare_semver("v1.0", "1.0.0") == 0
    assert compare_semver("v0.9", "0.9") == 0


def test_prerelease_precedence_chain():
    """Tests pre-release precedence chain per SemVer 2.0.0 Section 11."""
    # Rule 11.3: normal version has higher precedence than pre-release version
    assert compare_semver("1.0.0-alpha", "1.0.0") < 0
    assert compare_semver("1.0.0", "1.0.0-alpha") > 0

    # Rule 11.4 canonical chain from semver.org:
    # 1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-alpha.beta < 1.0.0-beta < 1.0.0-beta.2 < 1.0.0-beta.11 < 1.0.0-rc.1 < 1.0.0
    chain = [
        "1.0.0-alpha",
        "1.0.0-alpha.1",
        "1.0.0-alpha.beta",
        "1.0.0-beta",
        "1.0.0-beta.2",
        "1.0.0-beta.11",
        "1.0.0-rc.1",
        "1.0.0",
    ]
    for i in range(len(chain) - 1):
        assert (
            compare_semver(chain[i], chain[i + 1]) < 0
        ), f"Expected {chain[i]} < {chain[i + 1]}"
        assert (
            compare_semver(chain[i + 1], chain[i]) > 0
        ), f"Expected {chain[i + 1]} > {chain[i]}"

    # Rule 11.4.3: Numeric identifiers always have lower precedence than non-numeric identifiers
    assert compare_semver("1.0.0-1", "1.0.0-alpha") < 0
    assert compare_semver("1.0.0-alpha", "1.0.0-1") > 0

    # Numeric pre-release compared numerically (2 < 11, not lexical "11" < "2")
    assert compare_semver("1.0.0-2", "1.0.0-11") < 0

    # Numeric pre-release compared safely with large numbers
    assert compare_semver("1.0.0-9007199254740991", "1.0.0-9007199254740992") < 0
    assert compare_semver("1.0.0-9007199254740992", "1.0.0-9007199254740991") > 0
    assert (
        compare_semver("1.0.0-100000000000000000000", "1.0.0-9999999999999999999") > 0
    )


def test_ignore_build_metadata():
    """Tests that build metadata is ignored during SemVer comparisons."""
    assert compare_semver("1.0.0+20130313144700", "1.0.0") == 0
    assert compare_semver("1.0.0-beta+exp.sha.5114f85", "1.0.0-beta") == 0
    assert compare_semver("1.0.0+build.1", "1.0.0+build.2") == 0


def test_is_at_least_version():
    """Tests is_at_least_version for various releases and pre-releases."""
    assert is_at_least_version("v1.0", "1.0") is True
    assert is_at_least_version("1.0", "1.0") is True
    assert is_at_least_version("v1.0.0", "1.0") is True
    assert is_at_least_version("v1.1", "1.0") is True
    assert is_at_least_version("v2.0.0", "1.0") is True
    assert is_at_least_version("v0.9.1", "1.0") is False
    assert is_at_least_version("v0.9", "1.0") is False
    assert is_at_least_version("v0.8", "1.0") is False
    assert is_at_least_version(None, "1.0") is False
    assert is_at_least_version("", "1.0") is False
    assert is_at_least_version("invalid", "1.0") is False

    # Pre-release version is lower than target release
    assert is_at_least_version("1.0.0-alpha", "1.0.0") is False
    assert is_at_least_version("1.0.0", "1.0.0-alpha") is True


def test_to_canonical_version():
    """Tests canonical string formatting for semantic versions."""
    assert to_canonical_version("v1.0") == "1.0"
    assert to_canonical_version("1.0") == "1.0"
    assert to_canonical_version("V1.0") == "1.0"
    assert to_canonical_version("1.0.0") == "1.0"
    assert to_canonical_version("v1.0.0") == "1.0"
    assert to_canonical_version("v1_0") == "1.0"
    assert to_canonical_version("V1_0") == "1.0"
    assert to_canonical_version("v0.9.1") == "0.9.1"
    assert to_canonical_version("0.9.1") == "0.9.1"
    assert to_canonical_version("v0_9_1") == "0.9.1"
    assert to_canonical_version("v0.9") == "0.9"
    assert to_canonical_version("0.9") == "0.9"
    assert to_canonical_version("v0_9") == "0.9"
    assert to_canonical_version("v0.8") == "0.8"
    assert to_canonical_version("0.8.0") == "0.8"
    assert to_canonical_version("1.0.0-beta.1") == "1.0.0-beta.1"
    assert to_canonical_version("1.0.0+build.1") == "1.0.0+build.1"
    assert to_canonical_version(b"v1.0") == "1.0"
    assert to_canonical_version("invalid") is None
    assert to_canonical_version("") is None
    assert to_canonical_version(None) is None


def test_semver_objects():
    """Tests comparing, evaluating, and canonicalizing SemVer dataclass instances directly."""
    assert compare_semver(SemVer(1, 0, 0), "1.0.0") == 0
    assert compare_semver(SemVer(1, 1, 0), "1.0.0") > 0
    assert compare_semver("1.0.0", SemVer(1, 0, 0)) == 0
    assert to_canonical_version(SemVer(1, 0, 0)) == "1.0"
    assert to_canonical_version(SemVer(0, 9, 1)) == "0.9.1"
    assert is_at_least_version(SemVer(1, 0, 0), "1.0") is True
    assert is_at_least_version(SemVer(0, 9, 0), "1.0") is False
