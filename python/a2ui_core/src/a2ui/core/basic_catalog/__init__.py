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

"""A2UI Basic Catalog Module."""

from __future__ import annotations

from typing import Any

from a2ui.core.catalog import CatalogApi
from a2ui.core.common import to_protocol_version
from a2ui.core.exceptions import A2uiError
from a2ui.core.schema import ProtocolVersion

from . import v0_8, v0_9, v1_0


def BasicCatalog(
    protocol_version: ProtocolVersion | str,
    locale: str | None = None,
) -> CatalogApi:
    """Returns the basic catalog instance for the specified protocol version.

    Args:
        protocol_version: The protocol version (e.g. ProtocolVersion.V0_9,
            ProtocolVersion.V1_0, 'v0.9', '0.9', '1.0').
        locale: Optional locale string for function implementations.

    Returns:
        The versioned BasicCatalog instance.

    Raises:
        A2uiError: If the protocol version is not supported.
    """
    try:
        p_ver = to_protocol_version(protocol_version)
    except (ValueError, A2uiError) as e:
        raise A2uiError(
            f"Unsupported protocol version for BasicCatalog: '{protocol_version}'."
        ) from e

    if p_ver == ProtocolVersion.V0_8:
        return v0_8.BasicCatalog(locale=locale)
    if p_ver in (ProtocolVersion.V0_9, ProtocolVersion.V0_9_1):
        return v0_9.BasicCatalog(locale=locale)
    if p_ver == ProtocolVersion.V1_0:
        return v1_0.BasicCatalog(locale=locale)
    raise A2uiError(
        f"Unsupported protocol version for BasicCatalog: '{protocol_version}'."
    )


__all__ = [
    "BasicCatalog",
    "v0_8",
    "v0_9",
    "v1_0",
]
