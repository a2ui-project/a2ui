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

"""Static factory resolving version adapters by protocol version or payload inspection."""

from typing import Any, Dict, Union
from a2ui.core.schema.constants import A2uiProtocolVersion
from .base import VersionAdapter
from .v0_9 import VersionAdapterV09
from .v1_0 import VersionAdapterV10


class VersionAdapterFactory:
    """Factory resolving appropriate VersionAdapter instance for given protocol versions or payloads."""

    _v09_adapter = VersionAdapterV09()
    _v10_adapter = VersionAdapterV10()

    @classmethod
    def get_adapter(cls, version: Union[str, A2uiProtocolVersion]) -> VersionAdapter:
        """Resolves a VersionAdapter for the specified protocol version.

        Args:
            version: Protocol version string or enum value.

        Returns:
            Resolved VersionAdapter instance.

        Raises:
            ValueError: If version string is unsupported.
        """
        ver_str = (
            version.value if isinstance(version, A2uiProtocolVersion) else str(version)
        )

        if ver_str in (
            A2uiProtocolVersion.V0_8.value,
            A2uiProtocolVersion.V0_9.value,
            A2uiProtocolVersion.V0_9_1.value,
        ):
            return cls._v09_adapter
        elif ver_str == A2uiProtocolVersion.V1_0.value:
            return cls._v10_adapter
        else:
            raise ValueError(f"Unsupported protocol version: '{ver_str}'")

    @classmethod
    def resolve_from_payload(cls, payload: Dict[str, Any]) -> VersionAdapter:
        """Resolves a VersionAdapter by inspecting the version field of a payload dictionary.

        Args:
            payload: Message envelope or payload dictionary.

        Returns:
            Resolved VersionAdapter instance.
        """
        version = payload.get("version", A2uiProtocolVersion.V0_9.value)
        try:
            return cls.get_adapter(version)
        except ValueError:
            return cls._v09_adapter
