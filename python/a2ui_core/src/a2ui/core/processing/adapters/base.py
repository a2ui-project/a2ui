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

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Set
from ..operations import InternalOperation
from ...exceptions import A2uiValidationError
from ...schema import ProtocolVersion, AgentToRendererMessagePayload


class VersionAdapter(ABC):
    """Abstract base class for protocol version adapters."""

    @property
    @abstractmethod
    def version(self) -> ProtocolVersion:
        """The protocol version handled by this adapter (e.g. ProtocolVersion.V1_0)."""
        pass

    @abstractmethod
    def extract_operations(
        self, payload: AgentToRendererMessagePayload
    ) -> List[InternalOperation]:
        """Converts a raw message payload or payload list into canonical internal operations."""
        pass


class BaseVersionAdapter(VersionAdapter, ABC):
    """Base class providing action validation and operation extraction logic."""

    @property
    @abstractmethod
    def valid_actions(self) -> Set[str]:
        """The set of valid message action keys supported by this protocol version."""
        pass

    @property
    def raise_on_empty_actions(self) -> bool:
        """Whether to raise an error if no valid action keys are found."""
        return False

    def _extract_single_action(self, message: Dict[str, Any]) -> Optional[str]:
        """Validates presence of exactly one action key from valid_actions."""
        update_types = [k for k in self.valid_actions if k in message]
        if len(update_types) > 1:
            raise A2uiValidationError(
                "Message contains multiple conflicting update actions and Message"
                f" contains multiple update types: {update_types}"
            )
        if not update_types:
            if self.raise_on_empty_actions:
                raise A2uiValidationError(
                    "A2UI Protocol message must contain exactly one update action: "
                    f"{', '.join(sorted(self.valid_actions))}."
                )
            return None
        return update_types[0]

    def _get_surface_id(self, action_dict: Dict[str, Any]) -> str:
        """Extracts surfaceId and validates that it is a string."""
        if "surfaceId" in action_dict:
            val = action_dict["surfaceId"]
            if not isinstance(val, str):
                raise A2uiValidationError("surfaceId must be a string")
            return val
        return ""

    def extract_operations(
        self, payload: AgentToRendererMessagePayload
    ) -> List[InternalOperation]:
        """Unwraps payloads and delegates validated action messages to action handlers."""
        if not payload:
            return []

        if hasattr(payload, "model_dump"):
            payload = payload.model_dump(by_alias=True, exclude_none=True)

        if isinstance(payload, list):
            ops: List[InternalOperation] = []
            for item in payload:
                ops.extend(self.extract_operations(item))
            return ops

        if isinstance(payload, dict):
            if "messages" in payload and isinstance(payload["messages"], list):
                return self.extract_operations(payload["messages"])

            action = self._extract_single_action(payload)
            if not action:
                return []

            return self._extract_operations_for_action(action, payload)

        return []

    @abstractmethod
    def _extract_operations_for_action(
        self, action: str, message: Dict[str, Any]
    ) -> List[InternalOperation]:
        """Extracts internal operations for a validated message action."""
        pass
