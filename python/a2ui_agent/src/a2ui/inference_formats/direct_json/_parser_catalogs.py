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
from a2ui.core.common import to_protocol_version


def check_parser_catalogs(catalogs: Sequence[CatalogApi]) -> tuple[CatalogApi, ...]:
    """Returns the catalogs as a tuple after checking that a parser can hold them.

    Args:
        catalogs: The catalogs that the parser resolves components against.

    Raises:
        A2uiCatalogError: If no catalog is given, or the catalogs target
            different protocol versions.
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
    return tuple(catalogs)
