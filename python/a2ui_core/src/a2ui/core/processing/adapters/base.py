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

from collections.abc import Mapping, Sequence
import re
from abc import ABC, abstractmethod
from typing import Any
from pydantic import ValidationError
from ..operations import InternalOperation
from ...exceptions import (
    A2uiErrorDetail,
    A2uiValidationError,
)
from ...state.validation_helpers import validate_recursion_and_paths
from ...schema import AgentToRendererMessage, ProtocolVersion
from ...common.semver import (
    SemVer,
    normalize_version_string,
    to_canonical_version,
)


from ..execution_context import ExecutionContext

SUPPORTED_PROTOCOL_VERSIONS: frozenset[str] = frozenset({
    "0.8",
    "0.9",
    "0.9.1",
    "1.0",
})

DEFAULT_CATALOG_COMPATIBILITY: dict[str, frozenset[str]] = {
    "0.8": frozenset({"0.8"}),
    "0.9": frozenset({"0.9", "0.9.1"}),
    "0.9.1": frozenset({"0.9.1", "0.9"}),
    "1.0": frozenset({"1.0"}),
}


def is_catalog_version_compatible(
    catalog_version: str | bytes | SemVer | None,
    message_version: str | bytes | SemVer | None,
    compatibility_map: dict[str, frozenset[str]] | None = None,
) -> bool:
    """Evaluates whether a catalog protocol version is compatible with an incoming message or surface version.

    Compatibility is verified against explicit supported version sets.
    Minor formatting differences ('v1.0', '1.0', '1.0.0', 'v1_0') normalize to the same canonical version.

    Args:
        catalog_version: The catalog's declared protocol version.
        message_version: The incoming message or surface declared protocol version.
        compatibility_map: Optional explicit compatibility mapping. Defaults to DEFAULT_CATALOG_COMPATIBILITY.

    Returns:
        True if the catalog version is compatible with the message version, False otherwise.
    """
    if not catalog_version or not message_version:
        return False
    cat_canonical = to_canonical_version(catalog_version)
    msg_canonical = to_canonical_version(message_version)
    if cat_canonical and msg_canonical:
        if cat_canonical == msg_canonical:
            return True
        mapping = (
            compatibility_map
            if compatibility_map is not None
            else DEFAULT_CATALOG_COMPATIBILITY
        )
        compatible = mapping.get(msg_canonical)
        return bool(compatible and cat_canonical in compatible)

    # Fallback for non-semver custom identifiers (e.g. 'custom' vs 'Vcustom')
    norm_cat = normalize_version_string(catalog_version)
    norm_msg = normalize_version_string(message_version)
    return bool(norm_cat and norm_cat == norm_msg)


def _clean_loc_part(x: str) -> str:
    """Extracts base message class names from Pydantic validator wrapper strings."""
    if x.startswith("function-after[") or x.startswith("function-before["):
        match = re.search(r"([A-Za-z0-9_]+Message)\]", x)
        if match:
            return match.group(1)
    return x


class VersionAdapter(ABC):
    """Abstract base class for protocol version adapters."""

    @property
    @abstractmethod
    def version(self) -> ProtocolVersion:
        """The protocol version handled by this adapter (e.g. ProtocolVersion.V1_0)."""
        pass

    @property
    def supported_versions(self) -> set[str]:
        """Set of version string literals accepted by this adapter."""
        ver_str = (
            self.version.value if hasattr(self.version, "value") else str(self.version)
        )
        return {ver_str}

    @property
    def compatible_catalog_versions(self) -> frozenset[str]:
        """Set of canonical catalog protocol versions compatible with this adapter."""
        ver_str = (
            self.version.value if hasattr(self.version, "value") else str(self.version)
        )
        canonical = to_canonical_version(ver_str)
        return frozenset({canonical}) if canonical else frozenset()

    def is_catalog_compatible(
        self, catalog_version: str | bytes | SemVer | None
    ) -> bool:
        """Checks if a catalog protocol version is compatible with this adapter."""
        if not catalog_version:
            return False
        cat_canonical = to_canonical_version(catalog_version)
        if cat_canonical:
            return cat_canonical in self.compatible_catalog_versions
        norm_cat = normalize_version_string(catalog_version)
        ver_str = (
            self.version.value if hasattr(self.version, "value") else str(self.version)
        )
        norm_self = normalize_version_string(ver_str)
        return bool(norm_cat and norm_cat == norm_self)

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
    def raise_on_empty_actions(self) -> bool:
        """Whether to raise an error if no valid action keys are found."""
        return False

    @property
    @abstractmethod
    def schema(self) -> Any:
        """Returns the Pydantic wrapper model for envelope validation of this protocol version."""
        pass

    def prepare_payload_for_validation(self, msg_obj: dict[str, Any]) -> dict[str, Any]:
        """Normalizes the message object before running schema validation."""
        return msg_obj

    def _format_validation_errors(
        self, error: ValidationError, messages: list[dict[str, Any]]
    ) -> list[A2uiErrorDetail]:
        """Formats Pydantic validation errors while filtering out irrelevant union branches."""
        details = []
        branch_to_action = {}
        action_to_branch = {}
        for action in self.valid_actions:
            branch = action[0].upper() + action[1:] + "Message"
            branch_to_action[branch] = action
            action_to_branch[action] = branch

        all_branch_names = set(branch_to_action.keys())

        for err in error.errors():
            loc = err.get("loc", [])
            loc_parts = [_clean_loc_part(str(x)) for x in loc]
            if len(loc) >= 3 and loc[0] == "messages" and isinstance(loc[1], int):
                msg_idx = loc[1]
                if msg_idx < len(messages) and isinstance(messages[msg_idx], dict):
                    m = messages[msg_idx]
                    present_actions = [k for k in self.valid_actions if k in m]
                    if present_actions:
                        branch = loc_parts[2]
                        if branch in all_branch_names:
                            expected_branches = {
                                action_to_branch[act] for act in present_actions
                            }
                            if branch not in expected_branches:
                                continue

            clean_loc_parts = [x for x in loc_parts if x not in all_branch_names]
            path_str = ".".join(clean_loc_parts)
            msg = err.get("msg", "Validation failed")
            err_type = err.get("type", "")
            if err_type == "missing":
                code = "missing_field"
            elif err_type == "extra_forbidden":
                code = "extra_field"
            elif (
                err_type.endswith("_type")
                or err_type.endswith("_parsing")
                or "type" in err_type
            ):
                code = "type_mismatch"
            else:
                code = "invalid_value"
            details.append(A2uiErrorDetail(path_str, code, msg))
        return details

    def _extract_single_action(self, message: dict[str, Any]) -> str | None:
        """Validates presence of exactly one action key from valid_actions."""
        update_types = [k for k in self.valid_actions if k in message]
        if len(update_types) > 1:
            raise A2uiValidationError(
                f"Message contains multiple conflicting update actions: {update_types}"
            )
        if not update_types:
            if self.raise_on_empty_actions:
                raise A2uiValidationError(
                    "A2UI Protocol message must contain exactly one update action: "
                    f"{', '.join(sorted(self.valid_actions))}."
                )
            return None
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
        if not payload:
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
            if not action:
                return []

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
                        f"Invalid {self.version} message: messages.0.version: 'version'"
                        " is a required property"
                    )
                if raw_payload["version"] not in self.supported_versions:
                    expected = (
                        f"'{ver_str}'"
                        if len(self.supported_versions) == 1
                        else f"one of {sorted(self.supported_versions)}"
                    )
                    raise A2uiValidationError(
                        f"Invalid {self.version} message: messages.0.version: Input"
                        f" should be {expected}"
                    )

            prepared_msg = self.prepare_payload_for_validation(raw_payload)
            try:
                self.schema.model_validate({"messages": [prepared_msg]})
            except ValidationError as e:
                details = self._format_validation_errors(e, [raw_payload])
                summary = "; ".join(f"{d.path}: {d.message}" for d in details)
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
