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

from . import constants as constants
from .catalog import CatalogConfig, load_examples
from .catalog_provider import (
    A2uiCatalogProvider,
    FileSystemCatalogProvider,
    InMemoryCatalogProvider,
)
from .common_modifiers import remove_strict_validation
from .constants import (
    A2UI_CLIENT_CAPABILITIES_KEY,
    A2UI_CLOSE_TAG,
    A2UI_OPEN_TAG,
    CATALOG_COMPONENTS_KEY,
    CATALOG_ID_KEY,
    VERSION_0_8,
    VERSION_0_9,
    VERSION_0_9_1,
    VERSION_1_0,
)

__all__ = [
    "A2UI_CLIENT_CAPABILITIES_KEY",
    "A2UI_CLOSE_TAG",
    "A2UI_OPEN_TAG",
    "A2uiCatalogProvider",
    "CATALOG_COMPONENTS_KEY",
    "CATALOG_ID_KEY",
    "CatalogConfig",
    "FileSystemCatalogProvider",
    "InMemoryCatalogProvider",
    "VERSION_0_8",
    "VERSION_0_9",
    "VERSION_0_9_1",
    "VERSION_1_0",
    "constants",
    "load_examples",
    "remove_strict_validation",
]
