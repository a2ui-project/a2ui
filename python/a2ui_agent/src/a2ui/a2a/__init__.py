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

"""A2UI A2A (Agent-to-Agent) protocol extension and part utilities."""

from .extension import (
    A2UI_EXTENSION_BASE_URI,
    AGENT_EXTENSION_ACCEPTS_INLINE_CATALOGS_KEY,
    AGENT_EXTENSION_SUPPORTED_CATALOG_IDS_KEY,
    get_a2ui_agent_extension,
    get_a2ui_extension_uri,
    get_a2ui_extension_uri_version,
    try_activate_a2ui_extension,
)
from .parts import (
    A2UI_MIME_TYPE,
    DEPRECATED_A2UI_MIME_TYPE,
    create_a2ui_part,
    get_a2ui_datapart,
    is_a2ui_part,
    parse_content_to_parts,
    parse_response_to_parts,
    stream_response_to_parts,
)

__all__ = [
    "A2UI_EXTENSION_BASE_URI",
    "A2UI_MIME_TYPE",
    "AGENT_EXTENSION_ACCEPTS_INLINE_CATALOGS_KEY",
    "AGENT_EXTENSION_SUPPORTED_CATALOG_IDS_KEY",
    "DEPRECATED_A2UI_MIME_TYPE",
    "create_a2ui_part",
    "get_a2ui_agent_extension",
    "get_a2ui_datapart",
    "get_a2ui_extension_uri",
    "get_a2ui_extension_uri_version",
    "is_a2ui_part",
    "parse_content_to_parts",
    "parse_response_to_parts",
    "stream_response_to_parts",
    "try_activate_a2ui_extension",
]
