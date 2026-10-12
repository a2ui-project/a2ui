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

"""The published basic catalog documents that the basic catalogs implement.

Each version package ships a copy of its published catalog file as
`catalog.json`:

- `v0_8`: `specification/v0_8/json/standard_catalog_definition.json`
- `v0_9`: `specification/v0_9/catalogs/basic/catalog.json`
- `v1_0`: `catalogs/basic/v1/catalog.json`

`tests/test_basic_catalog_documents.py` checks that the copies match.
"""

from __future__ import annotations

from functools import cache
from importlib import resources
import json
from typing import Any


@cache
def _read_published_document(version_dir: str) -> str:
    return (
        resources.files(__package__ or "a2ui.core.basic_catalog")
        .joinpath(version_dir, "catalog.json")
        .read_text(encoding="utf-8")
    )


def published_document(version_dir: str) -> dict[str, Any]:
    """Returns a new copy of the published basic catalog document of a version.

    Args:
        version_dir: The version package, such as `v1_0`.
    """
    document: dict[str, Any] = json.loads(_read_published_document(version_dir))
    return document
