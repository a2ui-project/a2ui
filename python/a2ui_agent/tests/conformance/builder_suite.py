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

"""Shared execution and validation harness for ``conformance/agent/builder/builder.yaml``."""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import os
from typing import Any, Optional

import yaml

from a2ui.builder import v0_9 as builder_v0_9, v1_0 as builder_v1_0
from a2ui.builder.core import ComponentRef, flatten_component_tree
from a2ui.core import Catalog, CatalogApi, ValidationConfig
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.core.schema import v0_9 as schema_v0_9, v1_0 as schema_v1_0

from ..repo_paths import find_repo_root

REPO_ROOT = find_repo_root(os.path.dirname(__file__)) or ""
CONFORMANCE_DIR = os.path.join(REPO_ROOT, "conformance", "agent", "builder")
GOLDEN_DIR = os.path.join(CONFORMANCE_DIR, "golden")
SUITE_PATH = os.path.join(CONFORMANCE_DIR, "builder.yaml")

PROTOCOL_VERSION = ProtocolVersion.V0_9_1

_BUILDER_MODULES = {
    "v0.9": builder_v0_9,
    "v1.0": builder_v1_0,
}

_SCHEMA_MODULES = {
    "v0.9": schema_v0_9,
    "v1.0": schema_v1_0,
}

# =============================================================================
# Suite definition
# =============================================================================


@dataclass(frozen=True)
class ValidationProfile:
    """Per-case validator integrity relaxations declared in ``builder.yaml``."""

    allow_missing_root: bool = False
    allow_orphan_components: bool = False
    allow_dangling_references: bool = False

    def to_config(self) -> ValidationConfig:
        return ValidationConfig(
            allow_missing_root=self.allow_missing_root,
            allow_orphan_components=self.allow_orphan_components,
            allow_dangling_references=self.allow_dangling_references,
        )


@dataclass(frozen=True)
class Case:
    """One conformance case, as declared in builder.yaml."""

    id: str
    description: str
    golden: str
    surface_id: str
    input: Any
    version: str = "v0.9"
    root_id: Optional[str] = None
    catalog_id: Optional[str] = None
    data_model: Optional[dict[str, Any]] = None
    validation: ValidationProfile = field(default_factory=ValidationProfile)

    @property
    def golden_path(self) -> str:
        return os.path.join(GOLDEN_DIR, self.golden)

    def load_golden(self) -> Any:
        with open(self.golden_path, "r", encoding="utf-8") as f:
            return json.load(f)


def load_cases() -> list[Case]:
    """Loads every case declared in the shared, language-agnostic suite."""
    with open(SUITE_PATH, "r", encoding="utf-8") as f:
        suite = yaml.safe_load(f)
    default_version = suite.get("version", "v0.9")
    return [
        Case(
            id=raw["id"],
            description=raw["description"],
            golden=raw["golden"],
            surface_id=raw["surface_id"],
            input=raw["input"],
            version=raw.get("version", default_version),
            root_id=raw.get("root_id"),
            catalog_id=raw.get("catalog_id"),
            data_model=raw.get("data_model"),
            validation=ValidationProfile(**(raw.get("validation") or {})),
        )
        for raw in suite["tests"]
    ]


# =============================================================================
# Declarative AST construction
# =============================================================================


def build_ast(value: Any, version: str = "v0.9") -> Any:
    """Recursively constructs builder AST nodes from the declarative YAML input.

    Sentinel keys (``$bind``, ``$componentRef``, ``$dynamicChildList``) name the
    constructs that have no natural JSON form. Everything else is matched on
    its discriminating field, so adding a catalog component needs no change here.
    """
    b_mod = _BUILDER_MODULES.get(version, builder_v0_9)
    basic = b_mod.basic

    if isinstance(value, list):
        return [build_ast(item, version=version) for item in value]
    if not isinstance(value, dict):
        return value

    if "$bind" in value:
        return b_mod.DataBinding(path=value["$bind"])
    if "$componentRef" in value:
        return ComponentRef(id=value["$componentRef"])
    if "$dynamicChildList" in value:
        spec = value["$dynamicChildList"]
        return b_mod.DynamicChildList(
            path=spec["path"], template=build_ast(spec["template"], version=version)
        )
    if "$checkRule" in value:
        spec = value["$checkRule"]
        return b_mod.CheckRule(
            condition=build_ast(spec["condition"], version=version),
            message=spec["message"],
        )
    if "$accessibility" in value:
        return b_mod.AccessibilityAttributes(**{
            k: build_ast(v, version=version) for k, v in value["$accessibility"].items()
        })
    if "$action" in value:
        return _build_action(value["$action"], version=version)
    if "$tabItem" in value:
        spec = value["$tabItem"]
        return basic.TabItem(
            title=build_ast(spec["title"], version=version),
            child=build_ast(spec["child"], version=version),
        )
    if "$choiceOption" in value:
        spec = value["$choiceOption"]
        return basic.ChoicePickerOption(
            label=build_ast(spec["label"], version=version), value=spec["value"]
        )
    if "call" in value:
        return b_mod.FunctionCall(
            call=value["call"],
            args={
                k: build_ast(v, version=version)
                for k, v in value.get("args", {}).items()
            },
        )
    if "component" in value:
        cls = getattr(basic, value["component"])
        return cls(**{
            k: build_ast(v, version=version)
            for k, v in value.items()
            if k != "component"
        })

    return {k: build_ast(v, version=version) for k, v in value.items()}


def _build_action(spec: dict[str, Any], version: str = "v0.9") -> Any:
    b_mod = _BUILDER_MODULES.get(version, builder_v0_9)
    if "event" in spec:
        event_spec = spec["event"]
        if isinstance(event_spec, str):
            return b_mod.Action(event=b_mod.ActionEvent(name=event_spec))
        return b_mod.Action(
            event=b_mod.ActionEvent(
                name=event_spec["name"],
                context=(
                    {
                        k: build_ast(v, version=version)
                        for k, v in event_spec["context"].items()
                    }
                    if "context" in event_spec
                    else None
                ),
            )
        )
    return b_mod.Action(function_call=build_ast(spec["functionCall"], version=version))


# =============================================================================
# Execution
# =============================================================================


def run_case(case: Case) -> list[dict[str, Any]]:
    """Builds a case's AST and packages it into wire-format message envelopes."""
    s_mod = _SCHEMA_MODULES.get(case.version, schema_v0_9)
    root = build_ast(case.input, version=case.version)
    components = flatten_component_tree(root, root_id=case.root_id)
    if case.catalog_id:
        messages: list[Any] = [
            s_mod.CreateSurfaceMessage(
                create_surface=s_mod.CreateSurface(
                    surface_id=case.surface_id,
                    catalog_id=case.catalog_id,
                )
            ),
            s_mod.UpdateComponentsMessage(
                update_components=s_mod.UpdateComponents(
                    surface_id=case.surface_id,
                    components=components,
                )
            ),
        ]
        if case.data_model:
            for path, val in case.data_model.items():
                messages.append(
                    s_mod.UpdateDataModelMessage(
                        update_data_model=s_mod.UpdateDataModel(
                            surface_id=case.surface_id,
                            path=path,
                            value=val,
                        )
                    )
                )
    else:
        messages = [
            s_mod.UpdateComponentsMessage(
                update_components=s_mod.UpdateComponents(
                    surface_id=case.surface_id,
                    components=components,
                )
            )
        ]
    return [m.model_dump(by_alias=True, exclude_none=True) for m in messages]


# =============================================================================
# Validation
# =============================================================================

_catalogs_by_version: dict[str, CatalogApi] = {}


def basic_catalog_schema(version: str = "v0.9") -> CatalogApi:
    """Loads the basic catalog for ``version``, memoized because schema loading is slow."""
    if version not in _catalogs_by_version:
        proto_ver = (
            ProtocolVersion.V1_0 if version == "v1.0" else ProtocolVersion.V0_9_1
        )
        basic = BasicCatalog(proto_ver)
        _catalogs_by_version[version] = Catalog.from_json(
            catalog_schema=basic.validation_schema,
            protocol_version=proto_ver,
            catalog_id=basic.catalog_id,
        )
    return _catalogs_by_version[version]


def validate_payload(payload: list[dict[str, Any]], case: Case) -> None:
    """Validates ``payload`` against the bundled basic catalog schema and topology rules."""
    from a2ui.core import MessageProcessor, MessageProcessorOptions

    config = case.validation.to_config()
    has_create = any(isinstance(m, dict) and "createSurface" in m for m in payload)
    cat = basic_catalog_schema(case.version)
    processor = MessageProcessor(
        [cat],
        options=MessageProcessorOptions(validation_config=config),
    )
    if not has_create:
        from a2ui.core import SurfaceModel

        processor.model.add_surface(
            SurfaceModel(
                surface_id=case.surface_id,
                default_catalog=cat,
            )
        )
    processor.process_messages(payload)
