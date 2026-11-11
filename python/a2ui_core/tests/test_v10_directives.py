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

"""Unit tests for v1.0 @child, @action, @functionCall, dual-read, and @@ unescaping."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
import pytest

from a2ui.core import (
    Catalog,
    ComponentModel,
    DataContext,
    DataModel,
    MessageProcessor,
    MessageProcessorOptions,
    NodeResolver,
    PayloadValidator,
    STRICT_VALIDATION,
    SurfaceModel,
    ValidationConfig,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.catalog import (
    FunctionImplementation,
    ModelComponentApi,
    analyze_child_ref_schema,
    create_function_implementation,
)
from a2ui.core.exceptions import (
    A2uiIntegrityError,
    A2uiRecursionError,
    A2uiValidationError,
)
from a2ui.core.resolution import (
    ComponentContext,
    GenericBinder,
    ResolvedBinding,
    WritableBinding,
    is_component_node,
    is_writable,
)
from a2ui.core.state import validate_composition_constraints


_CATALOG_V1_PATH = (
    Path(__file__).resolve().parents[3] / "catalogs" / "basic" / "v1" / "catalog.json"
)


def _load_basic_v1_catalog_json() -> dict[str, Any]:
    return json.loads(_CATALOG_V1_PATH.read_text(encoding="utf-8"))


class _AtChildSingle(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")
    at_child: str = Field(alias="@child")


class _AtChildListStatic(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")
    at_child: list[str] = Field(alias="@child")


class _AtChildListTemplate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")
    at_child: str = Field(alias="@child")
    at_path: str = Field(alias="@path")


class _AtActionWrapper(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")
    at_action: dict[str, Any] = Field(alias="@action")


class _PydanticAtChildProps(BaseModel):
    """Custom component using PR 2-style @child and @action schema shapes."""

    model_config = ConfigDict(extra="forbid")
    id: str
    component: Literal["AtCard"] = "AtCard"
    header: _AtChildSingle
    children: _AtChildListStatic | _AtChildListTemplate
    onSubmit: _AtActionWrapper | None = None


def _make_at_schema_catalog(
    *,
    with_executors: bool = False,
    recorded_calls: list[dict[str, Any]] | None = None,
) -> Catalog:
    """Builds a v1.0 catalog with PR 2-style @ schemas, constraints, and open types."""
    schema: dict[str, Any] = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": "https://example.com/at-schema-catalog/v1",
        "components": {
            "AtBox": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "component"],
                "properties": {
                    "id": {"type": "string"},
                    "component": {"const": "AtBox"},
                    "header": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["@child"],
                        "properties": {"@child": {"type": "string"}},
                    },
                    "children": {
                        "oneOf": [
                            {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["@child"],
                                "properties": {
                                    "@child": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                    }
                                },
                            },
                            {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["@child", "@path"],
                                "properties": {
                                    "@child": {"type": "string"},
                                    "@path": {"type": "string"},
                                },
                            },
                        ]
                    },
                    "tabs": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["title", "child"],
                            "properties": {
                                "title": {"type": "string"},
                                "child": {
                                    "type": "object",
                                    "additionalProperties": False,
                                    "required": ["@child"],
                                    "properties": {"@child": {"type": "string"}},
                                },
                            },
                        },
                    },
                    "onPress": {
                        "oneOf": [
                            {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["@action"],
                                "properties": {
                                    "@action": {
                                        "type": "object",
                                        "required": ["name"],
                                        "properties": {
                                            "name": {"type": "string"},
                                        },
                                    }
                                },
                            },
                            {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["@functionCall"],
                                "properties": {
                                    "@functionCall": {
                                        "type": "object",
                                        "required": ["@call"],
                                        "properties": {
                                            "@call": {"type": "string"},
                                            "args": {"type": "object"},
                                        },
                                    }
                                },
                            },
                        ]
                    },
                },
                "allowedChildren": ["LeafItem"],
            },
            "LeafItem": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "component"],
                "properties": {
                    "id": {"type": "string"},
                    "component": {"const": "LeafItem"},
                    "label": {"$ref": "common_types.json#/$defs/DynamicString"},
                },
                "allowedParents": ["AtBox", "CustomShell"],
            },
            "DisallowedWidget": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "component"],
                "properties": {
                    "id": {"type": "string"},
                    "component": {"const": "DisallowedWidget"},
                    "text": {"type": "string"},
                },
            },
            "CustomShell": {
                "type": "object",
                "additionalProperties": True,
                "required": ["id", "component"],
                "properties": {
                    "id": {"type": "string"},
                    "component": {"const": "CustomShell"},
                },
            },
            "DynamicPropsCard": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "component"],
                "properties": {
                    "id": {"type": "string"},
                    "component": {"const": "DynamicPropsCard"},
                    "@checks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "condition": {},
                                "message": {"type": "string"},
                            },
                        },
                    },
                    "details": {
                        "$ref": "common_types.json#/$defs/DynamicValue",
                    },
                },
            },
        },
        "functions": [
            {
                "name": "formatLabel",
                "returnType": "string",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "value": {"$ref": "common_types.json#/$defs/DynamicString"},
                        "meta": {"type": "object"},
                    },
                },
            },
            {
                "name": "isPositive",
                "returnType": "boolean",
                "parameters": {
                    "type": "object",
                    "properties": {"value": {"type": "number"}},
                },
            },
            {
                "name": "sideEffectOp",
                "returnType": "void",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "tag": {"$ref": "common_types.json#/$defs/DynamicString"},
                    },
                },
            },
        ],
    }
    base = Catalog.from_json(schema, protocol_version="1.0")
    if not with_executors:
        return base

    calls = recorded_calls if recorded_calls is not None else []
    impls: list[FunctionImplementation[Any]] = [
        create_function_implementation(
            base.functions["formatLabel"],
            execute=lambda args, _ctx=None, _abort=None: (f"[{args.get('value', '')}]"),
        ),
        create_function_implementation(
            base.functions["isPositive"],
            execute=lambda args, _ctx=None, _abort=None: (
                float(args.get("value", 0)) > 0
            ),
        ),
        create_function_implementation(
            base.functions["sideEffectOp"],
            execute=lambda args, _ctx=None, _abort=None: (
                calls.append(dict(args)) or f"ran:{args.get('tag', '')}"
            ),
        ),
    ]
    return Catalog(
        catalog_id=base.catalog_id,
        protocol_version="1.0",
        components=list(base.components.values()),
        functions=impls,
        defs=dict(base.defs) if base.defs else None,
    )


class TestValidationV10Directives:
    """Validation of @child, @action, @functionCall, @@ escaping, and dual-read."""

    def test_at_child_valid_shapes(self) -> None:
        catalog = _make_at_schema_catalog()
        validator = PayloadValidator(catalog, config=STRICT_VALIDATION)

        validator.validate_component(
            {
                "id": "root",
                "component": "AtBox",
                "header": {"@child": "leaf1"},
                "children": {"@child": ["leaf1", "leaf2"]},
            },
            component_index=0,
            surface_id="s1",
        )
        validator.validate_component(
            {
                "id": "tpl_box",
                "component": "AtBox",
                "children": {"@child": "row_tpl", "@path": "/items"},
            },
            component_index=1,
            surface_id="s1",
        )

    @pytest.mark.parametrize(
        ("prop_name", "bad_val", "expected_path_suffix"),
        [
            ("header", {"@child": ""}, "/header/@child"),
            ("header", {"@child": 123}, "/header/@child"),
            ("header", {"@child": ["ok", ""]}, "/header/@child/1"),
            ("header", {"@child": "leaf1", "extra": 1}, "/header"),
            ("children", {"@child": ["leaf1"], "@path": "/items"}, "/children"),
            ("children", {"@child": "tpl", "@path": ""}, "/children/@path"),
            ("children", {"@child": "tpl", "@path": 42}, "/children/@path"),
        ],
    )
    def test_at_child_invalid_shapes_fail_with_pointer(
        self,
        prop_name: str,
        bad_val: dict[str, Any],
        expected_path_suffix: str,
    ) -> None:
        catalog = _make_at_schema_catalog()
        validator = PayloadValidator(catalog, config=STRICT_VALIDATION)
        comp: dict[str, Any] = {
            "id": "root",
            "component": "AtBox",
            prop_name: bad_val,
        }
        with pytest.raises(A2uiValidationError) as exc_info:
            validator.validate_component(comp, component_index=0, surface_id="s1")

        err = exc_info.value
        assert err.code == "VALIDATION_FAILED"
        assert err.path is not None
        assert expected_path_suffix in err.path

    def test_at_action_validation_and_nested_context_checks(self) -> None:
        catalog = _make_at_schema_catalog()
        validator = PayloadValidator(catalog, config=STRICT_VALIDATION)

        validator.validate_component(
            {
                "id": "root",
                "component": "AtBox",
                "onPress": {
                    "@action": {
                        "name": "save",
                        "userMessage": {
                            "@call": "formatLabel",
                            "args": {"value": {"@path": "/title"}},
                        },
                        "context": {
                            "id": {"@path": "/id"},
                            "@@child": "literal-escaped-key",
                            "@@action": {"nested": "ok"},
                        },
                    }
                },
            },
            component_index=0,
            surface_id="s1",
        )

        invalid_payloads: list[dict[str, Any]] = [
            {"@action": {"name": "save"}, "extra": True},
            {"@action": "save"},
            {"@action": {}},
            {"@action": {"name": ""}},
            {"@action": {"name": "save", "unknownField": 1}},
            {
                "@action": {
                    "name": "save",
                    "context": {"bad": {"@child": "c1"}},
                }
            },
            {
                "@action": {
                    "name": "save",
                    "context": {"bad": {"@action": {"name": "inner"}}},
                }
            },
            {
                "@action": {
                    "name": "save",
                    "context": {"bad": {"@functionCall": {"@call": "formatLabel"}}},
                }
            },
            {
                "@action": {
                    "name": "save",
                    "userMessage": {"@child": "c1"},
                }
            },
        ]
        for bad_action in invalid_payloads:
            with pytest.raises(A2uiValidationError) as exc_info:
                validator.validate_component(
                    {"id": "root", "component": "AtBox", "onPress": bad_action},
                    component_index=0,
                    surface_id="s1",
                )
            assert exc_info.value.code in {"VALIDATION_FAILED", "INVALID_RESERVED_KEY"}

    def test_at_function_call_validation(self) -> None:
        catalog = _make_at_schema_catalog()
        validator = PayloadValidator(catalog, config=STRICT_VALIDATION)

        validator.validate_component(
            {
                "id": "root",
                "component": "AtBox",
                "onPress": {
                    "@functionCall": {
                        "@call": "sideEffectOp",
                        "args": {"tag": {"@path": "/tag"}},
                    }
                },
            },
            component_index=0,
            surface_id="s1",
        )

        bad_calls: list[dict[str, Any]] = [
            {"@functionCall": {"@call": "sideEffectOp"}, "extra": 1},
            {"@functionCall": "sideEffectOp"},
            {"@functionCall": {"args": {"tag": "x"}}},
            {
                "@functionCall": {
                    "@call": "sideEffectOp",
                    "args": {"tag": {"@child": "nope"}},
                }
            },
        ]
        for bad_call in bad_calls:
            with pytest.raises(A2uiValidationError) as exc_info:
                validator.validate_component(
                    {"id": "root", "component": "AtBox", "onPress": bad_call},
                    component_index=0,
                    surface_id="s1",
                )
            assert exc_info.value.code in {"VALIDATION_FAILED", "INVALID_RESERVED_KEY"}

    def test_dynamic_value_positions_reject_component_directives_and_allow_escaped(
        self,
    ) -> None:
        catalog = _make_at_schema_catalog()
        validator = PayloadValidator(catalog, config=STRICT_VALIDATION)

        validator.validate_component(
            {
                "id": "card",
                "component": "DynamicPropsCard",
                "details": {
                    "@call": "formatLabel",
                    "args": {
                        "value": "ok",
                        "meta": {
                            "@@child": "literal",
                            "@@action": "literal",
                            "@@functionCall": "literal",
                        },
                    },
                },
                "@checks": [{
                    "condition": {"@call": "isPositive", "args": {"value": 1}},
                    "message": "must be positive",
                }],
            },
            component_index=0,
            surface_id="s1",
        )

        # Validate @checks directly on BasicCatalog("1.0") Checkable TextField as well
        basic_validator = PayloadValidator(
            BasicCatalog("1.0"), config=STRICT_VALIDATION
        )
        basic_validator.validate_component(
            {
                "id": "tf",
                "component": "TextField",
                "label": "Name",
                "value": {"@path": "/name"},
                "@checks": [{
                    "condition": {
                        "@call": "required",
                        "args": {"value": {"@path": "/name"}},
                    },
                    "message": "required",
                }],
            },
            component_index=0,
            surface_id="s1",
        )

        for directive_obj in (
            {"@child": "x"},
            {"@action": {"name": "go"}},
            {"@functionCall": {"@call": "formatLabel"}},
        ):
            with pytest.raises(A2uiValidationError):
                validator.validate_component(
                    {
                        "id": "card",
                        "component": "DynamicPropsCard",
                        "details": directive_obj,
                    },
                    component_index=0,
                    surface_id="s1",
                )

            with pytest.raises(A2uiValidationError):
                validator.validate_component(
                    {
                        "id": "card",
                        "component": "DynamicPropsCard",
                        "@checks": [
                            {"condition": directive_obj, "message": "bad check"}
                        ],
                    },
                    component_index=0,
                    surface_id="s1",
                )

            with pytest.raises(A2uiValidationError):
                basic_validator.validate_component(
                    {
                        "id": "tf",
                        "component": "TextField",
                        "label": "Name",
                        "@checks": [
                            {"condition": directive_obj, "message": "bad check"}
                        ],
                    },
                    component_index=0,
                    surface_id="s1",
                )

    @pytest.mark.parametrize("version", ["0.8", "0.9", "0.9.1"])
    def test_pre_v10_rejects_v10_at_directives(self, version: str) -> None:
        schema: dict[str, Any] = {
            "catalogId": f"https://example.com/pre-v10/{version}",
            "components": {
                "Text": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "component": {"const": "Text"},
                        "text": {"type": "string"},
                    },
                }
            },
        }
        catalog = Catalog.from_json(schema, protocol_version=version)
        validator = PayloadValidator(catalog, config=STRICT_VALIDATION)
        processor = MessageProcessor(catalogs=[catalog])

        for idx, bad_prop in enumerate((
            {"@child": "other"},
            {"@action": {"name": "click"}},
            {"@functionCall": {"call": "fn"}},
        )):
            comp: dict[str, Any] = (
                {"id": "root", "component": {"Text": {"child": bad_prop}}}
                if version == "0.8"
                else {"id": "root", "component": "Text", "child": bad_prop}
            )
            with pytest.raises(A2uiValidationError) as exc_info:
                validator.validate_component(
                    comp, component_index=0, surface_id="s_pre"
                )
            assert exc_info.value.code == "VALIDATION_FAILED"

            if version != "0.8":
                sid = f"s_pre_{idx}"
                with pytest.raises(A2uiValidationError) as proc_exc:
                    processor.process_messages([
                        {
                            "version": f"v{version}",
                            "createSurface": {
                                "surfaceId": sid,
                                "catalogId": catalog.catalog_id,
                                "sendDataModel": False,
                            },
                        },
                        {
                            "version": f"v{version}",
                            "updateComponents": {
                                "surfaceId": sid,
                                "components": [comp],
                            },
                        },
                    ])
                assert proc_exc.value.code == "VALIDATION_FAILED"

    @pytest.mark.parametrize("version", ["0.9", "0.9.1"])
    def test_pre_v10_allows_schema_declared_at_keys_and_rejects_undeclared_on_open_or_unknown(
        self, version: str
    ) -> None:
        schema: dict[str, Any] = {
            "catalogId": f"https://example.com/pre-v10-declared/{version}",
            "$defs": {
                "NestedCallRow": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "@functionCall": {"type": "string"},
                    },
                }
            },
            "components": {
                "PreDeclaredWidget": {
                    "type": "object",
                    "additionalProperties": True,
                    "properties": {
                        "id": {"type": "string"},
                        "component": {"const": "PreDeclaredWidget"},
                        "@child": {"type": "string"},
                        "config": {
                            "type": "object",
                            "additionalProperties": True,
                            "properties": {
                                "@action": {"type": "string"},
                            },
                        },
                        "items": {
                            "type": "array",
                            "items": {"$ref": "#/$defs/NestedCallRow"},
                        },
                    },
                },
                "PreOpenBox": {
                    "type": "object",
                    "additionalProperties": True,
                    "properties": {
                        "id": {"type": "string"},
                        "component": {"const": "PreOpenBox"},
                        "title": {"type": "string"},
                    },
                },
            },
        }
        catalog = Catalog.from_json(schema, protocol_version=version)
        allow_unknown_cfg = ValidationConfig(allow_unknown_elements=True)
        validator = PayloadValidator(catalog, config=allow_unknown_cfg)
        processor = MessageProcessor(
            catalogs=[catalog],
            options=MessageProcessorOptions(validation_config=allow_unknown_cfg),
        )

        # Schema-declared @child (top-level), @action (nested object), and
        # @functionCall (nested array item $ref) are allowed on pre-1.0.
        valid_declared = {
            "id": "root",
            "component": "PreDeclaredWidget",
            "@child": "custom-top",
            "config": {"@action": "custom-nested"},
            "items": [{"@functionCall": "custom-array-ref"}],
        }
        validator.validate_component(
            valid_declared, component_index=0, surface_id="s_ok"
        )
        processor.process_messages([
            {
                "version": f"v{version}",
                "createSurface": {
                    "surfaceId": "s_ok",
                    "catalogId": catalog.catalog_id,
                    "sendDataModel": False,
                },
            },
            {
                "version": f"v{version}",
                "updateComponents": {
                    "surfaceId": "s_ok",
                    "components": [valid_declared],
                },
            },
        ])

        # Undeclared @child/@action/@functionCall MUST fail on standalone
        # validate_component(..., allow_unknown=True) at BOTH root and nested paths
        # on open components, unknown components, and unannotated branches.
        rejected_cases = [
            {"id": "open_root", "component": "PreOpenBox", "@child": "x"},
            {"id": "open_nested", "component": "PreOpenBox", "extra": {"@action": "x"}},
            {"id": "unk_root", "component": "UnknownPreWidget", "@functionCall": "x"},
            {
                "id": "unk_nested",
                "component": "UnknownPreWidget",
                "nested": {"@child": "x"},
            },
            {
                "id": "decl_wrong_key_root",
                "component": "PreDeclaredWidget",
                "@action": "not_declared_at_root",
            },
            {
                "id": "decl_wrong_nested",
                "component": "PreDeclaredWidget",
                "config": {"@child": "not_declared_in_config"},
            },
        ]
        for idx, bad_comp in enumerate(rejected_cases):
            with pytest.raises(A2uiValidationError) as val_exc:
                validator.validate_component(
                    bad_comp, component_index=0, surface_id=f"s_bad_v_{idx}"
                )
            assert val_exc.value.code == "VALIDATION_FAILED"

            sid = f"s_bad_p_{idx}"
            with pytest.raises(A2uiValidationError) as proc_exc:
                processor.process_messages([
                    {
                        "version": f"v{version}",
                        "createSurface": {
                            "surfaceId": sid,
                            "catalogId": catalog.catalog_id,
                            "sendDataModel": False,
                        },
                    },
                    {
                        "version": f"v{version}",
                        "updateComponents": {
                            "surfaceId": sid,
                            "components": [bad_comp],
                        },
                    },
                ])
            assert proc_exc.value.code == "VALIDATION_FAILED"

    def test_dual_read_against_pr1_bare_schemas_and_pr2_at_schemas(self) -> None:
        # 1. PR 1 bare JSON catalog (catalogs/basic/v1/catalog.json): @ envelopes validate
        bare_json_catalog = Catalog.from_json(
            _load_basic_v1_catalog_json(), protocol_version="1.0"
        )
        bare_validator = PayloadValidator(bare_json_catalog, config=STRICT_VALIDATION)
        bare_validator.validate_component(
            {
                "id": "col",
                "component": "Column",
                "children": {"@child": ["t1"]},
            },
            component_index=0,
            surface_id="s1",
        )
        bare_validator.validate_component(
            {
                "id": "tabs",
                "component": "Tabs",
                "tabs": [{"title": "Tab A", "child": {"@child": "t1"}}],
            },
            component_index=1,
            surface_id="s1",
        )
        bare_validator.validate_component(
            {
                "id": "btn",
                "component": "Button",
                "child": {"@child": "t1"},
                "action": {"@action": {"name": "go"}},
            },
            component_index=2,
            surface_id="s1",
        )
        bare_validator.validate_component(
            {
                "id": "tabs_legacy",
                "component": "Tabs",
                "tabs": [{"title": "Tab B", "child": "t1"}],
            },
            component_index=3,
            surface_id="s1",
        )

        # 2. PR 1 Pydantic BasicCatalog("1.0"): @ envelopes validate via ComponentApi models
        pydantic_basic = BasicCatalog("1.0")
        pydantic_validator = PayloadValidator(pydantic_basic, config=STRICT_VALIDATION)
        pydantic_validator.validate_component(
            {
                "id": "col",
                "component": "Column",
                "children": {"@child": "row_tpl", "@path": "/items"},
            },
            component_index=0,
            surface_id="s1",
        )
        pydantic_validator.validate_component(
            {
                "id": "btn",
                "component": "Button",
                "child": {"@child": "t1"},
                "action": {
                    "@functionCall": {
                        "@call": "formatString",
                        "args": {"value": "x"},
                    }
                },
            },
            component_index=1,
            surface_id="s1",
        )

        # 3. PR 2-style @ JSON schema also accepts legacy bare Child/ChildList/Action
        at_json_catalog = _make_at_schema_catalog()
        at_validator = PayloadValidator(at_json_catalog, config=STRICT_VALIDATION)
        at_validator.validate_component(
            {
                "id": "legacy_at_box",
                "component": "AtBox",
                "header": "leaf1",
                "children": ["leaf1"],
                "tabs": [{"title": "One", "child": "leaf1"}],
                "onPress": {"event": {"name": "legacyClick"}},
            },
            component_index=0,
            surface_id="s1",
        )

        # 4. PR 2-style @ Pydantic ModelComponentApi also dual-reads bare legacy shapes
        pydantic_at_catalog = Catalog(
            catalog_id="https://example.com/pydantic-at/v1",
            protocol_version="1.0",
            components=[
                ModelComponentApi(
                    model_class=_PydanticAtChildProps,
                    name="AtCard",
                )
            ],
        )
        pydantic_at_validator = PayloadValidator(
            pydantic_at_catalog, config=STRICT_VALIDATION
        )
        pydantic_at_validator.validate_component(
            {
                "id": "c_bare",
                "component": "AtCard",
                "header": "child_a",
                "children": ["child_b"],
                "onSubmit": {"event": {"name": "go"}},
            },
            component_index=0,
            surface_id="s1",
        )
        pydantic_at_validator.validate_component(
            {
                "id": "c_at",
                "component": "AtCard",
                "header": {"@child": "child_a"},
                "children": {"@child": "tpl", "@path": "/rows"},
                "onSubmit": {"@action": {"name": "go"}},
            },
            component_index=1,
            surface_id="s1",
        )


class TestReferenceExtractionAndComposition:
    """Tests schema-less @child extraction, schema analysis, and composition constraints."""

    def test_analyze_child_ref_schema_recognizes_at_child_schemas(self) -> None:
        at_catalog = _make_at_schema_catalog()
        at_box_spec = analyze_child_ref_schema(at_catalog.components["AtBox"].schema)
        assert "header" in at_box_spec.single_refs
        assert "children" in at_box_spec.list_refs
        assert any("tabs" in path for path in at_box_spec.nested_refs)

        pydantic_spec = analyze_child_ref_schema(_PydanticAtChildProps)
        assert "header" in pydantic_spec.single_refs
        assert "children" in pydantic_spec.list_refs

        bare_catalog = BasicCatalog("1.0")
        col_spec = analyze_child_ref_schema(bare_catalog.components["Column"].schema)
        assert "children" in col_spec.list_refs

    def test_schemaless_extraction_nested_and_custom_slots(self) -> None:
        catalog = _make_at_schema_catalog()
        comp = ComponentModel(
            "shell",
            "CustomShell",
            catalog,
            {
                "header": {"@child": "head"},
                "listItems": {"@child": ["i0", "i1"]},
                "repeater": {"@child": "row_tpl", "@path": "/rows"},
                "sections": [{
                    "title": "Main",
                    "body": {"@child": "sec_body"},
                }],
                "plainString": "not_a_child_id",
                "@@child": "escaped_not_a_child",
                "@metadata": {"@child": "ignored_metadata_child"},
                "@accessibility": {"@child": "ignored_a11y_child"},
                "actionProp": {
                    "@action": {
                        "name": "doSomething",
                        "context": {"@@child": "also_ignored"},
                    }
                },
            },
        )
        refs = list(comp.get_child_references())
        assert ("head", "header") in refs
        assert ("i0", "listItems/0") in refs
        assert ("i1", "listItems/1") in refs
        assert ("row_tpl", "repeater/@child") in refs
        assert ("sec_body", "sections/0/body") in refs

        extracted_ids = {cid for cid, _ptr in refs}
        assert "not_a_child_id" not in extracted_ids
        assert "escaped_not_a_child" not in extracted_ids
        assert "ignored_metadata_child" not in extracted_ids
        assert "ignored_a11y_child" not in extracted_ids
        assert "also_ignored" not in extracted_ids

    def test_composition_constraints_clean_pointers_on_custom_and_nested_slots(
        self,
    ) -> None:
        catalog = _make_at_schema_catalog()
        root = ComponentModel(
            "root",
            "AtBox",
            catalog,
            {
                "header": {"@child": "bad"},
                "children": {"@child": ["leaf1"]},
                "tabs": [{"title": "T", "child": {"@child": "bad"}}],
            },
        )
        leaf = ComponentModel("leaf1", "LeafItem", catalog, {})
        bad = ComponentModel("bad", "DisallowedWidget", catalog, {})

        with pytest.raises(A2uiValidationError) as exc_info:
            validate_composition_constraints(
                {"root": root, "leaf1": leaf, "bad": bad},
                root_id="root",
                batch_index_map={"root": 0, "leaf1": 1, "bad": 2},
                surface_id="s1",
            )
        assert exc_info.value.code == "UNALLOWED_CHILD"
        assert exc_info.value.path == "/components/0/header"

        root_list_bad = ComponentModel(
            "root",
            "AtBox",
            catalog,
            {
                "header": {"@child": "leaf1"},
                "children": {"@child": ["leaf1", "bad"]},
            },
        )
        with pytest.raises(A2uiValidationError) as exc_info_list:
            validate_composition_constraints(
                {"root": root_list_bad, "leaf1": leaf, "bad": bad},
                root_id="root",
                batch_index_map={"root": 0, "leaf1": 1, "bad": 2},
                surface_id="s1",
            )
        assert exc_info_list.value.code == "UNALLOWED_CHILD"
        assert exc_info_list.value.path == "/components/0/children/1"

        root_tabs_bad = ComponentModel(
            "root",
            "AtBox",
            catalog,
            {
                "header": {"@child": "leaf1"},
                "tabs": [{"title": "T", "child": {"@child": "bad"}}],
            },
        )
        with pytest.raises(A2uiValidationError) as exc_info_tabs:
            validate_composition_constraints(
                {"root": root_tabs_bad, "leaf1": leaf, "bad": bad},
                root_id="root",
                batch_index_map={"root": 0, "leaf1": 1, "bad": 2},
                surface_id="s1",
            )
        assert exc_info_tabs.value.code == "UNALLOWED_CHILD"
        assert exc_info_tabs.value.path == "/components/0/tabs/0/child"

        open_parent = ComponentModel(
            "parent",
            "DisallowedWidget",
            catalog,
            {"slot": {"@child": "leaf1"}},
        )
        with pytest.raises(A2uiValidationError) as exc_info_parent:
            validate_composition_constraints(
                {"parent": open_parent, "leaf1": leaf},
                root_id="parent",
                batch_index_map={"parent": 0, "leaf1": 1},
                surface_id="s1",
            )
        assert exc_info_parent.value.code == "UNALLOWED_PARENT"
        assert exc_info_parent.value.path == "/components/1"

    def test_message_processor_allow_unknown_elements_tracks_schemaless_dangling_and_cycles(
        self,
    ) -> None:
        catalog = _make_at_schema_catalog()
        processor = MessageProcessor(
            catalogs=[catalog],
            options=MessageProcessorOptions(
                validation_config=ValidationConfig(
                    allow_dangling_references=False,
                    allow_unknown_elements=True,
                )
            ),
        )
        processor.process_messages([
            {
                "version": "1.0",
                "createSurface": {
                    "surfaceId": "s_dangling",
                    "catalogId": catalog.catalog_id,
                    "sendDataModel": False,
                },
            },
            {
                "version": "1.0",
                "createSurface": {
                    "surfaceId": "s_cycle",
                    "catalogId": catalog.catalog_id,
                    "sendDataModel": False,
                },
            },
        ])
        with pytest.raises(A2uiIntegrityError) as exc_dangling:
            processor.process_messages([{
                "version": "1.0",
                "updateComponents": {
                    "surfaceId": "s_dangling",
                    "components": [{
                        "id": "root",
                        "component": "CustomShell",
                        "customSlot": {"@child": "missing_child"},
                    }],
                },
            }])
        assert exc_dangling.value.code == "INTEGRITY_ERROR"
        assert "missing_child" in str(exc_dangling.value)

        with pytest.raises(A2uiRecursionError) as exc_cycle:
            processor.process_messages([{
                "version": "1.0",
                "updateComponents": {
                    "surfaceId": "s_cycle",
                    "components": [
                        {
                            "id": "root",
                            "component": "CustomShell",
                            "nested": {"slot": {"@child": "child_a"}},
                        },
                        {
                            "id": "child_a",
                            "component": "CustomShell",
                            "back": {"@child": "root"},
                        },
                    ],
                },
            }])
        assert exc_cycle.value.code == "RECURSION_LIMIT_EXCEEDED"


class TestResolutionAndNodeResolverV10:
    """Tests DataContext, GenericBinder, and NodeResolver for @ directives and @@ unescaping."""

    def test_data_context_rejects_unescaped_directives_and_unescapes_double_at(
        self,
    ) -> None:
        catalog = _make_at_schema_catalog()
        surface = SurfaceModel(
            "s_ctx",
            catalog,
            data_model=DataModel({"user": "Ada"}),
            protocol_version="1.0",
        )
        ctx = DataContext(surface, "/")

        for bad in (
            {"@child": "c1"},
            {"@action": {"name": "go"}},
            {"@functionCall": {"@call": "fn"}},
        ):
            with pytest.raises(A2uiValidationError):
                ctx.resolve_dynamic_value(bad)
            with pytest.raises(A2uiValidationError):
                ctx.subscribe_dynamic_state(bad, lambda _s, _p: None)

        unescaped = ctx.resolve_dynamic_value({
            "@@child": "literal-child",
            "@@action": {"name": "not-an-action"},
            "@@functionCall": {"@path": "/user"},
            "@@path": "literal-path",
        })
        assert unescaped == {
            "@child": "literal-child",
            "@action": {"name": "not-an-action"},
            "@functionCall": "Ada",
            "@path": "literal-path",
        }

    def test_generic_binder_v10_directives_deferred_actions_and_reactive_templates(
        self,
    ) -> None:
        recorded_calls: list[dict[str, Any]] = []
        catalog = _make_at_schema_catalog(
            with_executors=True,
            recorded_calls=recorded_calls,
        )
        open_schema = catalog.components["CustomShell"].schema
        surface = SurfaceModel(
            "s_bind",
            catalog,
            data_model=DataModel(
                {"items": [{"name": "First"}, {"name": "Second"}], "tag": "t1"}
            ),
            protocol_version="1.0",
        )
        ctx = DataContext(surface, "/")
        dispatched: list[dict[str, Any]] = []
        comp = ComponentModel(
            "root",
            "CustomShell",
            catalog,
            {
                "header": {"@child": "hdr"},
                "items": {"@child": "row_tpl", "@path": "/items"},
                "onTap": {
                    "@action": {
                        "name": "tap",
                        "context": {
                            "tag": {"@path": "/tag"},
                            "formatted": {
                                "@call": "formatLabel",
                                "args": {"value": {"@path": "/tag"}},
                            },
                        },
                    }
                },
                "onCall": {
                    "@functionCall": {
                        "@call": "sideEffectOp",
                        "args": {"tag": {"@path": "/tag"}},
                    }
                },
                "meta": {"@@child": "escaped", "@@action": "escaped_act"},
            },
        )

        binder = GenericBinder(
            ComponentContext(
                comp,
                ctx,
                dispatch_action_callback=lambda action, _meta=None: dispatched.append(
                    action
                ),
            ),
            schema=open_schema,
            expand_templates=False,
        )
        props = binder.snapshot
        assert props["header"] == "hdr"
        assert props["items"] == [
            {"id": "row_tpl", "basePath": "/items/0"},
            {"id": "row_tpl", "basePath": "/items/1"},
        ]
        assert props["meta"] == {"@child": "escaped", "@action": "escaped_act"}

        # Neither @action nor @functionCall executed eagerly at bind time
        assert recorded_calls == []
        assert dispatched == []
        assert callable(props["onTap"])
        assert callable(props["onCall"])

        props["onTap"]()
        assert len(dispatched) == 1
        assert dispatched[0]["@action"]["name"] == "tap"
        assert dispatched[0]["@action"]["context"] == {
            "tag": "t1",
            "formatted": "[t1]",
        }

        fn_res = props["onCall"]()
        assert fn_res == "ran:t1"
        assert recorded_calls == [{"tag": "t1"}]

        # Reactive template update on DataModel mutation
        surface.data_model.set("/items", [{"name": "OnlyOne"}])
        assert binder.snapshot["items"] == [
            {"id": "row_tpl", "basePath": "/items/0"},
        ]

        # Legacy bare Child / ChildList / Action dual-read against @ schema
        at_schema = catalog.components["AtBox"].schema
        legacy_comp = ComponentModel(
            "legacy_box",
            "AtBox",
            catalog,
            {
                "header": "hdr",
                "children": {"componentId": "row_tpl", "path": "/items"},
                "onPress": {
                    "event": {
                        "name": "legacy_tap",
                        "context": {"tag": {"@path": "/tag"}},
                    }
                },
            },
        )
        legacy_binder = GenericBinder(
            ComponentContext(
                legacy_comp,
                ctx,
                dispatch_action_callback=lambda action, _meta=None: dispatched.append(
                    action
                ),
            ),
            schema=at_schema,
            expand_templates=True,
        )
        legacy_props = legacy_binder.snapshot
        assert legacy_props["header"] == "hdr"
        assert legacy_props["children"] == [
            {"id": "row_tpl", "basePath": "/items/0"},
        ]
        legacy_props["onPress"]()
        assert len(dispatched) == 2
        assert dispatched[1]["event"]["name"] == "legacy_tap"
        assert dispatched[1]["event"]["context"] == {"tag": "t1"}

        # Pre-1.0 surface keeps permanent {componentId, path} and {event} support
        pre_schema: dict[str, Any] = {
            "catalogId": "https://example.com/pre-binder/0.9",
            "components": {
                "PreShell": {
                    "type": "object",
                    "additionalProperties": True,
                    "properties": {
                        "id": {"type": "string"},
                        "component": {"const": "PreShell"},
                    },
                }
            },
        }
        pre_cat = Catalog.from_json(pre_schema, protocol_version="0.9")
        pre_surface = SurfaceModel(
            "s_pre_bind",
            pre_cat,
            data_model=DataModel({"items": [{"name": "A"}], "tag": "pre_tag"}),
            protocol_version="0.9",
        )
        pre_ctx = DataContext(pre_surface, "/")
        pre_comp = ComponentModel(
            "root",
            "PreShell",
            pre_cat,
            {
                "items": {"componentId": "row_tpl", "path": "/items"},
                "onPress": {
                    "event": {"name": "pre_tap", "context": {"tag": {"path": "/tag"}}}
                },
            },
        )
        pre_dispatched: list[dict[str, Any]] = []
        pre_binder = GenericBinder(
            ComponentContext(
                pre_comp,
                pre_ctx,
                dispatch_action_callback=lambda action, _meta=None: pre_dispatched.append(
                    action
                ),
            ),
            schema=pre_cat.components["PreShell"].schema,
            expand_templates=True,
        )
        pre_props = pre_binder.snapshot
        assert pre_props["items"] == [{"id": "row_tpl", "basePath": "/items/0"}]
        pre_props["onPress"]()
        assert len(pre_dispatched) == 1
        assert pre_dispatched[0]["event"]["name"] == "pre_tap"
        assert pre_dispatched[0]["event"]["context"] == {"tag": "pre_tag"}

    def test_node_resolver_open_component_mounts_tree_bindings_and_deferred_actions(
        self,
    ) -> None:
        recorded_calls: list[dict[str, Any]] = []
        dispatched_actions: list[Any] = []
        catalog = _make_at_schema_catalog(
            with_executors=True,
            recorded_calls=recorded_calls,
        )
        processor = MessageProcessor(
            catalogs=[catalog],
            action_handler=dispatched_actions.append,
            options=MessageProcessorOptions(
                validation_config=ValidationConfig(allow_dangling_references=True)
            ),
        )
        processor.process_messages([
            {
                "version": "1.0",
                "createSurface": {
                    "surfaceId": "s1",
                    "catalogId": catalog.catalog_id,
                    "sendDataModel": False,
                },
            },
            {
                "version": "1.0",
                "updateDataModel": {
                    "surfaceId": "s1",
                    "path": "/",
                    "value": {
                        "title": "Hello",
                        "rows": [{"text": "R1"}, {"text": "R2"}],
                    },
                },
            },
            {
                "version": "1.0",
                "updateComponents": {
                    "surfaceId": "s1",
                    "components": [
                        {
                            "id": "root",
                            "component": "CustomShell",
                            "titleBind": {"@path": "/title"},
                            "formatted": {
                                "@call": "formatLabel",
                                "args": {"value": {"@path": "/title"}},
                            },
                            "header": {"@child": "hdr"},
                            "list": {"@child": ["hdr", "missing_id"]},
                            "rows": {"@child": "row_tpl", "@path": "/rows"},
                            "sections": [{"body": {"@child": "sec"}}],
                            "onTrigger": {
                                "@functionCall": {
                                    "@call": "sideEffectOp",
                                    "args": {"tag": {"@path": "/title"}},
                                }
                            },
                            "onEvent": {
                                "@action": {
                                    "name": "clicked",
                                    "context": {"t": {"@path": "/title"}},
                                }
                            },
                            "@@child": "literal-at-child",
                            "nestedEscaped": {"@@action": "literal-at-action"},
                        },
                        {
                            "id": "hdr",
                            "component": "LeafItem",
                            "label": "Header",
                        },
                        {
                            "id": "sec",
                            "component": "LeafItem",
                            "label": "Section",
                        },
                        {
                            "id": "row_tpl",
                            "component": "LeafItem",
                            "label": {"@path": "text"},
                        },
                    ],
                },
            },
        ])

        surface = processor.model.get_surface("s1")
        assert surface is not None
        resolver = NodeResolver(surface, catalog)
        root = resolver.root
        assert root is not None
        assert root.type == "CustomShell"

        # Unschematized @path -> WritableBinding (supports writeback)
        title_binding = root.props["titleBind"]
        assert is_writable(title_binding)
        assert isinstance(title_binding, WritableBinding)
        assert title_binding.value == "Hello"
        title_binding.set("Updated")
        assert surface.data_model.get("/title") == "Updated"

        # Unschematized @call -> ResolvedBinding
        formatted = root.props["formatted"]
        assert isinstance(formatted, ResolvedBinding)
        assert formatted.value == "[Updated]"

        # Schema-less @child mounting: single, list (including pending placeholder), template, nested
        header_node = root.props["header"]
        assert is_component_node(header_node)
        assert header_node.component_id == "hdr"

        list_nodes = root.props["list"]
        assert isinstance(list_nodes, list)
        assert len(list_nodes) == 2
        assert list_nodes[0].component_id == "hdr"
        assert list_nodes[1].state == "pending"

        row_nodes = root.props["rows"]
        assert isinstance(row_nodes, list)
        assert [n.props["label"].value for n in row_nodes] == ["R1", "R2"]

        nested_body = root.props["sections"][0]["body"]
        assert is_component_node(nested_body)
        assert nested_body.component_id == "sec"

        # Escaped @@ keys preserved with single-@ key literals
        assert root.props["@child"] == "literal-at-child"
        assert root.props["nestedEscaped"] == {"@action": "literal-at-action"}

        # Deferred @action and @functionCall do not fire eagerly
        assert recorded_calls == []
        assert dispatched_actions == []
        assert callable(root.props["onTrigger"])
        assert callable(root.props["onEvent"])
        assert root.props["onTrigger"]() == "ran:Updated"
        assert recorded_calls == [{"tag": "Updated"}]
        root.props["onEvent"]()
        assert len(dispatched_actions) == 1
        assert dispatched_actions[0]["name"] == "clicked"
        assert dispatched_actions[0]["context"] == {"t": "Updated"}

    def test_node_resolver_placeholders_for_unknown_type_and_cycle_via_at_child(
        self,
    ) -> None:
        catalog = _make_at_schema_catalog()
        surface = SurfaceModel("s_placeholders", catalog, protocol_version="1.0")
        root_comp = ComponentModel(
            "root",
            "CustomShell",
            catalog,
            {
                "unknownSlot": {"@child": "alien"},
                "selfLoop": {"@child": "root"},
            },
        )
        alien_comp = ComponentModel(
            "alien",
            "NonExistentWidget",
            catalog,
            {},
        )
        surface.components_model.add_component(root_comp)
        surface.components_model.add_component(alien_comp)
        resolver = NodeResolver(surface, catalog)
        root = resolver.root
        assert root is not None
        assert root.props["unknownSlot"].state == "unknown-type"
        assert root.props["selfLoop"].state == "cyclic"
