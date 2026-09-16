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

"""Guards the shared type definitions against specification drift.

`Catalog` satisfies cross-document `common_types.json#/$defs/...` references
from `_get_dynamic_types_defs()` rather than by reading the specification tree,
so those hand-maintained definitions must stay in step with the published
document.

The specification versions are discovered from the `specification/` tree, so
adding or bumping a version needs no change here. Three properties are checked:

  - The in-memory definitions match the published shared types. They model the
    newest version, so this comparison runs against the newest version only.
  - Every published catalog resolves with its cross-document references
    localised, for every version.
  - Each version's `BasicCatalog` accepts the properties that version's
    `common_types.json` specifies, so that a catalog built for an older
    version does not quietly validate against a newer shape.
"""

import glob
import importlib
import json
import os
import pkgutil
import re
from typing import Any, NamedTuple

import pytest

from a2ui.core.catalog.catalog import Catalog, _get_dynamic_types_defs
from a2ui.core.validation.payload_validator import PayloadValidator

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
SPEC_ROOT = os.path.join(REPO_ROOT, "specification")

# Version directories are named 'v<major>_<minor>[_<patch>]', e.g. 'v0_9_1'.
_VERSION_DIR = re.compile(r"^v\d+(?:_\d+)*$")

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


class PropertyGap(NamedTuple):
    """A known difference in the properties a definition accepts."""

    specification_only: tuple[str, ...]
    sdk_only: tuple[str, ...]
    reason: str


# Known differences between the properties a version's BasicCatalog accepts and
# the properties that version's common_types.json specifies, keyed by version
# then definition. The comparison is an exact match against this ledger, so a
# gap that closes fails the test just as a new gap does.
KNOWN_PROPERTY_GAPS: dict[str, dict[str, PropertyGap]] = {
    "v1_0": {
        "FunctionCall": PropertyGap(
            specification_only=(),
            sdk_only=("args",),
            reason=(
                "The flat-shape deviation recorded in ACCEPTED_DEVIATIONS. The"
                " specification carries per-function argument schemas in the"
                " catalog's anyFunction union rather than a shared 'args'"
                " property."
            ),
        ),
    },
}


def _version_sort_key(version: str) -> tuple[int, ...]:
    """Orders 'v0_9' before 'v0_9_1' before 'v1_0'."""
    return tuple(int(part) for part in version[1:].split("_"))


def _protocol_version(version: str) -> str:
    """Turns a directory name into a protocol version: 'v0_9_1' -> '0.9.1'."""
    return version[1:].replace("_", ".")


def _common_types_path(version: str) -> str:
    return os.path.join(SPEC_ROOT, version, "json", "common_types.json")


def _spec_versions() -> list[str]:
    """Published versions that define shared types, oldest first.

    Versions predating `common_types.json` have no shared types to localise
    and are skipped.
    """
    versions = [
        os.path.basename(path)
        for path in glob.glob(os.path.join(SPEC_ROOT, "v*"))
        if _VERSION_DIR.match(os.path.basename(path))
        and os.path.isfile(_common_types_path(os.path.basename(path)))
    ]
    return sorted(versions, key=_version_sort_key)


def _catalogs() -> list[tuple[str, str]]:
    """Every (version, catalog path) pair across the discovered versions."""
    return [
        (version, path)
        for version in _spec_versions()
        for path in sorted(
            glob.glob(os.path.join(SPEC_ROOT, version, "catalogs", "*", "catalog.json"))
        )
    ]


def _load_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _load_spec_defs(version: str) -> dict[str, Any]:
    return _load_json(_common_types_path(version))["$defs"]


def _canonical(node: Any) -> str:
    return json.dumps(node, sort_keys=True)


def _latest_version() -> str:
    return _spec_versions()[-1]


def _basic_catalog_class(version: str) -> type | None:
    """The `BasicCatalog` whose schema package covers this protocol version.

    One package can serve several versions: `schema.v0_9` declares support for
    both v0.9 and v0.9.1, so both resolve to `basic_catalog.v0_9`.
    """
    import a2ui.core.basic_catalog as basic_catalog

    wanted = f"v{_protocol_version(version)}"
    for module in pkgutil.iter_modules(basic_catalog.__path__):
        if not _VERSION_DIR.match(module.name):
            continue
        constants = importlib.import_module(f"a2ui.core.schema.{module.name}.constants")
        if wanted in getattr(constants, "SUPPORTED_PROTOCOL_VERSIONS", ()):
            package = importlib.import_module(f"a2ui.core.basic_catalog.{module.name}")
            return getattr(package, "BasicCatalog", None)
    return None


def _versions_with_basic_catalog() -> list[str]:
    return [v for v in _spec_versions() if _basic_catalog_class(v) is not None]


def _accepted_properties(
    node: Any, defs: dict[str, Any], seen: frozenset[str] = frozenset()
) -> set[str]:
    """The property names a definition accepts unconditionally.

    `allOf` branches and same-document `$ref`s are followed, since every one of
    them applies. `oneOf` and `anyOf` branches are not, since their properties
    are conditional on which branch matches.
    """
    if not isinstance(node, dict):
        return set()

    names = set(node.get("properties", {}))
    for branch in node.get("allOf", []):
        if not isinstance(branch, dict):
            continue
        ref = branch.get("$ref")
        if ref is None:
            names |= _accepted_properties(branch, defs, seen)
            continue
        # Cross-document references cannot be resolved here and are skipped.
        target = ref.rsplit("/", 1)[-1]
        if target in defs and target not in seen:
            names |= _accepted_properties(defs[target], defs, seen | {target})
    return names


def _shared_definition_names() -> list[str]:
    versions = _spec_versions()
    if not versions:
        return []
    return sorted(set(_get_dynamic_types_defs()) & set(_load_spec_defs(versions[-1])))


def test_specification_versions_are_discovered() -> None:
    """Discovery finds the published versions, so the suite cannot silently empty out."""
    assert (
        _spec_versions()
    ), f"No specification versions with a common_types.json under {SPEC_ROOT}."
    assert _catalogs(), f"No published catalogs under {SPEC_ROOT}."


@pytest.mark.parametrize("name", _shared_definition_names())
def test_shared_type_matches_specification(name: str) -> None:
    """Every shared definition matches `common_types.json`, or is an accepted deviation."""
    version = _latest_version()
    spec_defs = _load_spec_defs(version)
    local_defs = _get_dynamic_types_defs()
    matches = _canonical(spec_defs[name]) == _canonical(local_defs[name])

    if name in ACCEPTED_DEVIATIONS:
        assert not matches, (
            f"'{name}' now matches the specification. Remove it from"
            " ACCEPTED_DEVIATIONS."
        )
        return

    assert matches, (
        f"'{name}' has drifted from"
        f" specification/{version}/json/common_types.json. Update the"
        " definition, or add it to ACCEPTED_DEVIATIONS with a reason."
        f"\n\nspecification: {_canonical(spec_defs[name])}"
        f"\nin-memory:     {_canonical(local_defs[name])}"
    )


def test_accepted_deviations_are_known_definitions() -> None:
    """Every accepted deviation names a definition that exists in both documents."""
    shared = set(_shared_definition_names())
    unknown = sorted(set(ACCEPTED_DEVIATIONS) - shared)
    assert not unknown, f"ACCEPTED_DEVIATIONS names unknown definitions: {unknown}"


@pytest.mark.parametrize(
    ("version", "catalog_path"),
    _catalogs(),
    ids=[
        f"{version}-{os.path.basename(os.path.dirname(path))}"
        for version, path in _catalogs()
    ],
)
def test_published_catalog_resolves_without_specification_files(
    version: str, catalog_path: str
) -> None:
    """Every published catalog loads with its cross-document references localised."""
    catalog_schema = _load_json(catalog_path)
    common_types_schema = _load_json(_common_types_path(version))

    catalog = Catalog.from_json(
        catalog_schema=catalog_schema,
        protocol_version=_protocol_version(version),
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

    referenced = sorted({
        ref.split("/")[0]
        for ref in re.findall(r'"\$ref": "#/\$defs/([^"]+)"', resolved)
    })
    assert referenced, "Catalog schema references no shared definitions at all."

    defs = catalog.catalog_schema.get("$defs", {})
    missing = [name for name in referenced if name not in defs]
    assert not missing, f"Referenced but absent from $defs: {missing}"


@pytest.mark.parametrize(
    ("version", "catalog_path"),
    _catalogs(),
    ids=[
        f"{version}-{os.path.basename(os.path.dirname(path))}"
        for version, path in _catalogs()
    ],
)
def test_published_catalog_validates_action_payload(
    version: str, catalog_path: str
) -> None:
    """Validating components with actions resolves function and catalog pointers cleanly."""
    catalog_schema = _load_json(catalog_path)
    common_types_schema = _load_json(_common_types_path(version))

    catalog = Catalog.from_json(
        catalog_schema=catalog_schema,
        protocol_version=_protocol_version(version),
        catalog_id=catalog_schema["catalogId"],
        common_types_schema=common_types_schema,
    )
    validator = PayloadValidator(catalog)
    if catalog.get_component("Button") and catalog.get_function("openUrl"):
        btn_component = {
            "id": "btn1",
            "component": "Button",
            "child": "txt1",
            "action": {
                "functionCall": {
                    "call": "openUrl",
                    "args": {"url": "https://example.com"},
                }
            },
        }
        errors = validator.validate_component(btn_component)
        assert not errors, f"Validation failed on {version} {catalog_path}: {errors}"


@pytest.mark.parametrize("version", _versions_with_basic_catalog())
def test_basic_catalog_accepts_the_specified_properties(version: str) -> None:
    """Each version's BasicCatalog accepts the properties that version specifies.

    A catalog built for an older version must not be validated against a newer
    shape: a property the version does not define should be rejected, and one
    it does define should be accepted.
    """
    catalog_class = _basic_catalog_class(version)
    assert catalog_class is not None
    built_defs = catalog_class().catalog_schema.get("$defs", {})
    spec_defs = _load_spec_defs(version)

    observed: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {}
    for name in sorted(set(spec_defs) & set(built_defs)):
        specified = _accepted_properties(spec_defs[name], spec_defs)
        accepted = _accepted_properties(built_defs[name], built_defs)
        if specified != accepted:
            observed[name] = (
                tuple(sorted(specified - accepted)),
                tuple(sorted(accepted - specified)),
            )

    known = KNOWN_PROPERTY_GAPS.get(version, {})
    expected = {
        name: (gap.specification_only, gap.sdk_only) for name, gap in known.items()
    }

    if observed == expected:
        return

    detail = [f"{version}: BasicCatalog properties disagree with the ledger."]
    for name in sorted(set(observed) | set(expected)):
        if observed.get(name) == expected.get(name):
            continue
        detail.append(f"  {name}:")
        detail.append(f"    observed: {observed.get(name, 'no gap')}")
        detail.append(f"    ledger:   {expected.get(name, 'no gap')}")
        if name in known:
            detail.append(f"    recorded: {known[name].reason}")
    detail.append(
        "Each entry is (properties only the specification accepts, properties"
        " only the SDK accepts). Fix the model, or update KNOWN_PROPERTY_GAPS"
        " with a reason."
    )
    raise AssertionError("\n".join(detail))
