# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Internal helpers shared by the inference formats.

This package is not public API. The message converters are published through
`a2ui.inference_formats`; everything else here backs the format
implementations and may change without notice.
"""

from a2ui.parser import (
    normalize_prompt_example_messages,
    to_message_dicts,
    to_message_models,
)
from .catalogs import (
    build_catalog_helpers,
    catalogs_defining,
    catalogs_protocol_version,
    check_catalogs,
    check_mixed_catalogs,
    surface_catalog_id,
)
from .coalesce import CoalescedMessage, coalesce_surface_messages
from .schema_helper import CatalogSchemaHelper

__all__ = [
    "CatalogSchemaHelper",
    "CoalescedMessage",
    "build_catalog_helpers",
    "catalogs_defining",
    "catalogs_protocol_version",
    "check_catalogs",
    "check_mixed_catalogs",
    "coalesce_surface_messages",
    "normalize_prompt_example_messages",
    "surface_catalog_id",
    "to_message_dicts",
    "to_message_models",
]
