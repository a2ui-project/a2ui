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

"""Execution and validation harness for ``conformance/agent/macros/macros.yaml``."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Literal, Optional, Sequence

import yaml

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.builder.v0_9 import (
    AccessibilityAttributes,
    Action,
    CheckRule,
    ComponentBuilderNode,
    ComponentRef,
    DynamicBoolean,
    DynamicNumber,
    DynamicString,
    DynamicStringList,
    DynamicValue,
)
from a2ui.builder.v0_9.catalogs.basic import (
    Button,
    Card,
    Column,
    Row,
    Text,
)
from a2ui.core.validation import ValidationConfig
from a2ui.transformers.macros import (
    MacroExpander,
    macro,
)
from a2ui.core import A2uiValidationError, Catalog, CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.schema.constants import VERSION_0_9_1
from pydantic import TypeAdapter

_message_adapter: TypeAdapter[AgentToRendererMessage] = TypeAdapter(
    AgentToRendererMessage
)

CONFORMANCE_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../../../conformance/agent/macros")
)
GOLDEN_DIR = os.path.join(CONFORMANCE_DIR, "golden")
SUITE_PATH = os.path.join(CONFORMANCE_DIR, "macros.yaml")

PROTOCOL_VERSION = VERSION_0_9_1


# =============================================================================
# Suite definition
# =============================================================================


@dataclass(frozen=True)
class ValidationProfile:
    """Per-case validator integrity relaxations declared in ``macros.yaml``."""

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
    """One conformance case, as declared in macros.yaml."""

    id: str
    description: str
    surface_id: str
    input: Any
    golden: Optional[str] = None
    catalog_id: Optional[str] = None
    validation: ValidationProfile = field(default_factory=ValidationProfile)
    expect_error: Optional[dict[str, Any]] = None
    action: Optional[str] = None
    colliding_macro: Optional[str] = None
    expect: Optional[dict[str, Any]] = None
    envelope_version: Optional[str] = None
    passthrough_components: Optional[list[str]] = None

    @property
    def golden_path(self) -> str:
        if not self.golden:
            return ""
        return os.path.join(GOLDEN_DIR, self.golden)

    def load_golden(self) -> Any:
        with open(self.golden_path, "r", encoding="utf-8") as f:
            return json.load(f)


def load_cases() -> list[Case]:
    """Loads every case declared in the shared, language-agnostic macros suite."""
    with open(SUITE_PATH, "r", encoding="utf-8") as f:
        suite = yaml.safe_load(f)
    return [
        Case(
            id=raw["id"],
            description=raw["description"],
            golden=raw.get("golden"),
            surface_id=raw.get("surface_id", "conformance"),
            input=raw.get("input"),
            catalog_id=raw.get("catalog_id"),
            validation=ValidationProfile(**(raw.get("validation") or {})),
            expect_error=raw.get("expect_error"),
            action=raw.get("action"),
            colliding_macro=raw.get("colliding_macro"),
            expect=raw.get("expect"),
            envelope_version=raw.get("envelope_version"),
            passthrough_components=raw.get("passthrough_components"),
        )
        for raw in suite["tests"]
    ]


# =============================================================================
# Standard Macro Definitions
# =============================================================================


def get_suite_macros() -> list[Any]:
    """Builds and returns the suite's standard reference macros."""

    @macro
    def StatusBadge(status: str, title: str) -> Card:
        """Status badge with uppercase status and title."""
        return Card(
            child=Row(
                children=[
                    Text(text=status.upper(), variant="caption"),
                    Text(text=title, variant="h3"),
                ]
            )
        )

    @macro
    def SlotContainer(title: str, content: ComponentBuilderNode) -> Card:
        """Container accepting an external child slot."""
        return Card(
            child=Column(
                children=[
                    Text(text=title, variant="h2"),
                    content,
                ]
            )
        )

    @macro
    def MultiSlotContainer(header: str, items: Sequence[ComponentBuilderNode]) -> Card:
        """Container accepting a list of child slots."""
        children: list[ComponentBuilderNode] = [Text(text=header, variant="h2")]
        children.extend(items)
        return Card(child=Column(children=children))

    @macro
    def ActionButton(label: str, action: Action) -> Button:
        """Button with coerced action."""
        return Button(
            child=Text(text=label),
            action=action,
            variant="primary",
        )

    @macro
    def BoundMetric(label: str, value: DynamicString) -> Card:
        """Metric card displaying a dynamic value."""
        return Card(
            child=Column(
                children=[
                    Text(text=label, variant="caption"),
                    Text(text=value, variant="h1"),
                ]
            )
        )

    @macro
    def ConfigCard(name: str, port: int, active: bool) -> Card:
        """Configuration card displaying primitives and metadata."""
        return Card(
            child=Column(
                children=[
                    Text(text=name, variant="h2"),
                    Text(text=f"Port: {port}", variant="body"),
                    Text(text=f"Active: {active}", variant="body"),
                ]
            )
        )

    @macro
    def NestedMacroCard(title: str, status: str) -> Card:
        """Macro composing another macro."""
        return Card(
            child=Column(
                children=[
                    Text(text=title, variant="h1"),
                    StatusBadge(status=status, title=f"{title} Status"),
                ]
            )
        )

    @macro
    def RecursiveCard(title: str) -> Card:
        """Macro composing itself recursively."""
        return Card(child=RecursiveCard(title=title))

    @macro
    def ComplexCard(
        title: str,
        dynamic_title: DynamicString,
        metric: DynamicNumber,
        is_active: DynamicBoolean,
        tags: DynamicStringList,
        anything: DynamicValue,
        on_click: Action,
        checks: Sequence[CheckRule],
        accessibility: AccessibilityAttributes,
        footer: ComponentRef,
        items: Sequence[ComponentBuilderNode],
        theme: Literal["primary", "secondary"],
    ) -> Card:
        """Card testing protocol common types in macro parameter schemas."""
        return Card(child=Text(text=title))

    return [
        StatusBadge,
        SlotContainer,
        MultiSlotContainer,
        ActionButton,
        BoundMetric,
        ConfigCard,
        NestedMacroCard,
        RecursiveCard,
        ComplexCard,
    ]


SUITE_MACROS = get_suite_macros()


# =============================================================================
# Execution
# =============================================================================


def run_case(case: Case) -> Any:
    """Runs a conformance case through MacroExpander."""
    if case.action == "transform_catalog" and case.colliding_macro:

        @macro(name=case.colliding_macro)
        def CollidingMacro() -> Card:
            return Card(child=Text(text="colliding"))

        expander = MacroExpander([CollidingMacro])
        expander.transform_to_inference_catalog(basic_catalog_schema())
        return []

    if case.action == "transform_to_inference_catalog":
        expander = MacroExpander(
            SUITE_MACROS, passthrough_components=case.passthrough_components
        )
        return expander.transform_to_inference_catalog(basic_catalog_schema())

    if case.action == "transform_to_inference":
        raw_components = case.input if isinstance(case.input, list) else [case.input]
        msg = {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": case.surface_id,
                "components": raw_components,
            },
        }
        typed_msg = _message_adapter.validate_python(msg)
        expander = MacroExpander(SUITE_MACROS)
        lowered = expander.transform_to_inference([typed_msg])
        return [m.model_dump(by_alias=True, exclude_none=True) for m in lowered]

    version_str = case.envelope_version or "v0.9"
    raw_components = case.input if isinstance(case.input, list) else [case.input]

    if case.catalog_id:
        raw_msgs = [
            {
                "version": version_str,
                "createSurface": {
                    "surfaceId": case.surface_id,
                    "catalogId": case.catalog_id,
                },
            },
            {
                "version": version_str,
                "updateComponents": {
                    "surfaceId": case.surface_id,
                    "components": raw_components,
                },
            },
        ]
    else:
        raw_msgs = [{
            "version": version_str,
            "updateComponents": {
                "surfaceId": case.surface_id,
                "components": raw_components,
            },
        }]

    try:
        typed_raw_msgs = [_message_adapter.validate_python(m) for m in raw_msgs]
    except Exception as e:
        raise A2uiValidationError(f"Invalid message envelope: {e}") from e

    expander = MacroExpander(SUITE_MACROS)
    expanded_msgs = expander.transform_to_transport(typed_raw_msgs)
    return [m.model_dump(by_alias=True, exclude_none=True) for m in expanded_msgs]


# =============================================================================
# Validation
# =============================================================================

_catalog: Optional[CatalogApi] = None


def basic_catalog_schema() -> CatalogApi:
    """Loads the basic catalog, memoized because schema loading is slow."""
    global _catalog
    if _catalog is None:
        # BasicCatalog serves v0.9.1 with the v0.9 catalog, which reports v0.9,
        # so the catalog is parsed again for the version under test.
        basic = BasicCatalog(PROTOCOL_VERSION)
        _catalog = Catalog.from_json(
            catalog_schema=basic.catalog_schema,
            protocol_version=PROTOCOL_VERSION,
            catalog_id=basic.catalog_id,
        )
    return _catalog


def validate_payload(payload: list[dict[str, Any]], case: Case) -> None:
    """Validates ``payload`` against the bundled basic catalog schema and topology rules."""
    import copy
    from a2ui.core import MessageProcessor, MessageProcessorOptions

    config = case.validation.to_config()
    has_create = any(isinstance(m, dict) and "createSurface" in m for m in payload)
    catalogs = [basic_catalog_schema()]
    if case.catalog_id and case.catalog_id != getattr(catalogs[0], "catalog_id", None):
        alias_cat = copy.copy(catalogs[0])
        alias_cat.catalog_id = case.catalog_id
        catalogs.append(alias_cat)

    processor = MessageProcessor(
        catalogs,
        options=MessageProcessorOptions(validation_config=config),
    )
    if not has_create:
        from a2ui.core import SurfaceModel

        processor.model.add_surface(
            SurfaceModel(
                surface_id=case.surface_id,
                default_catalog=catalogs[0],
            )
        )
    processor.process_messages(payload)
