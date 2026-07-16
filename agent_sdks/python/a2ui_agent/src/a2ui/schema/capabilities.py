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

"""Client UI Capabilities structures."""

from typing import Any, List, Optional, TypedDict


class ClientUiCapabilities(TypedDict, total=False):
    """Structured representation of client UI capabilities.

    Attributes:
        supportedCatalogIds: A list of catalog identifiers supported by the
            client, used for layout rendering.
        inlineCatalogs: A list of embedded A2UI catalogs containing component
            schemas defined inline.
    """

    supportedCatalogIds: Optional[List[str]]
    inlineCatalogs: Optional[List[dict[str, Any]]]
