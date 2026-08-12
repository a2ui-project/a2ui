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

"""Abstract base class for A2UI protocol version adapters."""

from abc import ABC, abstractmethod
from typing import Any, Dict
from a2ui.core.schema.constants import A2uiProtocolVersion


class VersionAdapter(ABC):
    """Abstract base class defining the contract for version-specific payload adapters."""

    @property
    @abstractmethod
    def version(self) -> A2uiProtocolVersion:
        """Returns the protocol version supported by this adapter."""

    @abstractmethod
    def extract_surface_properties(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Extracts surface theme or properties dictionary from createSurface payload.

        Args:
            payload: CreateSurface message envelope or payload dictionary.

        Returns:
            Extracted surface properties dictionary.
        """

    @abstractmethod
    def extract_initial_state(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Extracts initial data model dictionary from createSurface payload.

        Args:
            payload: CreateSurface message envelope or payload dictionary.

        Returns:
            Extracted initial data model dictionary.
        """

    @abstractmethod
    def extract_message_type(self, payload: Dict[str, Any]) -> str:
        """Extracts message type discriminator key from message envelope.

        Args:
            payload: Message envelope dictionary.

        Returns:
            Discriminator key string (e.g. 'createSurface').
        """

    @abstractmethod
    def normalize_message(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Normalizes version-specific payload into standard dictionary format.

        Args:
            payload: Message envelope or payload dictionary.

        Returns:
            Normalized dictionary payload.
        """
