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

"""Hatch build hook that bundles the decision format's catalog assets in wheels.

The decision grammar and the Basic catalog's patterns are authored under the
repository's `catalogs/` directory. The sdist copies them into the package with
`force-include`, but a wheel built from that sdist has no `catalogs/` to read,
and Hatch fails on a missing `force-include` source. This hook adds the files
only when they exist, so a wheel built from a checkout and a wheel built from
the sdist both carry them.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import (  # type: ignore[import-not-found]
    BuildHookInterface,
)

_DECISION_ASSETS = "a2ui/inference_formats/decision/assets"
_REPO_ASSETS = {
    "../../catalogs/decision/v1/archetypes.json": f"{_DECISION_ASSETS}/archetypes.json",
    "../../catalogs/decision/v1/archetype_definition.json": (
        f"{_DECISION_ASSETS}/archetype_definition.json"
    ),
    "../../catalogs/decision/v1/pattern_definition.json": (
        f"{_DECISION_ASSETS}/pattern_definition.json"
    ),
    "../../catalogs/basic/v1/patterns.json": (
        f"{_DECISION_ASSETS}/patterns/basic_v1_0.json"
    ),
}


class DecisionAssetsBuildHook(BuildHookInterface):  # type: ignore[misc]
    """Force-includes each repository asset that exists next to the project."""

    PLUGIN_NAME = "custom"

    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        """Populates `force_include` with repository catalog assets when present."""
        del version
        root = Path(self.root)
        for source, destination in _REPO_ASSETS.items():
            path = (root / source).resolve()
            if path.is_file():
                build_data.setdefault("force_include", {})[str(path)] = destination
