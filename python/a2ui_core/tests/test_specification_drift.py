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

"""Guards the in-memory shared type definitions against specification drift.

`Catalog` satisfies cross-document `common_types.json#/$defs/...` references
from `_get_dynamic_types_defs()` rather than by reading the specification tree,
so those hand-maintained definitions must stay in step with the published
document.
"""

import json
import os
import re
from typing import Any

import pytest

from a2ui.core.catalog.catalog import Catalog, _get_dynamic_types_defs

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
SPEC_V1_0 = os.path.join(REPO_ROOT, "specification", "v1_0")
COMMON_TYPES_PATH = os.path.join(SPEC_V1_0, "json", "common_types.json")
BASIC_CATALOG_PATH = os.path.join(SPEC_V1_0, "catalogs", "basic", "catalog.json")

# Definitions that intentionally differ from the published document, with the
# reason for each. Anything not listed here must match the specification byte
# for byte. Entries are also asserted to still differ, so that a definition
# brought back into line cannot silently linger on this list.
ACCEPTED_DEVIATIONS: dict[str, str] = {
    "ChildList": (
        "The template branch is extracted into a separate TemplateChildList"
        " definition and referenced, rather than being inlined. The two forms"
        " accept the same documents."
    ),
    "DataBinding": (
        "Derived from the Pydantic model, which emits a per-property 'title'"
        " the specification does not carry."
    ),
    "DynamicValue": (
        "The specification forbids a bare object that looks like a DataBinding"
        " or FunctionCall via a 'not' guard. The Pydantic-derived definition"
        " has no equivalent, so it accepts a wider set of objects."
    ),
    "FunctionCall": (
        "The specification composes FunctionCommon with the catalog's"
        " anyFunction union. The Pydantic-derived definition is the flat"
        " {call, args, catalogId} shape and does not constrain 'call' to a"
        " catalog function."
    ),
}


def _load_spec_defs() -> dict[str, Any]:
    with open(COMMON_TYPES_PATH, "r", encoding="utf-8") as f:
        return json.load(f)["$defs"]


def _canonical(node: Any) -> str:
    return json.dumps(node, sort_keys=True)


@pytest.mark.parametrize(
    "name",
    sorted(set(_get_dynamic_types_defs()) & set(_load_spec_defs())),
)
def test_shared_type_matches_specification(name: str) -> None:
    """Every shared definition matches `common_types.json`, or is an accepted deviation."""
    spec_defs = _load_spec_defs()
    local_defs = _get_dynamic_types_defs()
    matches = _canonical(spec_defs[name]) == _canonical(local_defs[name])

    if name in ACCEPTED_DEVIATIONS:
        assert not matches, (
            f"'{name}' now matches the specification. Remove it from"
            " ACCEPTED_DEVIATIONS."
        )
        return

    assert matches, (
        f"'{name}' has drifted from specification/v1_0/json/common_types.json."
        " Update the definition, or add it to ACCEPTED_DEVIATIONS with a"
        f" reason.\n\nspecification: {_canonical(spec_defs[name])}"
        f"\nin-memory:     {_canonical(local_defs[name])}"
    )


def test_accepted_deviations_are_known_definitions() -> None:
    """Every accepted deviation names a definition that exists in both documents."""
    shared = set(_get_dynamic_types_defs()) & set(_load_spec_defs())
    unknown = sorted(set(ACCEPTED_DEVIATIONS) - shared)
    assert not unknown, f"ACCEPTED_DEVIATIONS names unknown definitions: {unknown}"


def test_published_catalog_resolves_without_specification_files() -> None:
    """The published basic catalog loads with every cross-document reference localised."""
    with open(BASIC_CATALOG_PATH, "r", encoding="utf-8") as f:
        catalog_schema = json.load(f)
    with open(COMMON_TYPES_PATH, "r", encoding="utf-8") as f:
        common_types_schema = json.load(f)

    catalog = Catalog.from_json(
        catalog_schema=catalog_schema,
        protocol_version="v1.0",
        catalog_id=catalog_schema["catalogId"],
        common_types_schema=common_types_schema,
    )
    resolved = json.dumps(catalog.catalog_schema)

    cross_document = sorted(
        set(re.findall(r'"\$ref": "([^"#]+\.json#[^"]*)"', resolved))
    )
    assert not cross_document, (
        "Catalog schema still contains references that need the specification"
        f" tree on disk: {cross_document}"
    )

    defs = catalog.catalog_schema.get("$defs", {})
    for name in ("ChildList", "Child", "ComponentId", "DynamicString"):
        assert name in defs, f"'{name}' is referenced but absent from $defs"
