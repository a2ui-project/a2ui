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

"""Base classes, interfaces, and protocol compatibility helpers for version adapters."""

from collections.abc import Mapping, Sequence
from abc import ABC, abstractmethod
from typing import Any
from pydantic import ValidationError
from ..operations import InternalOperation
from ..format_pydantic_error import format_validation_error_summary
from ...exceptions import A2uiValidationError
from ...state.validation_helpers import validate_recursion_and_paths
from ...schema import AgentToRendererMessage, ProtocolVersion
from ...common.semver import (
    SemVer,
    normalize_version_string,
    to_canonical_version,
    to_semver,
)


from ..execution_context import ExecutionContext

# Canonical protocol versions supported by the A2UI runtime.
SUPPORTED_PROTOCOL_VERSIONS: frozenset[str] = frozenset({
    "0.8",
    "0.9",
    "0.9.1",
    "1.0",
})

# Maps an incoming message or surface protocol version to the set of catalog
# protocol specification versions that it can accommodate.
DEFAULT_CATALOG_COMPATIBILITY: dict[str, frozenset[str]] = {
    "0.8": frozenset({"0.8"}),
    "0.9": frozenset({"0.9", "0.9.1"}),
    "0.9.1": frozenset({"0.9.1", "0.9"}),
    "1.0": frozenset({"1.0"}),
}


def is_catalog_version_compatible(
    catalog_version: ProtocolVersion | str | SemVer | None,
    message_version: ProtocolVersion | str | SemVer | None,
    compatibility_map: dict[str, frozenset[str]] | None = None,
) -> bool:
    """Evaluates catalog protocol compatibility against a message version.

    Compatibility is verified against explicit supported version sets.
    Minor formatting differences ('v1.0', '1.0', '1.0.0', 'v1_0') normalize
    to the same canonical version.

    Args:
        catalog_version: The catalog's declared protocol version.
        message_version: The incoming message or surface declared protocol version.
        compatibility_map: Optional explicit compatibility mapping. Defaults to DEFAULT_CATALOG_COMPATIBILITY.

    Returns:
        Whether the catalog version is compatible with the message version.
    """
    if not catalog_version or not message_version:
        return False
    catalog_canonical = to_canonical_version(catalog_version)
    message_canonical = to_canonical_version(message_version)
    if catalog_canonical and message_canonical:
        if catalog_canonical == message_canonical:
            return True
        mapping = (
            compatibility_map
            if compatibility_map is not None
            else DEFAULT_CATALOG_COMPATIBILITY
        )
        compatible = mapping.get(message_canonical)
        if compatible and catalog_canonical in compatible:
            return True

        # For SemVer >= 1.0.0, releases within the same major version are compatible,
        # ignoring pre-release identifiers.
        catalog_semver = to_semver(catalog_version)
        message_semver = to_semver(message_version)
        if (
            catalog_semver
            and message_semver
            and catalog_semver.major >= 1
            and catalog_semver.major == message_semver.major
        ):
            return True
        return False

    # Fallback for non-semver custom identifiers (e.g. 'custom' vs 'Vcustom')
    if not isinstance(catalog_version, str) or not isinstance(message_version, str):
        return False
    normalized_catalog = normalize_version_string(catalog_version)
    normalized_message = normalize_version_string(message_version)
    return bool(normalized_catalog and normalized_catalog == normalized_message)


class VersionAdapter(ABC):
    """Abstract base class for protocol version adapters."""

    @property
    @abstractmethod
    def version(self) -> ProtocolVersion:
        """The protocol version handled by this adapter (e.g. ProtocolVersion.V1_0)."""
        pass

    @property
    def valid_actions(self) -> set[str]:
        """Set of action keys supported by this version adapter."""
        return set()

    @property
    def compatible_catalog_versions(self) -> frozenset[str]:
        """Set of canonical catalog protocol versions compatible with this adapter."""
        ver_str = (
            self.version.value if hasattr(self.version, "value") else str(self.version)
        )
        canonical = to_canonical_version(ver_str)
        return frozenset({canonical}) if canonical else frozenset()

    def is_catalog_compatible(
        self, catalog_version: ProtocolVersion | str | SemVer | None
    ) -> bool:
        """Checks if a catalog protocol version is compatible with this adapter.

        Args:
            catalog_version: The catalog's declared protocol version.

        Returns:
            Whether the catalog version is compatible with this adapter.
        """
        if not catalog_version:
            return False
        return is_catalog_version_compatible(catalog_version, self.version)

    @abstractmethod
    def extract_operations(
        self,
        payload: (
            AgentToRendererMessage
            | Sequence[AgentToRendererMessage]
            | Mapping[str, Any]
            | Sequence[Mapping[str, Any]]
        ),
        context: ExecutionContext | None = None,
    ) -> list[InternalOperation]:
        """Converts a raw message payload or payload list into canonical internal operations."""
        pass


class BaseVersionAdapter(VersionAdapter, ABC):
    """Base class providing action validation and operation extraction logic."""

    @property
    @abstractmethod
    def valid_actions(self) -> set[str]:
        """The set of valid message action keys supported by this protocol version."""
        pass

    @property
    @abstractmethod
    def schema(self) -> Any:
        """Returns the Pydantic wrapper model for envelope validation of this protocol version."""
        pass

    def prepare_payload_for_validation(self, msg_obj: dict[str, Any]) -> dict[str, Any]:
        """Normalizes the message object before running schema validation."""
        return msg_obj

    def _extract_single_action(self, message: dict[str, Any]) -> str:
        """Validates presence of exactly one action key from valid_actions."""
        update_types = sorted([k for k in self.valid_actions if k in message])
        if len(update_types) > 1:
            raise A2uiValidationError(
                "Message contains multiple conflicting update actions:"
                f" {', '.join(update_types)}."
            )
        if not update_types:
            ver_str = (
                self.version.value
                if hasattr(self.version, "value")
                else str(self.version)
            )
            from .factory import VersionAdapterFactory

            all_known = VersionAdapterFactory.all_known_actions()
            other_actions = [k for k in message if k in all_known]
            if other_actions:
                raise A2uiValidationError(
                    f"Invalid {ver_str} message: action '{other_actions[0]}' is not"
                    f" supported in protocol version {ver_str}. Allowed actions:"
                    f" {', '.join(sorted(self.valid_actions))}."
                )
            raise A2uiValidationError(
                f"Invalid {ver_str} message: message must contain exactly one update"
                f" action: {', '.join(sorted(self.valid_actions))}."
            )
        action = update_types[0]
        if isinstance(message.get(action), dict):
            self._get_surface_id(message[action])
        return action

    def _get_surface_id(self, action_dict: dict[str, Any]) -> str:
        """Extracts surfaceId and validates that it is a string."""
        if "surfaceId" in action_dict:
            val = action_dict["surfaceId"]
            if not isinstance(val, str):
                raise A2uiValidationError("surfaceId must be a string")
            return val
        return ""

    def extract_operations(
        self,
        payload: (
            AgentToRendererMessage
            | Sequence[AgentToRendererMessage]
            | Mapping[str, Any]
            | Sequence[Mapping[str, Any]]
        ),
        context: ExecutionContext | None = None,
    ) -> list[InternalOperation]:
        """Unwraps payloads and delegates validated action messages to action handlers."""
        if payload is None:
            return []
        if isinstance(payload, list) and not payload:
            return []

        raw_payload: Any = payload
        validate_recursion_and_paths(raw_payload)

        if hasattr(raw_payload, "model_dump"):
            raw_payload = raw_payload.model_dump(by_alias=True, exclude_none=True)

        if isinstance(raw_payload, list):
            for item in raw_payload:
                if isinstance(item, dict):
                    self._extract_single_action(item)
            ops: list[InternalOperation] = []
            for item in raw_payload:
                ops.extend(self.extract_operations(item, context=context))
            return ops

        if isinstance(raw_payload, dict):
            if "messages" in raw_payload and isinstance(raw_payload["messages"], list):
                return self.extract_operations(
                    raw_payload["messages"],
                    context=context,
                )

            action = self._extract_single_action(raw_payload)

            if not isinstance(raw_payload[action], dict):
                raise A2uiValidationError(
                    f"Payload for action '{action}' must be an object"
                )

            ver_str = (
                self.version.value
                if hasattr(self.version, "value")
                else str(self.version)
            )
            if ver_str != "v0.8":
                if "version" not in raw_payload:
                    raise A2uiValidationError(
                        f"Invalid {self.version} message: version: 'version'"
                        " is a required property"
                    )
                raw_ver = raw_payload["version"]
                canonical_ver = (
                    to_canonical_version(raw_ver)
                    if isinstance(raw_ver, (str, ProtocolVersion, SemVer))
                    else None
                )
                if (
                    not canonical_ver
                    or canonical_ver not in self.compatible_catalog_versions
                ):
                    expected = (
                        f"'{ver_str}'"
                        if len(self.compatible_catalog_versions) == 1
                        else (
                            "one of"
                            f" {sorted(f'v{v}' for v in self.compatible_catalog_versions)}"
                        )
                    )
                    raise A2uiValidationError(
                        f"Invalid {self.version} message: version: Input"
                        f" should be {expected}"
                    )

            prepared_msg = self.prepare_payload_for_validation(raw_payload)
            try:
                self.schema.model_validate({"messages": [prepared_msg]})
            except ValidationError as e:
                summary = format_validation_error_summary(
                    e,
                    messages=[raw_payload],
                    valid_actions=self.valid_actions,
                    strip_messages_prefix=True,
                )
                raise A2uiValidationError(f"Invalid {self.version} message: {summary}")

            return self._extract_operations_for_action(
                action,
                raw_payload,
                context=context,
            )

        return []

    @abstractmethod
    def _extract_operations_for_action(
        self,
        action: str,
        message: dict[str, Any],
        context: ExecutionContext | None = None,
    ) -> list[InternalOperation]:
        """Subclasses override this to extract version-specific internal operations."""
        pass
