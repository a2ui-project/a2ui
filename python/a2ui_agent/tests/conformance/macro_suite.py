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

import copy
from dataclasses import dataclass, field
import json
import os
from typing import Any, Literal, Optional, Sequence

from pydantic import TypeAdapter
import yaml

from a2ui.builder import v1_0 as builder_v1_0
from a2ui.builder.v0_9 import (
    AccessibilityAttributes,
    Action,
    Button,
    Card,
    CheckRule,
    Column,
    ComponentBuilderNode,
    ComponentRef,
    DynamicBoolean,
    DynamicNumber,
    DynamicString,
    DynamicStringList,
    DynamicValue,
    Row,
    Text,
)
from a2ui.core import (
    A2uiValidationError,
    Catalog,
    CatalogApi,
    MessageProcessor,
    MessageProcessorOptions,
    SurfaceModel,
    ValidationConfig,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import AgentToRendererMessage, ProtocolVersion
from a2ui.transformers.macros import MacroExpander, macro
from a2ui.utils import to_version_number

_message_adapter: TypeAdapter[AgentToRendererMessage] = TypeAdapter(
    AgentToRendererMessage
)

CONFORMANCE_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../../../conformance/agent/macros")
)
GOLDEN_DIR = os.path.join(CONFORMANCE_DIR, "golden")
SUITE_PATH = os.path.join(CONFORMANCE_DIR, "macros.yaml")

# The catalog definition form of the version, without the leading "v".
# conformance/agent/macros/macros.yaml expects it back unchanged.
PROTOCOL_VERSION = to_version_number(ProtocolVersion.V0_9_1)

_V1_0_BASIC_CID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
_V0_9_BASIC_CID = "https://a2ui.org/specification/v0_9/standard_catalog.json"
_FOO_CID = "https://example.com/catalogs/foo/v1/catalog.json"
_BAR_CID = "https://example.com/catalogs/bar/v1/catalog.json"
_BRAND_CID = "https://example.com/brand.json"
_BRAND_SURFACE_CID = "https://example.com/brand_surface.json"
_CAT_A_CID = "https://example.com/catalog_a.json"
_CAT_B_CID = "https://example.com/catalog_b.json"
_BAZ_MACROS_CID = "https://example.com/catalogs/baz_macros.json"


# =============================================================================
# Suite definition
# =============================================================================


@dataclass(frozen=True)
class ValidationProfile:
    """Per-case validator integrity relaxations declared in ``macros.yaml``."""

    allow_missing_root: bool = False
    allow_orphan_components: bool = False
    allow_dangling_references: bool = False
    skip_renderer_validation: bool = False

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
    macro_catalog_id: str | None = None
    expander_scoped: bool = True
    expander_catalog_id: str | None = None
    macro_version: str | None = None
    empty_macros: bool = False
    expander_protocol_version: str | None = None
    base_catalogs: Optional[list[str]] = None
    validation_catalogs: Optional[list[str]] = None
    surface_catalogs: Optional[dict[str, Optional[str]]] = None
    messages: Optional[list[dict[str, Any]]] = None
    on_error: Literal["passthrough", "raise"] = "passthrough"

    @property
    def golden_path(self) -> str:
        if not self.golden:
            return ""
        return os.path.join(GOLDEN_DIR, self.golden)

    def load_golden(self) -> Any:
        with open(self.golden_path, "r", encoding="utf-8") as f:
            return json.load(f)


def _load_raw_suite() -> dict[str, Any]:
    with open(SUITE_PATH, "r", encoding="utf-8") as f:
        data: dict[str, Any] = yaml.safe_load(f)
        return data


_RAW_SUITE = _load_raw_suite()
CUSTOM_CATALOG_SCHEMAS: dict[str, dict[str, Any]] = _RAW_SUITE.get(
    "custom_catalogs", {}
)


def load_cases() -> list[Case]:
    """Loads every case declared in the shared, language-agnostic macros suite."""
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
            macro_catalog_id=raw.get("macro_catalog_id"),
            expander_scoped=raw.get("expander_scoped", True),
            expander_catalog_id=raw.get("expander_catalog_id"),
            macro_version=raw.get("macro_version"),
            empty_macros=raw.get("empty_macros", False),
            expander_protocol_version=raw.get("expander_protocol_version"),
            base_catalogs=raw.get("base_catalogs"),
            validation_catalogs=raw.get("validation_catalogs"),
            surface_catalogs=raw.get("surface_catalogs"),
            messages=raw.get("messages"),
            on_error=raw.get("on_error", "passthrough"),
        )
        for raw in _RAW_SUITE["tests"]
    ]


# =============================================================================
# Custom Builder Nodes & Standard Macro Definitions
# =============================================================================


class FooCatalogNode(builder_v1_0.ComponentBuilderNode, catalog_id=_FOO_CID):
    pass


class BarCatalogNode(builder_v1_0.ComponentBuilderNode, catalog_id=_BAR_CID):
    pass


class FooPanelNode(FooCatalogNode):
    component: Literal["FooPanel"] = "FooPanel"
    children: builder_v1_0.ChildList


class FooHeaderNode(FooCatalogNode):
    component: Literal["FooHeader"] = "FooHeader"
    title: builder_v1_0.DynamicString


class BarBadgeNode(BarCatalogNode):
    component: Literal["BarBadge"] = "BarBadge"
    tag: str


class BarButtonNode(BarCatalogNode):
    component: Literal["BarButton"] = "BarButton"
    label: builder_v1_0.DynamicString
    action: builder_v1_0.Action


class BrandBoxNode(builder_v1_0.ComponentBuilderNode):
    component: Literal["BrandBox"] = "BrandBox"
    child: builder_v1_0.Child


class ChartNode(builder_v1_0.ComponentBuilderNode):
    component: Literal["Chart"] = "Chart"
    series: str


class ChartCardNode(builder_v1_0.ComponentBuilderNode):
    component: Literal["ChartCard"] = "ChartCard"
    child: builder_v1_0.Child


class InnerBadgeScopedNode(builder_v1_0.ComponentBuilderNode):
    component: Literal["InnerBadgeScoped"] = "InnerBadgeScoped"
    label: str


class InnerBadgeInheritedNode(builder_v1_0.ComponentBuilderNode):
    component: Literal["InnerBadgeInherited"] = "InnerBadgeInherited"
    label: str


class DeferredCycleV10Node(builder_v1_0.ComponentBuilderNode):
    component: Literal["DeferredCycle"] = "DeferredCycle"
    label: str


class CycleANode(builder_v1_0.ComponentBuilderNode):
    component: Literal["CycleA"] = "CycleA"
    label: str


class CycleBNode(builder_v1_0.ComponentBuilderNode):
    component: Literal["CycleB"] = "CycleB"
    label: str


class FakeSurfaceNode(builder_v1_0.ComponentBuilderNode):
    component: Literal["Surface"] = "Surface"


def get_suite_macros() -> list[Any]:
    """Builds and returns the suite's standard v0.9 reference macros."""

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
                    Text(text=f"Active: {str(active).lower()}", variant="body"),
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


def get_scoped_suite_macros() -> dict[str, list[Any]]:
    """Builds and returns catalog-scoped reference macros keyed by ``catalog_id``."""

    @macro(name="Text")
    def BrandText(
        text: str, variant: builder_v1_0.TextVariant = "body"
    ) -> builder_v1_0.Card:
        """Custom brand Text macro wrapping a basic Text inside a Card."""
        return builder_v1_0.Card(
            child=builder_v1_0.Text(
                text=f"[Brand] {text}",
                variant=variant,
            )
        )

    @macro
    def UnannotatedBrandCard(title: str) -> builder_v1_0.Card:
        """Brand card emitting unannotated Card, BrandBox, and Text nodes."""
        return builder_v1_0.Card(
            child=BrandBoxNode(child=builder_v1_0.Text(text=title, variant="body"))
        )

    @macro
    def BrandBadge(label: str) -> builder_v1_0.Card:
        """Brand badge emitting basic Card and Text with explicit catalogId."""
        return builder_v1_0.Card(
            catalog_id=_V1_0_BASIC_CID,
            child=builder_v1_0.Text(
                text=f"[Badge] {label}",
                variant="body",
                catalog_id=_V1_0_BASIC_CID,
            ),
        )

    @macro
    def InnerBadgeScoped(label: str) -> BrandBoxNode:
        """Scoped inner badge emitting BrandBox and unannotated basic Text."""
        return BrandBoxNode(
            catalog_id=_BRAND_CID,
            child=builder_v1_0.Text(text=f"Scoped Badge: {label}", variant="caption"),
        )

    @macro
    def OuterPanelScoped(title: str) -> builder_v1_0.Card:
        """Scoped outer panel emitting unannotated Text alongside deferred InnerBadgeScoped."""
        return builder_v1_0.Card(
            child=builder_v1_0.Column(
                children=[
                    builder_v1_0.Text(text=title, variant="body"),
                    InnerBadgeScopedNode(label=title, catalog_id=_BRAND_CID),
                ]
            )
        )

    @macro(name="Chart")
    def BrandChart(series: str) -> ChartCardNode:
        """Brand Chart macro emitting ChartCard wrapping an unannotated Chart primitive."""
        return ChartCardNode(child=ChartNode(series=f"[Brand] {series}"))

    @macro(name="Text")
    def BrandSurfaceText(
        text: str, variant: builder_v1_0.TextVariant = "body"
    ) -> builder_v1_0.Card:
        """Brand surface Text macro emitting cross-catalog basic Card and Text around BrandBox."""
        return builder_v1_0.Card(
            catalog_id=_V1_0_BASIC_CID,
            child=BrandBoxNode(
                catalog_id=_BRAND_SURFACE_CID,
                child=builder_v1_0.Text(
                    text=f"[Brand] {text}",
                    variant=variant,
                    catalog_id=_V1_0_BASIC_CID,
                ),
            ),
        )

    @macro(name="BrandBadge")
    def BrandSurfaceBadge(label: str) -> builder_v1_0.Card:
        """Brand surface badge emitting cross-catalog basic Card and Text around BrandBox."""
        return builder_v1_0.Card(
            catalog_id=_V1_0_BASIC_CID,
            child=BrandBoxNode(
                catalog_id=_BRAND_SURFACE_CID,
                child=builder_v1_0.Text(
                    text=f"[Badge] {label}",
                    variant="body",
                    catalog_id=_V1_0_BASIC_CID,
                ),
            ),
        )

    @macro
    def BazMacro(
        headline: builder_v1_0.DynamicString,
        badge_tag: str,
        cta_label: str,
        on_cta: builder_v1_0.Action,
    ) -> FooPanelNode:
        """Composite macro combining FooCatalog and BarCatalog primitives with explicit catalogIds."""
        return FooPanelNode(
            children=[
                FooHeaderNode(title=headline),
                BarBadgeNode(tag=badge_tag),
                BarButtonNode(label=cta_label, action=on_cta),
            ]
        )

    @macro
    def ProductCard(name: str) -> builder_v1_0.Card:
        """Macro sharing its name with ProductCard primitive in catalog_a.json."""
        return builder_v1_0.Card(child=builder_v1_0.Text(text=f"Product: {name}"))

    @macro(name="BrandBox")
    def BrandBoxMacro(title: str) -> builder_v1_0.Card:
        """Macro wrapping a same-named BrandBox primitive from catalog_a.json."""
        return builder_v1_0.Card(
            child=BrandBoxNode(
                catalog_id=_CAT_A_CID,
                child=builder_v1_0.Text(text=title),
            )
        )

    @macro
    def InnerBadgeInherited(label: str) -> BrandBoxNode:
        """Deferred inner macro inheriting enclosing catalogId when surface catalog is registered."""
        return BrandBoxNode(
            catalog_id=_CAT_A_CID,
            child=builder_v1_0.Text(
                text=f"Inherited Badge: {label}", variant="caption"
            ),
        )

    @macro
    def OuterPanelInherited(title: str) -> builder_v1_0.Card:
        """Outer macro emitting unannotated deferred InnerBadgeInherited node."""
        return builder_v1_0.Card(
            child=builder_v1_0.Column(
                children=[
                    builder_v1_0.Text(text=title, variant="body"),
                    InnerBadgeInheritedNode(label=title),
                ]
            )
        )

    @macro
    def DeferredCycle(label: str) -> builder_v1_0.Card:
        """Deferred self-recursive macro node."""
        return builder_v1_0.Card(child=DeferredCycleV10Node(label=label))

    @macro
    def CycleA(label: str) -> builder_v1_0.Card:
        """Mutually recursive deferred macro A referencing CycleB."""
        return builder_v1_0.Card(child=CycleBNode(label=label))

    @macro
    def CycleB(label: str) -> builder_v1_0.Card:
        """Mutually recursive deferred macro B referencing CycleA."""
        return builder_v1_0.Card(child=CycleANode(label=label))

    @macro
    def EmitsSurface() -> FakeSurfaceNode:
        """Macro illegally emitting reserved Surface component in v1.0."""
        return FakeSurfaceNode()

    return {
        _BRAND_CID: [
            BrandText,
            UnannotatedBrandCard,
            BrandBadge,
            InnerBadgeScoped,
            OuterPanelScoped,
            BrandChart,
        ],
        _BRAND_SURFACE_CID: [
            BrandSurfaceText,
            BrandSurfaceBadge,
        ],
        _BAZ_MACROS_CID: [BazMacro],
        _CAT_B_CID: [
            ProductCard,
            BrandBoxMacro,
            InnerBadgeInherited,
            OuterPanelInherited,
            DeferredCycle,
            CycleA,
            CycleB,
            EmitsSurface,
        ],
    }


SCOPED_SUITE_MACROS = get_scoped_suite_macros()


def get_v1_0_suite_macros() -> list[Any]:
    """Builds and returns the suite's reference macros authored with ``a2ui.builder.v1_0``."""

    @macro
    def StatusBadge(status: str, title: str) -> builder_v1_0.Card:
        """Status badge with uppercase status and title."""
        return builder_v1_0.Card(
            child=builder_v1_0.Row(
                children=[
                    builder_v1_0.Text(text=status.upper(), variant="caption"),
                    builder_v1_0.Text(text=title, variant="body"),
                ]
            )
        )

    @macro
    def SlotContainer(
        title: str, content: builder_v1_0.ComponentBuilderNode
    ) -> builder_v1_0.Card:
        """Container accepting an external child slot."""
        return builder_v1_0.Card(
            child=builder_v1_0.Column(
                children=[
                    builder_v1_0.Text(text=title, variant="body"),
                    content,
                ]
            )
        )

    @macro
    def MultiSlotContainer(
        header: str, items: Sequence[builder_v1_0.ComponentBuilderNode]
    ) -> builder_v1_0.Card:
        """Container accepting a list of child slots."""
        children: list[builder_v1_0.ComponentBuilderNode] = [
            builder_v1_0.Text(text=header, variant="body")
        ]
        children.extend(items)
        return builder_v1_0.Card(child=builder_v1_0.Column(children=children))

    @macro
    def ActionButton(label: str, action: builder_v1_0.Action) -> builder_v1_0.Button:
        """Button with coerced action."""
        return builder_v1_0.Button(
            child=builder_v1_0.Text(text=label),
            action=action,
            variant="primary",
        )

    @macro
    def BoundMetric(label: str, value: builder_v1_0.DynamicString) -> builder_v1_0.Card:
        """Metric card displaying a dynamic value."""
        return builder_v1_0.Card(
            child=builder_v1_0.Column(
                children=[
                    builder_v1_0.Text(text=label, variant="caption"),
                    builder_v1_0.Text(text=value, variant="body"),
                ]
            )
        )

    @macro
    def ConfigCard(name: str, port: int, active: bool) -> builder_v1_0.Card:
        """Configuration card displaying primitives and metadata."""
        return builder_v1_0.Card(
            child=builder_v1_0.Column(
                children=[
                    builder_v1_0.Text(text=name, variant="body"),
                    builder_v1_0.Text(text=f"Port: {port}", variant="body"),
                    builder_v1_0.Text(
                        text=f"Active: {str(active).lower()}", variant="body"
                    ),
                ]
            )
        )

    @macro
    def NestedMacroCard(title: str, status: str) -> builder_v1_0.Card:
        """Macro composing another macro."""
        return builder_v1_0.Card(
            child=builder_v1_0.Column(
                children=[
                    builder_v1_0.Text(text=title, variant="body"),
                    StatusBadge(status=status, title=f"{title} Status"),
                ]
            )
        )

    @macro
    def RecursiveCard(title: str) -> builder_v1_0.Card:
        """Macro composing itself recursively."""
        return builder_v1_0.Card(child=RecursiveCard(title=title))

    @macro
    def ComplexCard(
        title: str,
        dynamic_title: builder_v1_0.DynamicString,
        metric: builder_v1_0.DynamicNumber,
        is_active: builder_v1_0.DynamicBoolean,
        tags: builder_v1_0.DynamicStringList,
        anything: builder_v1_0.DynamicValue,
        on_click: builder_v1_0.Action,
        checks: Sequence[builder_v1_0.CheckRule],
        accessibility: builder_v1_0.AccessibilityAttributes,
        footer: builder_v1_0.ComponentRef,
        items: Sequence[builder_v1_0.ComponentBuilderNode],
        theme: Literal["primary", "secondary"],
    ) -> builder_v1_0.Card:
        """Card testing protocol common types in macro parameter schemas."""
        return builder_v1_0.Card(child=builder_v1_0.Text(text=title))

    @macro
    def PayloadButton(
        label: str,
        event_name: str,
        payload: builder_v1_0.DynamicValue,
        extra: builder_v1_0.DynamicValue,
    ) -> builder_v1_0.Button:
        """Button sending dynamic payload values inside an Action event context."""
        return builder_v1_0.Button(
            child=builder_v1_0.Text(text=label),
            variant="primary",
            action=builder_v1_0.Action(
                event=builder_v1_0.ActionEvent(
                    name=event_name,
                    context={"payload": payload, "extra": extra},
                )
            ),
        )

    @macro
    def DynamicFormCard(
        label: str,
        placeholder: builder_v1_0.DynamicString,
        items: builder_v1_0.ChildList,
        checks: Sequence[builder_v1_0.CheckRule],
        on_submit: builder_v1_0.Action,
    ) -> builder_v1_0.Card:
        """Form card with dynamic child list, check rules, and submit action."""
        return builder_v1_0.Card(
            child=builder_v1_0.Column(
                children=[
                    builder_v1_0.TextField(
                        label=label,
                        value=builder_v1_0.DataBinding(path="/form/email"),
                        placeholder=placeholder,
                        checks=list(checks),
                    ),
                    builder_v1_0.List(children=items),
                    builder_v1_0.Button(
                        child=builder_v1_0.Text(text="Submit"),
                        variant="primary",
                        action=on_submit,
                    ),
                ]
            )
        )

    @macro
    def AnnotatedBadge(status: str, title: str) -> builder_v1_0.Card:
        """Status badge whose root Card defines default accessibility and metadata extensions."""
        return builder_v1_0.Card(
            child=builder_v1_0.Row(
                children=[
                    builder_v1_0.Text(text=status.upper(), variant="caption"),
                    builder_v1_0.Text(text=title, variant="body"),
                ]
            ),
            accessibility=builder_v1_0.AccessibilityAttributes(
                description="Default badge description"
            ),
            extensions={"macroMeta": {"source": "AnnotatedBadge"}},
        )

    @macro
    def DeclaredA11yCard(
        title: str,
        accessibility: builder_v1_0.AccessibilityAttributes | None = None,
    ) -> builder_v1_0.Card:
        """Card declaring accessibility as an explicit macro parameter."""
        a11y_label = (
            f"Custom: {accessibility.label}"
            if accessibility is not None and isinstance(accessibility.label, str)
            else "Internal"
        )
        return builder_v1_0.Card(
            child=builder_v1_0.Text(text=title),
            accessibility=builder_v1_0.AccessibilityAttributes(label=a11y_label),
        )

    @macro
    def WeightedCard(label: str, weight: float | None = None) -> builder_v1_0.Card:
        """Card declaring weight as an explicit macro parameter."""
        return builder_v1_0.Card(
            child=builder_v1_0.Text(text=label),
            weight=weight,
        )

    @macro
    def PositiveCountCard(count: int) -> builder_v1_0.Card:
        """Card raising ValidationError when count is negative."""
        if count < 0:
            raise A2uiValidationError("count must be non-negative")
        return builder_v1_0.Card(child=builder_v1_0.Text(text=f"Count: {count}"))

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
        PayloadButton,
        DynamicFormCard,
        AnnotatedBadge,
        DeclaredA11yCard,
        WeightedCard,
        PositiveCountCard,
    ]


SUITE_MACROS_V1_0 = get_v1_0_suite_macros()


# =============================================================================
# Catalog Resolution & Execution
# =============================================================================

_catalogs_by_version: dict[str, CatalogApi] = {}
_custom_catalogs_by_id: dict[str, CatalogApi] = {}


def basic_catalog_schema(version: str = PROTOCOL_VERSION) -> CatalogApi:
    """Loads the basic catalog for the requested protocol version, memoized."""
    if version not in _catalogs_by_version:
        # BasicCatalog serves v0.9.1 with the v0.9 catalog, which reports v0.9,
        # so the catalog is parsed again for the version under test.
        basic = BasicCatalog(version)
        _catalogs_by_version[version] = Catalog.from_json(
            catalog_schema=basic.validation_schema,
            protocol_version=version,
            catalog_id=basic.catalog_id,
        )
    return _catalogs_by_version[version]


def resolve_catalog(catalog_id: str, default_version: str) -> CatalogApi:
    """Resolves a catalog ID from ``custom_catalogs`` or the bundled basic catalog."""
    if catalog_id in CUSTOM_CATALOG_SCHEMAS:
        if catalog_id not in _custom_catalogs_by_id:
            schema = copy.deepcopy(CUSTOM_CATALOG_SCHEMAS[catalog_id])
            version = str(schema.get("protocolVersion", default_version))
            _custom_catalogs_by_id[catalog_id] = Catalog.from_json(
                catalog_schema=schema,
                protocol_version=version,
                catalog_id=catalog_id,
            )
        return _custom_catalogs_by_id[catalog_id]

    if catalog_id == _V1_0_BASIC_CID:
        return basic_catalog_schema("1.0")
    if catalog_id == _V0_9_BASIC_CID:
        return basic_catalog_schema(PROTOCOL_VERSION)

    base = basic_catalog_schema(default_version)
    if catalog_id == getattr(base, "catalog_id", None):
        return base
    alias_cat = copy.copy(base)
    alias_cat.catalog_id = catalog_id
    return alias_cat


def _case_catalog_version(case: Case) -> str:
    """Returns the catalog protocol version string for ``case``."""
    return (
        "1.0"
        if case.envelope_version and to_version_number(case.envelope_version) == "1.0"
        else PROTOCOL_VERSION
    )


def _case_macro_version(case: Case) -> str:
    """Returns the macro builder version string for ``case``."""
    raw = case.macro_version or case.envelope_version
    return "1.0" if raw and to_version_number(raw) == "1.0" else PROTOCOL_VERSION


def _select_macros(case: Case) -> list[Any]:
    """Returns the macro functions to register on ``MacroExpander`` for ``case``."""
    if case.empty_macros:
        return []

    if case.colliding_macro:
        if _case_macro_version(case) == "1.0":

            @macro(name=case.colliding_macro)
            def CollidingMacroV10() -> builder_v1_0.Card:
                return builder_v1_0.Card(child=builder_v1_0.Text(text="colliding"))

            return [CollidingMacroV10]

        @macro(name=case.colliding_macro)
        def CollidingMacro() -> Card:
            return Card(child=Text(text="colliding"))

        return [CollidingMacro]

    if case.macro_catalog_id:
        scoped_macros = SCOPED_SUITE_MACROS.get(case.macro_catalog_id)
        if scoped_macros is None:
            raise KeyError(
                f"No scoped macros registered for catalog_id={case.macro_catalog_id!r}."
            )
        return scoped_macros

    return SUITE_MACROS_V1_0 if _case_macro_version(case) == "1.0" else SUITE_MACROS


def _build_expander(case: Case) -> MacroExpander:
    """Constructs a configured ``MacroExpander`` for ``case``."""
    macros_list = _select_macros(case)
    exp_cid = case.expander_catalog_id or (
        case.macro_catalog_id if case.expander_scoped else None
    )
    default_ver = _case_catalog_version(case)
    base_cats = (
        [resolve_catalog(cid, default_ver) for cid in case.base_catalogs]
        if case.base_catalogs
        else None
    )
    return MacroExpander(
        macros_list,
        passthrough_components=case.passthrough_components,
        catalog_id=exp_cid,
        base_catalogs=base_cats,
        protocol_version=case.expander_protocol_version,
        on_error=case.on_error,
    )


def run_case(case: Case) -> Any:
    """Runs a conformance case through MacroExpander."""
    if case.action == "to_catalog":
        expander = _build_expander(case)
        return expander.to_catalog()

    if case.action == "transform_catalog":
        expander = _build_expander(case)
        expander.transform_to_inference_catalog(
            basic_catalog_schema(_case_catalog_version(case))
        )
        return []

    if case.action == "transform_to_inference_catalog":
        expander = _build_expander(case)
        return expander.transform_to_inference_catalog(
            basic_catalog_schema(_case_catalog_version(case))
        )

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

    if case.messages is not None:
        raw_msgs = copy.deepcopy(case.messages)
    else:
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

    expander = _build_expander(case)
    expanded_msgs = expander.transform_to_transport(
        typed_raw_msgs,
        surface_catalogs=case.surface_catalogs,
    )
    return [m.model_dump(by_alias=True, exclude_none=True) for m in expanded_msgs]


# =============================================================================
# Validation
# =============================================================================


def validate_payload(payload: list[dict[str, Any]], case: Case) -> None:
    """Validates ``payload`` against the active catalogs and topology rules."""
    if case.validation.skip_renderer_validation:
        return
    config = case.validation.to_config()
    has_create = any(isinstance(m, dict) and "createSurface" in m for m in payload)
    version = _case_catalog_version(case)
    if case.validation_catalogs:
        catalogs = [resolve_catalog(cid, version) for cid in case.validation_catalogs]
    else:
        catalogs = [basic_catalog_schema(version)]
        if case.catalog_id and case.catalog_id != getattr(
            catalogs[0], "catalog_id", None
        ):
            catalogs.append(resolve_catalog(case.catalog_id, version))

    processor = MessageProcessor(
        catalogs,
        options=MessageProcessorOptions(validation_config=config),
    )
    if not has_create:
        default_cat: CatalogApi | None = catalogs[0]
        if (
            case.surface_catalogs is not None
            and case.surface_id in case.surface_catalogs
        ):
            seeded_cid = case.surface_catalogs[case.surface_id]
            default_cat = resolve_catalog(seeded_cid, version) if seeded_cid else None
        processor.model.add_surface(
            SurfaceModel(
                surface_id=case.surface_id,
                default_catalog=default_cat,
            )
        )
    processor.process_messages(payload)
