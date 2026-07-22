# Copyright 2026 Google LLC
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

import warnings
from typing import Any, Optional, Callable, Union
from a2ui.inference_formats.transport.format import TransportFormat
from a2ui.schema.catalog import CatalogConfig

warnings.warn(
    "a2ui.schema.manager is deprecated and will be removed. "
    "Import from a2ui.inference_formats.transport instead.",
    DeprecationWarning,
    stacklevel=2,
)


class A2uiSchemaManager(TransportFormat):
    """Deprecated compatibility wrapper around TransportFormat."""

    def __init__(
        self,
        version: str,
        catalogs: Optional[list[CatalogConfig]] = None,
        accepts_inline_catalogs: bool = False,
        schema_modifiers: Optional[
            list[Callable[[dict[str, Any]], dict[str, Any]]]
        ] = None,
        experiments: Optional[Union[set[str], frozenset[str]]] = None,
    ):
        warnings.warn(
            "A2uiSchemaManager is deprecated. Please use TransportFormat instead.",
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
