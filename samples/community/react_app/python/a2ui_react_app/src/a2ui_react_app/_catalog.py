# Copyright 2026 Google LLC
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

"""The ReactApp catalog and its examples, read from the package data."""

from __future__ import annotations

from importlib import resources
import json
from typing import Any

from a2ui.core import Catalog, CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats import to_message_models

REACT_APP_CATALOG_ID = "https://a2ui.org/labs/react_app/v1/catalog.json"
"""The ID of the catalog that defines the `ReactApp` component."""

REACT_APP_COMPONENT = "ReactApp"
"""The name of the component, as messages write it."""

_PROTOCOL_VERSION = "1.0"


def _read_asset(*parts: str) -> str:
    """Reads a file under the package's `assets` directory."""
    resource = resources.files("a2ui_react_app").joinpath("assets")
    for part in parts:
        resource = resource.joinpath(part)
    return resource.read_text(encoding="utf-8")


def read_typings() -> str:
    """Returns the `a2ui` module typings (`a2ui.d.ts`) as shipped."""
    return _read_asset("a2ui.d.ts")


def react_app_catalog() -> CatalogApi:
    """Returns the catalog that defines the `ReactApp` component.

    The catalog targets A2UI v1.0, where a surface mixes components from
    several catalogs, so it goes next to the app's other catalogs rather than
    replacing them.
    """
    return Catalog.from_json(
        json.loads(_read_asset("catalog.json")),
        protocol_version=_PROTOCOL_VERSION,
    )


def example_documents() -> list[dict[str, Any]]:
    """Returns the example documents (`name`, `description`, `messages`), by file name."""
    examples_dir = resources.files("a2ui_react_app").joinpath("assets/examples")
    names = sorted(f.name for f in examples_dir.iterdir() if f.name.endswith(".json"))
    return [json.loads(_read_asset("examples", name)) for name in names]


def react_app_examples() -> list[list[AgentToRendererMessage]]:
    """Returns the ReactApp examples as message turns, ordered by file name.

    Each turn creates a surface on the v1.0 basic catalog and places a
    `ReactApp` next to native components that share its data model paths.
    Pass them to an inference format's `examples` when the basic catalog is
    one of its catalogs.
    """
    return [to_message_models(doc["messages"]) for doc in example_documents()]
