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

"""Checks for the catalogs that the Direct JSON parsers hold."""

from collections.abc import Sequence

from a2ui.core import A2uiCatalogError, CatalogApi
from a2ui.core.common import is_at_least_version, to_protocol_version
from a2ui.core.schema import ProtocolVersion


def supports_multiple_catalogs(protocol_version: ProtocolVersion | str) -> bool:
    """Returns whether a Direct JSON parser may hold several catalogs.

    Multiple catalogs are supported in protocol version 1.0 and later, where a
    session can create surfaces on different catalogs and components can name
    their own `catalogId`. Earlier versions support a single catalog per
    parser.
    """
    return is_at_least_version(
        to_protocol_version(protocol_version), ProtocolVersion.V1_0
    )


def check_parser_catalogs(catalogs: Sequence[CatalogApi]) -> tuple[CatalogApi, ...]:
    """Returns the catalogs as a tuple after checking that a parser can hold them.

    Args:
        catalogs: The catalogs that the parser resolves components against.

    Raises:
        A2uiCatalogError: If no catalog is given, the catalogs target different
            protocol versions, or several catalogs are given for a protocol
            version before v1.0.
    """
    if isinstance(catalogs, (str, bytes)) or not isinstance(catalogs, Sequence):
        raise A2uiCatalogError(
            "The Direct JSON parsers take a sequence of catalogs, got"
            f" {type(catalogs).__name__}."
        )
    if not catalogs:
        raise A2uiCatalogError("At least one catalog must be provided.")
    if len(catalogs) == 1:
        return tuple(catalogs)
    versions = {to_protocol_version(c.protocol_version) for c in catalogs}
    if len(versions) > 1:
        raise A2uiCatalogError(
            "The catalogs target incompatible protocol versions:"
            f" {sorted(v.value for v in versions)}."
        )
    (version,) = versions
    if not supports_multiple_catalogs(version):
        raise A2uiCatalogError(
            f"Only a single catalog is supported for protocol version {version.value}."
            " Multiple catalogs are supported in v1.0 and later."
        )
    return tuple(catalogs)
