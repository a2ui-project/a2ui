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

"""Unit tests for VersionAdapter, VersionAdapterFactory, and catalog compatibility."""

from a2ui.core.processing.adapters import (
    DEFAULT_CATALOG_COMPATIBILITY,
    DEFAULT_PROTOCOL_VERSION,
    SUPPORTED_PROTOCOL_VERSIONS,
    V0Point8Adapter,
    V0Point9Adapter,
    V1Point0Adapter,
    VersionAdapterFactory,
    is_catalog_version_compatible,
)


def test_supported_protocol_versions():
    """Verifies membership of canonical protocol versions in SUPPORTED_PROTOCOL_VERSIONS."""
    assert "1.0" in SUPPORTED_PROTOCOL_VERSIONS
    assert "0.9.1" in SUPPORTED_PROTOCOL_VERSIONS
    assert "0.9" in SUPPORTED_PROTOCOL_VERSIONS
    assert "0.8" in SUPPORTED_PROTOCOL_VERSIONS
    assert "1.1" not in SUPPORTED_PROTOCOL_VERSIONS
    assert "0.9" in DEFAULT_CATALOG_COMPATIBILITY.get("0.9.1", frozenset())


def test_is_catalog_version_compatible():
    """Tests catalog version compatibility for equal, backward-compatible, and formatting variants."""
    # Exact canonical matches across formatting variations
    assert is_catalog_version_compatible("v1.0", "v1.0") is True
    assert is_catalog_version_compatible("V1.0", "v1.0") is True
    assert is_catalog_version_compatible("v1.0", "V1.0") is True
    assert is_catalog_version_compatible("1.0", "v1.0") is True
    assert is_catalog_version_compatible("v1.0.0", "1.0") is True
    assert is_catalog_version_compatible("v1_0", "1.0.0") is True
    assert is_catalog_version_compatible("v0.9", "v0.9") is True
    assert is_catalog_version_compatible("V0.9", "0.9") is True
    assert is_catalog_version_compatible("0.9", "V0.9") is True
    assert is_catalog_version_compatible("v0_9", "0.9") is True
    assert is_catalog_version_compatible("v0.9.1", "0.9.1") is True
    assert is_catalog_version_compatible("v0_9_1", "0.9.1") is True

    # Backward compatibility between 0.9 and 0.9.1
    assert is_catalog_version_compatible("v0.9", "v0.9.1") is True
    assert is_catalog_version_compatible("v0.9.1", "v0.9") is True

    # Unsupported future or cross-major versions are rejected
    assert is_catalog_version_compatible("v1.0", "v1.1") is False
    assert is_catalog_version_compatible("v1.1", "v1.0") is False
    assert is_catalog_version_compatible("v1.0", "v2.0") is False
    assert is_catalog_version_compatible("v0.9", "v1.0") is False
    assert is_catalog_version_compatible("v1.0", "v0.9") is False

    # Custom compatibility map override
    custom_map = {
        "1.1": frozenset({"1.0", "1.1"}),
    }
    assert is_catalog_version_compatible("v1.0", "v1.1", custom_map) is True
    assert is_catalog_version_compatible("v0.9", "v1.1", custom_map) is False

    # Custom non-semver fallback
    assert is_catalog_version_compatible("Vcustom", "vcustom") is True
    assert is_catalog_version_compatible("custom", "Vcustom") is True
    assert is_catalog_version_compatible("custom", "other") is False

    # Falsy / invalid inputs
    assert is_catalog_version_compatible(None, "v1.0") is False
    assert is_catalog_version_compatible("v1.0", None) is False
    assert is_catalog_version_compatible(None, None) is False
    assert is_catalog_version_compatible("", "") is False
    assert is_catalog_version_compatible(None, "None") is False
    assert is_catalog_version_compatible("None", None) is False


def test_adapter_catalog_compatibility_methods():
    """Tests compatible_catalog_versions and is_catalog_compatible on adapter instances."""
    v08 = V0Point8Adapter()
    assert v08.compatible_catalog_versions == frozenset({"0.8"})
    assert v08.is_catalog_compatible("v0.8") is True
    assert v08.is_catalog_compatible("0.8") is True
    assert v08.is_catalog_compatible("v0.9") is False

    v09 = V0Point9Adapter()
    assert v09.compatible_catalog_versions == frozenset({"0.9", "0.9.1"})
    assert v09.is_catalog_compatible("v0.9") is True
    assert v09.is_catalog_compatible("v0.9.1") is True
    assert v09.is_catalog_compatible("0.9") is True
    assert v09.is_catalog_compatible("0.9.1") is True
    assert v09.is_catalog_compatible("v1.0") is False

    v10 = V1Point0Adapter()
    assert v10.compatible_catalog_versions == frozenset({"1.0"})
    assert v10.is_catalog_compatible("v1.0") is True
    assert v10.is_catalog_compatible("1.0.0") is True
    assert v10.is_catalog_compatible("v1_0") is True
    assert v10.is_catalog_compatible("v0.9") is False
    assert v10.is_catalog_compatible("v1.1") is False
    assert v10.is_catalog_compatible(None) is False


def test_version_adapter_factory_get_adapter():
    """Verifies that VersionAdapterFactory resolves adapters and checks compatibility."""
    adapter = VersionAdapterFactory.get_adapter("v1.0")
    assert adapter.version.value == "v1.0"
    assert adapter.is_catalog_compatible("1.0") is True

    adapter_09 = VersionAdapterFactory.get_adapter("v0.9.1")
    assert adapter_09.is_catalog_compatible("0.9") is True
    assert adapter_09.is_catalog_compatible("0.9.1") is True

    assert DEFAULT_PROTOCOL_VERSION.value == "v0.9"
