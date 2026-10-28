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

"""Public facade for the A2UI processor and catalog management package."""

from __future__ import annotations

from .catalog_config import CatalogConfig
from .catalog_providers import (
    CatalogProvider,
    FileSystemCatalogProvider,
    InMemoryCatalogProvider,
)
from .generator import A2uiGenerator
from .processor import A2uiRequestProcessor

__all__ = [
    "A2uiGenerator",
    "A2uiRequestProcessor",
    "CatalogConfig",
    "CatalogProvider",
    "FileSystemCatalogProvider",
    "InMemoryCatalogProvider",
]
