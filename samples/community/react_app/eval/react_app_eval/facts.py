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

"""Static facts about ReactApp sources and compiled A2UI messages, for the scorers."""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Mapping
from typing import Any

from a2ui_react_app import (
    REACT_APP_CATALOG_ID,
    ReactAppSourceFacts,
    react_app_source_facts,
)

__all__ = [
    "SourceFacts",
    "iter_react_apps",
    "iter_strings",
    "source_facts",
]

# The agent package reads sources for its checks; the scorers read them the
# same way.
SourceFacts = ReactAppSourceFacts
source_facts = react_app_source_facts


def _components_of(message: Mapping[str, Any]) -> Iterator[Mapping[str, Any]]:
    for key in ("createSurface", "updateComponents"):
        body = message.get(key)
        if isinstance(body, Mapping):
            for component in body.get("components") or []:
                if isinstance(component, Mapping):
                    yield component


def iter_react_apps(
    messages: Iterable[Mapping[str, Any]],
) -> Iterator[Mapping[str, Any]]:
    """Yields every `ReactApp` component of compiled messages.

    A component counts when it names the ReactApp catalog, or names no catalog
    (single-catalog payloads stamp none).
    """
    for message in messages:
        if not isinstance(message, Mapping):
            continue
        for component in _components_of(message):
            catalog_id = component.get("catalogId")
            if component.get("component") == "ReactApp" and catalog_id in (
                None,
                REACT_APP_CATALOG_ID,
            ):
                yield component


def iter_strings(value: Any) -> Iterator[str]:
    """Yields every string leaf of a JSON value, keys excluded."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, Mapping):
        for child in value.values():
            yield from iter_strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_strings(child)
