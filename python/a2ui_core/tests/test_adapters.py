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

import pytest

from a2ui.core.common.semver import SemVer
from a2ui.core.exceptions import A2uiValidationError
from a2ui.core.processing.operations import (
    InternalCreateSurfaceOp,
    InternalDeleteSurfaceOp,
    InternalOperation,
    InternalUpdateComponentsOp,
    InternalUpdateDataModelOp,
)
from a2ui.core.schema import ProtocolVersion
from a2ui.core.processing.adapters import (
    DEFAULT_CATALOG_COMPATIBILITY,
    DEFAULT_PROTOCOL_VERSION,
    SUPPORTED_PROTOCOL_VERSIONS,
    V0Point8Adapter,
    V0Point9Adapter,
    V1Point0Adapter,
    VersionAdapter,
    VersionAdapterFactory,
    is_catalog_version_compatible,
)


@pytest.fixture(autouse=True)
def reset_adapter_factory():
    """Isolates tests by restoring VersionAdapterFactory._adapters after each test."""
    orig_adapters = dict(VersionAdapterFactory._adapters)
    yield
    VersionAdapterFactory._adapters = orig_adapters


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

    # v0.8 matches
    assert is_catalog_version_compatible("v0.8", "v0.8") is True
    assert is_catalog_version_compatible("0.8", "v0.8") is True
    assert is_catalog_version_compatible("v0.8", "0.8.0") is True
    assert is_catalog_version_compatible("v0.8", "v0.9") is False

    # ProtocolVersion enum, SemVer object, and bytes inputs
    assert is_catalog_version_compatible(ProtocolVersion.V1_0, "1.0") is True
    assert (
        is_catalog_version_compatible(ProtocolVersion.V0_9, ProtocolVersion.V0_9_1)
        is True
    )
    assert is_catalog_version_compatible(SemVer(1, 0, 0), "1.0") is True
    assert is_catalog_version_compatible("1.0", SemVer(1, 0, 0)) is True
    assert is_catalog_version_compatible(SemVer(0, 9, 0), SemVer(0, 9, 1)) is True
    assert is_catalog_version_compatible(b"v1.0", "v1.0") is True
    assert is_catalog_version_compatible("v1.0", b"1.0") is True

    # Patch version compatibility for SemVer >= 1.0.0
    assert is_catalog_version_compatible("v1.0.1", "v1.0") is True
    assert is_catalog_version_compatible("v1.0", "v1.0.1") is True
    assert is_catalog_version_compatible("1.0.2", "1.0.1") is True
    assert is_catalog_version_compatible("v1.0.1-alpha", "v1.0") is False
    assert is_catalog_version_compatible("v1.1.0", "v1.0.0") is False

    # Falsy / invalid inputs
    assert is_catalog_version_compatible(None, "v1.0") is False
    assert is_catalog_version_compatible("v1.0", None) is False
    assert is_catalog_version_compatible(None, None) is False
    assert is_catalog_version_compatible("", "") is False
    assert is_catalog_version_compatible("", "v1.0") is False
    assert is_catalog_version_compatible("v1.0", "") is False
    assert is_catalog_version_compatible(None, "None") is False
    assert is_catalog_version_compatible("None", None) is False
    assert is_catalog_version_compatible({}, {}) is False
    assert is_catalog_version_compatible([], []) is False


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


def test_resolve_v1_0_and_extract_operations():
    """Verifies resolving v1.0 adapter and extracting operations with initial state and surface properties."""
    payload = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "s1",
            "catalogId": "basic",
            "sendDataModel": True,
            "components": [{"id": "root", "component": "Column"}],
            "dataModel": {
                "key": "value",
            },
        },
    }
    adapter = VersionAdapterFactory.resolve_from_payload(payload)
    assert adapter.version == ProtocolVersion.V1_0

    ops = adapter.extract_operations(payload)
    assert len(ops) == 3
    op = ops[0]
    assert isinstance(op, InternalCreateSurfaceOp)
    assert op.surface_id == "s1"
    assert op.theme is None
    assert op.send_data_model is True

    comp_op = ops[1]
    assert isinstance(comp_op, InternalUpdateComponentsOp)
    assert comp_op.surface_id == "s1"
    assert comp_op.components == [{"id": "root", "component": "Column"}]

    dm_op = ops[2]
    assert isinstance(dm_op, InternalUpdateDataModelOp)
    assert dm_op.surface_id == "s1"
    assert dm_op.path == "/"
    assert dm_op.value == {"key": "value"}


def test_resolve_v0_9_and_extract_create_surface():
    """Verifies resolving v0.9 adapter and extracting createSurface operations."""
    payload = {
        "version": "v0.9",
        "createSurface": {
            "surfaceId": "s1",
            "catalogId": "basic",
            "theme": {"primaryColor": "#FF0000"},
        },
    }
    adapter = VersionAdapterFactory.resolve_from_payload(payload)
    assert adapter.version == ProtocolVersion.V0_9

    ops = adapter.extract_operations(payload)
    assert len(ops) == 1
    op = ops[0]
    assert isinstance(op, InternalCreateSurfaceOp)
    assert op.surface_id == "s1"
    assert op.theme == {"primaryColor": "#FF0000"}


def test_resolve_v0_8_and_normalize_begin_rendering():
    """Verifies resolving v0.8 adapter and normalizing beginRendering into createSurface operation."""
    payload = {
        "version": "v0.8",
        "beginRendering": {
            "surfaceId": "s1",
            "root": "root",
            "styles": {"primaryColor": "#FF0000"},
        },
    }
    adapter = VersionAdapterFactory.resolve_from_payload(payload)
    assert adapter.version == ProtocolVersion.V0_8

    ops = adapter.extract_operations(payload)
    assert len(ops) == 1
    op = ops[0]
    assert isinstance(op, InternalCreateSurfaceOp)
    assert op.surface_id == "s1"
    assert op.theme == {"primaryColor": "#FF0000"}


def test_resolve_unversioned_v0_8_delete_surface():
    """Verifies resolving unversioned deleteSurface to v0.8 adapter."""
    payload = {
        "deleteSurface": {
            "surfaceId": "s1",
        },
    }
    adapter = VersionAdapterFactory.resolve_from_payload(payload)
    assert adapter.version == ProtocolVersion.V0_8

    ops = adapter.extract_operations(payload)
    assert len(ops) == 1
    op = ops[0]
    assert isinstance(op, InternalDeleteSurfaceOp)
    assert op.surface_id == "s1"


def test_extract_v0_8_surface_update_and_data_model_update():
    """Verifies extracting surfaceUpdate and dataModelUpdate operations in v0.8 adapter."""
    adapter = VersionAdapterFactory.get_adapter("v0.8")

    surface_ops = adapter.extract_operations({
        "surfaceUpdate": {
            "surfaceId": "s1",
            "components": [{
                "id": "txt1",
                "component": {"Text": {"text": {"literalString": "Click"}}},
            }],
        }
    })
    assert len(surface_ops) == 1
    assert isinstance(surface_ops[0], InternalUpdateComponentsOp)
    assert surface_ops[0].surface_id == "s1"

    data_ops = adapter.extract_operations({
        "dataModelUpdate": {
            "surfaceId": "s1",
            "path": "/count",
            "contents": [{"key": "count", "valueNumber": 42}],
        }
    })
    assert len(data_ops) == 1
    assert isinstance(data_ops[0], InternalUpdateDataModelOp)
    assert data_ops[0].surface_id == "s1"


def test_extract_operations_no_update_action_raises_validation_error():
    """Verifies that extract_operations raises A2uiValidationError when payload contains no update action."""
    v08_adapter = VersionAdapterFactory.get_adapter("v0.8")
    v09_adapter = VersionAdapterFactory.get_adapter("v0.9")

    with pytest.raises(A2uiValidationError, match=r"Invalid v0\.8 message"):
        v08_adapter.extract_operations({})
    with pytest.raises(A2uiValidationError, match=r"Invalid v0\.9 message"):
        v09_adapter.extract_operations({})


def test_extract_operations_invalid_version_raises_validation_error():
    """Verifies that extract_operations validates version against compatible_catalog_versions."""
    v09_adapter = VersionAdapterFactory.get_adapter("v0.9")
    with pytest.raises(
        A2uiValidationError,
        match=r"messages\.0\.version: Input should be one of \['v0\.9', 'v0\.9\.1'\]",
    ):
        v09_adapter.extract_operations({
            "version": "v1.0",
            "createSurface": {"surfaceId": "s1", "catalogId": "c1"},
        })

    v10_adapter = VersionAdapterFactory.get_adapter("v1.0")
    with pytest.raises(
        A2uiValidationError,
        match=r"messages\.0\.version: Input should be 'v1\.0'",
    ):
        v10_adapter.extract_operations({
            "version": "v0.9",
            "createSurface": {"surfaceId": "s1", "catalogId": "c1"},
        })


def test_supports_dynamic_registration():
    """Verifies dynamic registration of custom version adapters."""

    class CustomAdapter(VersionAdapter):

        @property
        def version(self) -> str:
            return "v2.0"

        def extract_operations(
            self,
            payload,
            context=None,
        ) -> list[InternalOperation]:
            return [
                InternalCreateSurfaceOp(
                    surface_id="s_custom",
                    catalog_id="custom",
                )
            ]

    VersionAdapterFactory.register_adapter(CustomAdapter())
    resolved = VersionAdapterFactory.get_adapter("v2.0")
    assert resolved.version == "v2.0"
    # Verify format-tolerant retrieval of dynamically registered adapters
    assert VersionAdapterFactory.get_adapter("2.0").version == "v2.0"
    assert VersionAdapterFactory.get_adapter("2.0.0").version == "v2.0"
    assert VersionAdapterFactory.get_adapter("v2.0.0").version == "v2.0"
    assert VersionAdapterFactory.get_adapter("V2.0").version == "v2.0"

    ops = resolved.extract_operations({})
    assert len(ops) == 1
    assert isinstance(ops[0], InternalCreateSurfaceOp)
    assert ops[0].surface_id == "s_custom"


def test_unrecognized_or_missing_version_strings():
    """Verifies that unrecognized or missing version strings raise A2uiValidationError."""
    with pytest.raises(
        A2uiValidationError,
        match=(
            r"Unsupported protocol version 'v99\.0'\. Supported versions: v0\.8, v0\.9,"
            r" v0\.9\.1, v1\.0\."
        ),
    ):
        VersionAdapterFactory.get_adapter("v99.0")

    with pytest.raises(A2uiValidationError, match=r"missing a valid 'version' string"):
        VersionAdapterFactory.resolve_from_payload({})


def test_resolves_v0_9_1_version_string_to_v0_9_adapter():
    """Verifies resolving v0.9.1 version string to v0.9 adapter."""
    adapter = VersionAdapterFactory.get_adapter("v0.9.1")
    assert adapter.version == ProtocolVersion.V0_9

    from_payload = VersionAdapterFactory.resolve_from_payload(
        {"version": "v0.9.1", "createSurface": {"surfaceId": "s1"}}
    )
    assert from_payload.version == ProtocolVersion.V0_9


def test_batch_payloads():
    """Verifies resolving adapter and extracting operations from batch array payloads."""
    payload = [
        {"version": "v1.0", "createSurface": {"surfaceId": "s1", "catalogId": "basic"}},
        {"version": "v1.0", "deleteSurface": {"surfaceId": "s1"}},
    ]
    adapter = VersionAdapterFactory.resolve_from_payload(payload)
    assert adapter.version == ProtocolVersion.V1_0

    ops = adapter.extract_operations(payload)
    assert len(ops) == 2
    assert isinstance(ops[0], InternalCreateSurfaceOp)
    assert isinstance(ops[1], InternalDeleteSurfaceOp)


def test_wrapped_messages_payload():
    """Verifies resolving adapter and extracting operations from wrapped { messages: [...] } payload."""
    payload = {
        "messages": [
            {"version": "v1.0", "createSurface": {"surfaceId": "s1"}},
            {
                "version": "v1.0",
                "updateComponents": {
                    "surfaceId": "s1",
                    "components": [{"id": "root", "component": "Column"}],
                },
            },
        ]
    }
    adapter = VersionAdapterFactory.resolve_from_payload(payload)
    assert adapter.version == ProtocolVersion.V1_0

    ops = adapter.extract_operations(payload)
    assert len(ops) == 2
    assert isinstance(ops[0], InternalCreateSurfaceOp)
    assert isinstance(ops[1], InternalUpdateComponentsOp)


def test_extract_operations_v1_0_actions():
    """Verifies extracting updateComponents, updateDataModel, and deleteSurface operations."""
    adapter = VersionAdapterFactory.get_adapter("v1.0")

    uc_ops = adapter.extract_operations({
        "version": "v1.0",
        "updateComponents": {
            "surfaceId": "s1",
            "components": [{"id": "c1", "component": "Text", "text": "Hi"}],
        },
    })
    assert len(uc_ops) == 1
    assert isinstance(uc_ops[0], InternalUpdateComponentsOp)
    assert uc_ops[0].surface_id == "s1"
    assert uc_ops[0].components == [{"id": "c1", "component": "Text", "text": "Hi"}]

    ud_ops = adapter.extract_operations({
        "version": "v1.0",
        "updateDataModel": {
            "surfaceId": "s1",
            "path": "/user/name",
            "value": "Alice",
        },
    })
    assert len(ud_ops) == 1
    assert isinstance(ud_ops[0], InternalUpdateDataModelOp)
    assert ud_ops[0].surface_id == "s1"
    assert ud_ops[0].path == "/user/name"
    assert ud_ops[0].value == "Alice"

    ds_ops = adapter.extract_operations({
        "version": "v1.0",
        "deleteSurface": {
            "surfaceId": "s1",
        },
    })
    assert len(ds_ops) == 1
    assert isinstance(ds_ops[0], InternalDeleteSurfaceOp)
    assert ds_ops[0].surface_id == "s1"


def test_resolve_from_payload_invalid_inputs():
    """Verifies that null, primitive, or non-object payloads in resolve_from_payload raise A2uiValidationError."""
    invalid_payloads = [None, 42, "v1.0", [], {"version": 123}, {"version": None}]
    for invalid in invalid_payloads:
        with pytest.raises(
            A2uiValidationError, match=r"missing a valid 'version' string"
        ):
            VersionAdapterFactory.resolve_from_payload(invalid)


def test_extract_operations_non_object():
    """Verifies returning empty list when extract_operations is called with non-object/None values."""
    adapter = VersionAdapterFactory.get_adapter("v1.0")
    assert adapter.extract_operations(None) == []
    assert adapter.extract_operations("not-an-object") == []
    assert adapter.extract_operations(123) == []


def test_version_adapter_factory_get_adapter_formatting_variants():
    """Verifies resolving adapters by canonical and formatted version strings."""
    assert VersionAdapterFactory.get_adapter("v1.0").version == ProtocolVersion.V1_0
    assert VersionAdapterFactory.get_adapter("1.0").version == ProtocolVersion.V1_0
    assert VersionAdapterFactory.get_adapter("1.0.0").version == ProtocolVersion.V1_0
    assert VersionAdapterFactory.get_adapter("v1_0").version == ProtocolVersion.V1_0
    assert VersionAdapterFactory.get_adapter("V1.0").version == ProtocolVersion.V1_0
    assert VersionAdapterFactory.get_adapter("v0.9.1").version == ProtocolVersion.V0_9
    assert VersionAdapterFactory.get_adapter("0.9.1").version == ProtocolVersion.V0_9
    assert VersionAdapterFactory.get_adapter("v0.9").version == ProtocolVersion.V0_9
    assert VersionAdapterFactory.get_adapter("0.9").version == ProtocolVersion.V0_9
    assert VersionAdapterFactory.get_adapter("v0.8").version == ProtocolVersion.V0_8
    assert VersionAdapterFactory.get_adapter("0.8").version == ProtocolVersion.V0_8

    with pytest.raises(A2uiValidationError, match="Unsupported protocol version"):
        VersionAdapterFactory.get_adapter("v1.1")


def test_version_adapter_factory_all_known_actions():
    """Verifies that all_known_actions returns an aggregated set of valid actions across registered adapters."""
    actions = VersionAdapterFactory.all_known_actions()
    assert isinstance(actions, frozenset)
    # v0.8 actions
    assert "beginRendering" in actions
    assert "surfaceUpdate" in actions
    assert "dataModelUpdate" in actions
    # v0.9 actions
    assert "createSurface" in actions
    assert "updateComponents" in actions
    assert "updateDataModel" in actions
    assert "deleteSurface" in actions


def test_extract_operations_cross_version_action_rejection():
    """Verifies that sending a cross-version action actively raises A2uiValidationError."""
    v09_adapter = VersionAdapterFactory.get_adapter("v0.9")
    with pytest.raises(
        A2uiValidationError,
        match=r"action 'beginRendering' is not supported in protocol version v0.9",
    ):
        v09_adapter.extract_operations({
            "version": "v0.9",
            "beginRendering": {"surfaceId": "s1"},
        })

    v10_adapter = VersionAdapterFactory.get_adapter("v1.0")
    with pytest.raises(
        A2uiValidationError,
        match=r"action 'beginRendering' is not supported in protocol version v1.0",
    ):
        v10_adapter.extract_operations({
            "version": "v1.0",
            "beginRendering": {"surfaceId": "s1"},
        })

    v08_adapter = VersionAdapterFactory.get_adapter("v0.8")
    with pytest.raises(
        A2uiValidationError,
        match=r"action 'createSurface' is not supported in protocol version v0.8",
    ):
        v08_adapter.extract_operations({
            "createSurface": {"surfaceId": "s1"},
        })

    # Completely unknown action (not in any known adapter)
    with pytest.raises(
        A2uiValidationError,
        match=r"message must contain exactly one update action",
    ):
        v09_adapter.extract_operations({
            "version": "v0.9",
            "completelyUnknownAction": {"surfaceId": "s1"},
        })
