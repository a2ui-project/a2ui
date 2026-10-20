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

"""Checks the rizzcharts examples: they validate, and their data bindings resolve."""

from collections.abc import Iterator
import json
from pathlib import Path
import re
from typing import Any

import pytest

from a2ui.core import CatalogApi, DataModel, MessageProcessor
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.processor import CatalogConfig
from a2ui.utils import to_version_number, validate_payload

ROOT_DIR = Path(__file__).resolve().parents[4]
RIZZCHARTS_DIR = ROOT_DIR / "samples" / "community" / "agent" / "adk" / "rizzcharts"

# Each examples directory, and the catalogs that its surfaces use. A v1.0
# rizzcharts surface defaults to the basic catalog, and its rizzcharts
# components name the rizzcharts catalog.
EXAMPLE_SETS = [
    (ProtocolVersion.V0_8, "rizzcharts_catalog", ["rizzcharts"]),
    (ProtocolVersion.V0_8, "standard_catalog", ["basic"]),
    (ProtocolVersion.V0_9, "rizzcharts_catalog", ["rizzcharts"]),
    (ProtocolVersion.V0_9, "standard_catalog", ["basic"]),
    (ProtocolVersion.V1_0, "rizzcharts_catalog", ["basic", "rizzcharts"]),
    (ProtocolVersion.V1_0, "standard_catalog", ["basic"]),
]

_INTERPOLATION = re.compile(r"\$\{([^}]*)\}")


def _catalogs(version: ProtocolVersion, names: list[str]) -> list[CatalogApi]:
    catalogs = {
        "basic": CatalogConfig(BasicCatalog(version)).transformed_catalog,
        "rizzcharts": (
            CatalogConfig.from_path(
                catalog_path=str(
                    RIZZCHARTS_DIR
                    / "catalog_schemas"
                    / to_version_number(version)
                    / "rizzcharts_catalog_definition.json"
                ),
                protocol_version=version,
            ).transformed_catalog
        ),
    }
    return [catalogs[name] for name in names]


def _example_cases() -> list[Any]:
    cases = []
    for version, directory, names in EXAMPLE_SETS:
        examples_dir = (
            RIZZCHARTS_DIR / "examples" / directory / to_version_number(version)
        )
        for path in sorted(examples_dir.glob("*.json")):
            cases.append(
                pytest.param(
                    version,
                    names,
                    path,
                    id=f"{directory}/{to_version_number(version)}/{path.name}",
                )
            )
    return cases


def _components(
    messages: list[dict[str, Any]], version: ProtocolVersion
) -> dict[str, dict[str, Any]]:
    """Returns the properties of each component that the messages send, by id."""
    components = {}
    for message in messages:
        if version == ProtocolVersion.V0_8:
            for component in message.get("surfaceUpdate", {}).get("components", []):
                (properties,) = component["component"].values()
                components[component["id"]] = properties
        else:
            for component in message.get("updateComponents", {}).get("components", []):
                components[component["id"]] = component
    return components


def _root_id(messages: list[dict[str, Any]], version: ProtocolVersion) -> str:
    if version == ProtocolVersion.V0_8:
        return next(
            m["beginRendering"]["root"] for m in messages if "beginRendering" in m
        )
    return "root"


def _bindings(value: Any, binding_key: str) -> Iterator[str]:
    """Yields the data paths that a component's properties bind, children aside."""
    if isinstance(value, dict):
        if isinstance(value.get(binding_key), str):
            yield value[binding_key]
            return
        for key, item in value.items():
            if key not in ("children", "child"):
                yield from _bindings(item, binding_key)
    elif isinstance(value, list):
        for item in value:
            yield from _bindings(item, binding_key)
    elif isinstance(value, str):
        yield from _INTERPOLATION.findall(value)


def _children(
    properties: dict[str, Any], version: ProtocolVersion
) -> tuple[list[str], tuple[str, str] | None]:
    """Returns the ids of a component's children, and its template, if any.

    The template is the path of the list it repeats over and the id of the
    component it repeats.
    """
    child_ids = [properties["child"]] if "child" in properties else []
    children = properties.get("children")
    if isinstance(children, list):
        return child_ids + children, None
    if not isinstance(children, dict):
        return child_ids, None
    if version == ProtocolVersion.V0_8:
        if "explicitList" in children:
            return child_ids + children["explicitList"], None
        template = children["template"]
        return child_ids, (template["dataBinding"], template["componentId"])
    return child_ids, (children["path"], children["componentId"])


def _resolve(path: str, data_context: str) -> str:
    """Resolves a path against the data context, as the specification defines.

    A path that starts with "/" is absolute; any other path is relative to the
    data context, which a template sets to the list item.
    """
    if path.startswith("/"):
        return path
    return f"{data_context.rstrip('/')}/{path}"


def _unresolved_bindings(
    messages: list[dict[str, Any]],
    version: ProtocolVersion,
    data_model: DataModel,
) -> list[str]:
    """Returns a description of each binding that resolves to no data."""
    components = _components(messages, version)
    binding_key = "@path" if version == ProtocolVersion.V1_0 else "path"
    problems: list[str] = []

    def visit(component_id: str, data_context: str) -> None:
        properties = components[component_id]
        for path in _bindings(properties, binding_key):
            resolved = _resolve(path, data_context)
            if data_model.get(resolved) is None:
                problems.append(f"{component_id} binds {path!r} ({resolved}): no data")
        child_ids, template = _children(properties, version)
        for child_id in child_ids:
            visit(child_id, data_context)
        if template:
            list_path, template_id = template
            resolved = _resolve(list_path, data_context)
            items = data_model.get(resolved)
            if not items or not isinstance(items, (list, dict)):
                problems.append(
                    f"{component_id} repeats {list_path!r} ({resolved}): no list"
                )
                return
            keys = range(len(items)) if isinstance(items, list) else items.keys()
            for key in keys:
                visit(template_id, f"{resolved}/{key}")

    visit(_root_id(messages, version), "/")
    return problems


@pytest.mark.parametrize("version, catalog_names, path", _example_cases())
def test_rizzcharts_example_is_valid_on_its_catalogs(
    version: ProtocolVersion, catalog_names: list[str], path: Path
) -> None:
    """Each example validates against exactly the catalogs that its surfaces use."""
    messages = json.loads(path.read_text(encoding="utf-8"))
    validate_payload(_catalogs(version, catalog_names), messages)


@pytest.mark.parametrize("version, catalog_names, path", _example_cases())
def test_rizzcharts_example_bindings_resolve(
    version: ProtocolVersion, catalog_names: list[str], path: Path
) -> None:
    """Every data binding of an example resolves in the data model it sends.

    The data model must be nested, so that `/chart/items` names a list, and
    the components that a template repeats must bind paths relative to the
    list item.
    """
    messages = json.loads(path.read_text(encoding="utf-8"))
    processor = MessageProcessor(_catalogs(version, catalog_names))
    processor.process_messages(messages)
    (surface,) = processor.model.surfaces.values()

    assert _unresolved_bindings(messages, version, surface.data_model) == []
