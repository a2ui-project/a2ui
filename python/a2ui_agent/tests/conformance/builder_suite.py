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

import json
import os
from dataclasses import dataclass, field
from typing import Any, Optional

import yaml

from a2ui.basic_catalog.provider import BasicCatalog
from a2ui.builder.v0_9 import (
    AccessibilityAttributes,
    Action,
    ActionEvent,
    CheckRule,
    DataBinding,
    ComponentRef,
    DynamicChildList,
    FunctionCall,
    flatten_component_tree,
)
from a2ui.builder.v0_9.catalogs import basic
from a2ui.core.schema.v0_9.server_to_client import (
    CreateSurface,
    CreateSurfaceMessage,
    UpdateComponents,
    UpdateComponentsMessage,
    UpdateDataModel,
    UpdateDataModelMessage,
)
from a2ui.core.validation import ValidationConfig
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import (
    COMMON_TYPES_SCHEMA_KEY,
    SERVER_TO_CLIENT_SCHEMA_KEY,
    SPEC_VERSION_MAP,
)
from a2ui.schema.utils import find_repo_root, load_from_bundled_resource

REPO_ROOT = find_repo_root(os.path.dirname(__file__)) or ""
CONFORMANCE_DIR = os.path.join(REPO_ROOT, "conformance", "agent", "builder")
GOLDEN_DIR = os.path.join(CONFORMANCE_DIR, "golden")
SUITE_PATH = os.path.join(CONFORMANCE_DIR, "builder.yaml")

CATALOG_VERSION = "0.9.1"


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
    return [
        Case(
            id=raw["id"],
            description=raw["description"],
            golden=raw["golden"],
            surface_id=raw["surface_id"],
            input=raw["input"],
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


def build_ast(value: Any) -> Any:
    """Recursively constructs builder AST nodes from the declarative YAML input.

    Sentinel keys (``$bind``, ``$componentRef``, ``$dynamicChildList``) name the
    constructs that have no natural JSON spelling. Everything else is matched on
    its discriminating field, so adding a catalog component needs no change here.
    """
    if isinstance(value, list):
        return [build_ast(item) for item in value]
    if not isinstance(value, dict):
        return value

    if "$bind" in value:
        return DataBinding(path=value["$bind"])
    if "$componentRef" in value:
        return ComponentRef(id=value["$componentRef"])
    if "$dynamicChildList" in value:
        spec = value["$dynamicChildList"]
        return DynamicChildList(path=spec["path"], template=build_ast(spec["template"]))
    if "$checkRule" in value:
        spec = value["$checkRule"]
        return CheckRule(
            condition=build_ast(spec["condition"]), message=spec["message"]
        )
    if "$accessibility" in value:
        return AccessibilityAttributes(
            **{k: build_ast(v) for k, v in value["$accessibility"].items()}
        )
    if "$action" in value:
        return _build_action(value["$action"])
    if "$tabItem" in value:
        spec = value["$tabItem"]
        return basic.TabItem(
            title=build_ast(spec["title"]), child=build_ast(spec["child"])
        )
    if "$choiceOption" in value:
        spec = value["$choiceOption"]
        return basic.ChoicePickerOption(
            label=build_ast(spec["label"]), value=spec["value"]
        )
    if "call" in value:
        return FunctionCall(
            call=value["call"],
            args={k: build_ast(v) for k, v in value.get("args", {}).items()},
        )
    if "component" in value:
        cls = getattr(basic, value["component"])
        return cls(**{k: build_ast(v) for k, v in value.items() if k != "component"})

    return {k: build_ast(v) for k, v in value.items()}


def _build_action(spec: dict[str, Any]) -> Action:
    if "event" in spec:
        event_spec = spec["event"]
        if isinstance(event_spec, str):
            return Action(event=ActionEvent(name=event_spec))
        return Action(
            event=ActionEvent(
                name=event_spec["name"],
                context=(
                    {k: build_ast(v) for k, v in event_spec["context"].items()}
                    if "context" in event_spec
                    else None
                ),
            )
        )
    return Action(function_call=build_ast(spec["functionCall"]))


# =============================================================================
# Execution
# =============================================================================


def run_case(case: Case) -> list[dict[str, Any]]:
    """Builds a case's AST and packages it into wire-format message envelopes."""
    root = build_ast(case.input)
    components = flatten_component_tree(root, root_id=case.root_id)
    if case.catalog_id:
        messages: list[Any] = [
            CreateSurfaceMessage(
                create_surface=CreateSurface(
                    surface_id=case.surface_id,
                    catalog_id=case.catalog_id,
                )
            ),
            UpdateComponentsMessage(
                update_components=UpdateComponents(
                    surface_id=case.surface_id,
                    components=components,
                )
            ),
        ]
        if case.data_model:
            for path, val in case.data_model.items():
                messages.append(
                    UpdateDataModelMessage(
                        update_data_model=UpdateDataModel(
                            surface_id=case.surface_id,
                            path=path,
                            value=val,
                        )
                    )
                )
    else:
        messages = [
            UpdateComponentsMessage(
                update_components=UpdateComponents(
                    surface_id=case.surface_id,
                    components=components,
                )
            )
        ]
    return [m.model_dump(by_alias=True, exclude_none=True) for m in messages]


# =============================================================================
# Validation
# =============================================================================

_catalog: Optional[A2uiCatalog] = None


def basic_catalog_schema() -> A2uiCatalog:
    """Loads the bundled basic catalog, memoized because schema loading is slow."""
    global _catalog
    if _catalog is None:
        config = BasicCatalog.get_config(CATALOG_VERSION)
        _catalog = A2uiCatalog(
            version=CATALOG_VERSION,
            name="basic",
            catalog_schema=config.provider.load(),
            s2c_schema=load_from_bundled_resource(
                CATALOG_VERSION, SERVER_TO_CLIENT_SCHEMA_KEY, SPEC_VERSION_MAP
            ),
            common_types_schema=load_from_bundled_resource(
                CATALOG_VERSION, COMMON_TYPES_SCHEMA_KEY, SPEC_VERSION_MAP
            ),
        )
    return _catalog


def validate_payload(payload: list[dict[str, Any]], case: Case) -> None:
    """Validates ``payload`` against the bundled basic catalog schema and topology rules."""
    from a2ui.core.processing import MessageProcessor, MessageProcessorOptions

    config = case.validation.to_config()
    has_create = any(isinstance(m, dict) and "createSurface" in m for m in payload)
    processor = MessageProcessor(
        [basic_catalog_schema().core_catalog],
        options=MessageProcessorOptions(validation_config=config),
    )
    if not has_create:
        from a2ui.core.state import SurfaceModel

        processor.model.add_surface(
            SurfaceModel(
                surface_id=case.surface_id,
                default_catalog=basic_catalog_schema().core_catalog,
            )
        )
    processor.process_messages(payload)
