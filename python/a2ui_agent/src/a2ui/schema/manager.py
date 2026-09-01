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

"""Deprecated compatibility redirect for A2uiSchemaManager."""

from collections.abc import Sequence
import warnings
from typing import Any, Callable
from a2ui.inference_formats.direct_json.format import DirectJsonFormat
from a2ui.schema.catalog import CatalogConfig

warnings.warn(
    "a2ui.schema.manager is deprecated and will be removed. "
    "Import from a2ui.inference_formats.direct_json instead.",
    DeprecationWarning,
    stacklevel=2,
)


class A2uiSchemaManager(DirectJsonFormat):
    """Deprecated compatibility wrapper around DirectJsonFormat."""

    def __init__(
        self,
        version: str,
        catalogs: Sequence[CatalogConfig] | None = None,
        accepts_inline_catalogs: bool = False,
        schema_modifiers: (
            Sequence[Callable[[dict[str, Any]], dict[str, Any]]] | None
        ) = None,
        experiments: set[str] | frozenset[str] | None = None,
    ):
        warnings.warn(
            "A2uiSchemaManager is deprecated. Please use DirectJsonFormat instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        super().__init__(
            version=version,
            catalogs=catalogs,
            accepts_inline_catalogs=accepts_inline_catalogs,
            schema_modifiers=schema_modifiers,
            experiments=experiments,
        )
