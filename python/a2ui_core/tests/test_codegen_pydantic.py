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

import ast
import os
import sys
import tempfile
import pytest

# Add the skill scripts directory to sys.path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_SCRIPT_PATH = os.path.abspath(
    os.path.join(
        SCRIPT_DIR, "../../../.agents/skills/a2ui-generate-pydantic-models/scripts"
    )
)
if SKILL_SCRIPT_PATH not in sys.path:
    sys.path.insert(0, SKILL_SCRIPT_PATH)

import codegen_pydantic


def test_ensure_v_prefix():
    assert codegen_pydantic._ensure_v_prefix("v1.1") == "v1.1"
    assert codegen_pydantic._ensure_v_prefix("1.2") == "v1.2"
    assert codegen_pydantic._ensure_v_prefix("V0.9") == "V0.9"
    with pytest.raises(ValueError, match="version is required"):
        codegen_pydantic._ensure_v_prefix("")


def test_version_to_underscore():
    assert codegen_pydantic._version_to_underscore("v1.1") == "v1_1"
    assert codegen_pydantic._version_to_underscore("1.2") == "v1_2"
    assert codegen_pydantic._version_to_underscore("v0.9.1") == "v0_9_1"
    assert codegen_pydantic._version_to_underscore("v2.0") == "v2_0"


def test_is_modern_terminology():
    assert not codegen_pydantic._is_modern_terminology("v0_8")
    assert not codegen_pydantic._is_modern_terminology("v0_9")
    assert not codegen_pydantic._is_modern_terminology("v0_9_1")
    assert codegen_pydantic._is_modern_terminology("v1_0")
    assert codegen_pydantic._is_modern_terminology("v2_0")
    assert codegen_pydantic._is_modern_terminology("v0_9", "agent_to_renderer.json")


def test_map_json_type_to_python():
    codegen = codegen_pydantic.PydanticCodegen("v0.9")

    # Ref mappings
    assert (
        codegen.map_json_type_to_python(
            "id", {"$ref": "common_types.json#/$defs/ComponentId"}
        )
        == "ComponentId"
    )
    assert (
        codegen.map_json_type_to_python(
            "val", {"$ref": "common_types.json#/$defs/DynamicString"}
        )
        == "DynamicString"
    )
    assert (
        codegen.map_json_type_to_python(
            "common", {"$ref": "#/$defs/CatalogComponentCommon"}
        )
        == "CatalogComponentCommon"
    )
    assert (
        codegen.map_json_type_to_python(
            "unknown", {"$ref": "other.json#/$defs/Unknown"}
        )
        == "Any"
    )
    assert (
        codegen.map_json_type_to_python(
            "comp", {"$ref": "common_types.json#/$defs/Component"}
        )
        == "dict[str, Any]"
    )
    assert (
        codegen.map_json_type_to_python(
            "custom_comp", {"$ref": "common_types.json#/$defs/DeletedComponent"}
        )
        == "DeletedComponent"
    )
    assert (
        codegen.map_json_type_to_python(
            "comps", {"$ref": "common_types.json#/$defs/ComponentsList"}
        )
        == "list[dict[str, Any]]"
    )

    # Unions
    union_prop = {"oneOf": [{"type": "string"}, {"type": "integer"}]}
    assert codegen.map_json_type_to_python("union", union_prop) == "str | int"

    union_single = {"anyOf": [{"type": "boolean"}]}
    assert codegen.map_json_type_to_python("union_single", union_single) == "bool"

    # allOf schema composition
    allof_prop = {
        "allOf": [
            {"$ref": "common_types.json#/$defs/DynamicString"},
            {"if": {"type": "string"}},
        ]
    }
    assert codegen.map_json_type_to_python("min", allof_prop) == "DynamicString"

    # Basic types
    assert codegen.map_json_type_to_python("prop", {"type": "string"}) == "str"
    assert (
        codegen.map_json_type_to_python(
            "prop", {"type": "string", "enum": ["small", "large"]}
        )
        == 'Literal["small", "large"]'
    )
    assert codegen.map_json_type_to_python("prop", {"type": "number"}) == "float"
    assert codegen.map_json_type_to_python("prop", {"type": "integer"}) == "int"
    assert codegen.map_json_type_to_python("prop", {"type": "boolean"}) == "bool"
    assert (
        codegen.map_json_type_to_python(
            "prop", {"type": "array", "items": {"type": "string"}}
        )
        == "list[str]"
    )
    assert (
        codegen.map_json_type_to_python("prop", {"type": "object"}) == "dict[str, Any]"
    )
    assert codegen.map_json_type_to_python("prop", {}) == "Any"


def test_compile_properties_to_pydantic():
    codegen = codegen_pydantic.PydanticCodegen("v0.9")

    # Required property
    props = {"title": {"type": "string", "description": "Simple title"}}
    lines = codegen.compile_properties(props, ["title"])
    assert len(lines) == 1
    assert lines[0] == '    title: str = Field(..., description="Simple title")'

    # Optional property
    props = {"title": {"type": "string"}}
    lines = codegen.compile_properties(props, [])
    assert len(lines) == 1
    assert lines[0] == "    title: str | None = Field(None)"

    # Default values
    props = {
        "num": {"type": "integer", "default": 42},
        "text": {"type": "string", "default": "hello"},
    }
    lines = codegen.compile_properties(props, [])
    assert len(lines) == 2
    assert "    num: int | None = Field(default=42)" in lines
    assert '    text: str | None = Field(default="hello")' in lines

    # CamelCase to snake_case alias
    props = {"surfaceId": {"type": "string"}}
    lines = codegen.compile_properties(props, ["surfaceId"])
    assert len(lines) == 1
    assert 'surface_id: str = Field(..., alias="surfaceId")' in lines[0]


def test_compile_object_def():
    codegen = codegen_pydantic.PydanticCodegen("v0.9")

    # Extends StrictBaseModel by default
    spec = {"properties": {"x": {"type": "number"}}, "required": ["x"]}
    code = codegen.compile_object_def("Point", spec)
    assert "class Point(StrictBaseModel):" in code
    assert "    x: float = Field(...)" in code

    # Extends BaseModel if additionalProperties is true
    spec = {"properties": {"x": {"type": "number"}}, "additionalProperties": True}
    code = codegen.compile_object_def("Point", spec)
    assert "class Point(BaseModel):" in code

    # Empty object definition
    code = codegen.compile_object_def("Empty", {})
    assert "class Empty(StrictBaseModel):" in code
    assert "    pass" in code


def test_compile_union_def():
    codegen = codegen_pydantic.PydanticCodegen("v0.9")
    spec = {
        "oneOf": [{"type": "string"}, {"$ref": "common_types.json#/$defs/DataBinding"}]
    }
    code = codegen.compile_union_def("StringOrBinding", spec)
    assert code == "StringOrBinding = str | DataBinding\n"


def test_extract_exported_symbols():
    sample_code = """
class TextComponent(CatalogComponentCommon):
    pass

class ButtonComponent(CatalogComponentCommon):
    pass

def helper_func():
    pass

def _private_func():
    pass

AnyComponent = TextComponent | ButtonComponent
BASIC_COMPONENTS = [TextComponent, ButtonComponent]
_PRIVATE_VAR = 123
"""
    symbols = codegen_pydantic.extract_exported_symbols(sample_code)
    assert symbols == [
        "TextComponent",
        "ButtonComponent",
        "helper_func",
        "AnyComponent",
        "BASIC_COMPONENTS",
    ]


def test_generate_basic_catalog_components():
    # Scenario A: Fallback to all components (without CatalogComponentCommon in defs)
    mock_catalog_data = {
        "components": {
            "Text": {
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
            }
        }
    }
    code = codegen_pydantic.generate_basic_catalog_components("v0.9", mock_catalog_data)
    assert "class CatalogComponentCommon" not in code
    assert "class TextComponent(ComponentCommon):" in code
    assert '    component: Literal["Text"] = "Text"' in code
    assert (
        '    text: str = Field(..., description="")' in code
        or "    text: str = Field(...)" in code
    )

    # Scenario B: Intersects component map and anyComponent/oneOf refs (with CatalogComponentCommon in defs)
    mock_catalog_data_defs = {
        "components": {
            "Text": {
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
            },
            "PrivateHelper": {
                "properties": {"secret": {"type": "string"}},
                "required": ["secret"],
            },
        },
        "$defs": {
            "CatalogComponentCommon": {
                "type": "object",
                "properties": {"weight": {"type": "number"}},
            },
            "anyComponent": {
                "oneOf": [
                    {"$ref": "#/components/Text"},
                    {"$ref": "#/components/NonExistent"},
                ]
            },
        },
    }
    code_defs = codegen_pydantic.generate_basic_catalog_components(
        "v0.9", mock_catalog_data_defs
    )
    assert "class CatalogComponentCommon(ComponentCommon):" in code_defs
    assert "class TextComponent(CatalogComponentCommon):" in code_defs
    assert (
        "class PrivateHelperComponent(CatalogComponentCommon):" in code_defs
    )  # Class is still generated!
    assert "TextComponent" in code_defs
    any_comp_def = code_defs.split("AnyComponent = ")[1].split("\n")[0]
    assert "TextComponent" in any_comp_def
    assert "PrivateHelperComponent" not in any_comp_def
    assert "NonExistentComponent" not in any_comp_def

    # Scenario C: Dynamic SvgPath compilation if found inside Icon component
    mock_catalog_data_svg = {
        "components": {
            "Icon": {
                "allOf": [
                    {"$ref": "common_types.json#/$defs/ComponentCommon"},
                    {
                        "properties": {
                            "name": {
                                "oneOf": [
                                    {"type": "string", "enum": ["add", "close"]},
                                    {
                                        "type": "object",
                                        "properties": {"svgPath": {"type": "string"}},
                                        "required": ["svgPath"],
                                    },
                                ]
                            }
                        }
                    },
                ]
            }
        }
    }
    code_svg = codegen_pydantic.generate_basic_catalog_components(
        "v0.9", mock_catalog_data_svg
    )
    assert "class SvgPath(StrictBaseModel):" in code_svg
    assert '    svg_path: str = Field(..., alias="svgPath")' in code_svg
    assert 'Literal["add", "close"] | SvgPath' in code_svg


def test_generate_basic_catalog_functions():
    # Scenario A: Fallback to all functions
    mock_catalog_data = {
        "functions": {
            "toast": {
                "properties": {"args": {"properties": {"message": {"type": "string"}}}}
            }
        }
    }
    code = codegen_pydantic.generate_basic_catalog_functions("v0.9", mock_catalog_data)
    assert "class ToastApi(FunctionApi):" in code

    # Scenario B: Intersects functions map and anyFunction/oneOf refs
    mock_catalog_data_defs = {
        "functions": {
            "toast": {
                "properties": {"args": {"properties": {"message": {"type": "string"}}}}
            },
            "privateFunc": {
                "properties": {"args": {"properties": {"dummy": {"type": "string"}}}}
            },
        },
        "$defs": {
            "anyFunction": {
                "oneOf": [
                    {"$ref": "#/functions/toast"},
                    {"$ref": "#/functions/nonExistentFunc"},
                ]
            }
        },
    }
    code_defs = codegen_pydantic.generate_basic_catalog_functions(
        "v0.9", mock_catalog_data_defs
    )
    assert "class ToastApi(FunctionApi):" in code_defs
    assert "class PrivateFuncApi(FunctionApi):" in code_defs


def test_generate_basic_catalog_styles():
    # v0.8 styles mapping (font, primaryColor)
    v08_catalog_data = {
        "styles": {
            "font": {
                "type": "string",
                "description": "The primary font for the UI.",
            },
            "primaryColor": {
                "type": "string",
                "description": (
                    "The primary UI color as a hexadecimal code (e.g., '#00BFFF')."
                ),
            },
        }
    }
    code_v08 = codegen_pydantic.generate_basic_catalog_styles("v0.8", v08_catalog_data)
    assert code_v08 is not None
    assert (
        "class Styles(StrictBaseModel):" in code_v08
        or "class Styles(BaseModel):" in code_v08
    )
    assert "font: str | None = Field(None" in code_v08
    assert 'primary_color: str | None = Field(None, alias="primaryColor"' in code_v08
    assert "Theme = Styles" in code_v08

    # v0.9 theme
    mock_catalog_data = {
        "$defs": {
            "theme": {
                "type": "object",
                "properties": {
                    "primaryColor": {"type": "string", "description": "Test color."}
                },
                "additionalProperties": True,
            }
        }
    }
    code = codegen_pydantic.generate_basic_catalog_styles("v0.9", mock_catalog_data)
    assert code is not None
    assert "class Theme(BaseModel):" in code
    assert (
        'primary_color: str | None = Field(None, alias="primaryColor",'
        ' description="Test color.")'
        in code
    )

    # v1.0 without styles
    v10_catalog_data = {"components": {}}
    code_v10 = codegen_pydantic.generate_basic_catalog_styles("v1.0", v10_catalog_data)
    assert code_v10 is None


def test_generate_agent_to_renderer():
    mock_a2r_data = {
        "$defs": {
            "CreateSurfaceMessage": {
                "properties": {
                    "createSurface": {
                        "properties": {"surfaceId": {"type": "string"}},
                        "required": ["surfaceId"],
                    }
                },
                "required": ["createSurface"],
            }
        }
    }
    code = codegen_pydantic.generate_agent_to_renderer("v0.9", mock_a2r_data)
    assert "class CreateSurface(StrictBaseModel):" in code
    assert "class CreateSurfaceMessage(StrictBaseModel):" in code


def test_generate_schema_init():
    mock_modules = {
        "common_types": (
            "class StrictBaseModel:\n    pass\nclass DataBinding:\n    pass"
        ),
        "server_to_client": (
            "class CreateSurface(StrictBaseModel):\n    pass\nclass"
            " CreateSurfaceMessage(StrictBaseModel):\n    pass"
        ),
    }
    code = codegen_pydantic.generate_schema_init("v0.9", mock_modules)
    assert "from .constants import *" in code
    assert "from .common_types import (" in code
    assert "    StrictBaseModel," in code
    assert "from .server_to_client import (" in code
    assert "    CreateSurfaceMessage," in code
    assert "    CreateSurface," in code


def test_generate_renderer_capabilities():
    mock_capabilities_data = {
        "properties": {
            "v0.9": {
                "properties": {
                    "supportedCatalogIds": {
                        "type": "array",
                        "items": {"type": "string"},
                    }
                },
                "required": ["supportedCatalogIds"],
            }
        },
        "$defs": {
            "FunctionDefinition": {
                "properties": {
                    "name": {"type": "string"},
                    "returnType": {"enum": ["string", "number"]},
                },
                "required": ["name", "returnType"],
            }
        },
    }
    code = codegen_pydantic.generate_renderer_capabilities(
        "v0.9", mock_capabilities_data
    )
    assert "class FunctionDefinition(StrictBaseModel):" in code
    assert "class V09Capabilities(StrictBaseModel):" in code
    assert "class A2uiClientCapabilities(StrictBaseModel):" in code
    assert "A2uiRendererCapabilities = A2uiClientCapabilities" in code
    assert "v0_9: V09Capabilities | None = Field(None, alias=PROTOCOL_VERSION)" in code


def test_generate_agent_capabilities():
    mock_agent_caps_data = {
        "properties": {
            "v1.0": {
                "properties": {
                    "supportedCatalogIds": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "acceptsInlineCatalogs": {
                        "type": "boolean",
                        "default": False,
                    },
                },
            }
        },
        "required": ["v1.0"],
    }
    code = codegen_pydantic.generate_agent_capabilities("v1.0", mock_agent_caps_data)
    assert "class V10AgentCapabilities(StrictBaseModel):" in code
    assert "class A2uiAgentCapabilities(StrictBaseModel):" in code
    assert "A2uiServerCapabilities" not in code


def test_generate_catalog_definition():
    mock_cat_def_data = {
        "$defs": {
            "ValidationResult": {
                "properties": {"valid": {"type": "boolean"}},
                "required": ["valid"],
            },
            "ComponentDefinition": {
                "properties": {
                    "allowedParents": {"type": "array", "items": {"type": "string"}},
                },
            },
            "FunctionDefinition": {
                "properties": {
                    "returnType": {"type": "string"},
                },
                "required": ["returnType"],
            },
        },
        "properties": {
            "catalogId": {"type": "string"},
        },
        "required": ["catalogId"],
    }
    code = codegen_pydantic.generate_catalog_definition("v1.0", mock_cat_def_data)
    assert "class ValidationResult(StrictBaseModel):" in code
    assert "class ComponentDefinition(BaseModel):" in code
    assert "class FunctionDefinition(BaseModel):" in code
    assert "class CatalogDefinition(StrictBaseModel):" in code


def test_generate_renderer_to_agent():
    mock_r2a_data = {
        "properties": {
            "action": {
                "properties": {"name": {"type": "string"}},
                "required": ["name"],
            },
            "error": {
                "oneOf": [{
                    "title": "Validation Failed Error",
                    "properties": {"code": {"const": "VALIDATION_FAILED"}},
                    "required": ["code"],
                }]
            },
        }
    }
    code = codegen_pydantic.generate_renderer_to_agent("v0.9", mock_r2a_data)
    assert "class A2uiClientAction(StrictBaseModel):" in code
    assert "class A2uiValidationError(StrictBaseModel):" in code
    assert (
        'code: Literal["VALIDATION_FAILED"] = Field("VALIDATION_FAILED")' in code
        or "code: Literal['VALIDATION_FAILED'] = Field(\"VALIDATION_FAILED\")" in code
    )
    assert "A2uiRendererError = A2uiValidationError" in code
    assert "class A2uiClientActionMessage(StrictBaseModel):" in code
    assert "class A2uiRendererErrorMessage(StrictBaseModel):" in code
    assert (
        "A2uiClientMessage = A2uiClientActionMessage | A2uiRendererErrorMessage" in code
        or "A2uiClientMessage = A2uiRendererActionMessage | A2uiRendererErrorMessage"
        in code
    )


def test_const_keyword_mapping():
    codegen = codegen_pydantic.PydanticCodegen("v0.9")
    assert (
        codegen.map_json_type_to_python("code", {"const": "SUCCESS"})
        == "Literal['SUCCESS']"
    )
    assert codegen.map_json_type_to_python("num", {"const": 404}) == "Literal[404]"

    props = {"code": {"const": "FAIL"}}
    lines = codegen.compile_properties(props, ["code"])
    assert len(lines) == 1
    assert "    code: Literal['FAIL'] = Field(\"FAIL\")" in lines[0]


def test_file_header_preamble():
    header = codegen_pydantic.FILE_HEADER
    assert "Copyright 2024 Google LLC" in header
    assert "Auto-generated. Do not edit manually." in header
    assert "from __future__ import annotations" in header


def test_compile_properties_required_with_default():
    codegen = codegen_pydantic.PydanticCodegen("v1.0")
    props = {
        "version": {"type": "string", "default": "v1.0"},
        "count": {"type": "integer", "default": 1},
    }
    lines = codegen.compile_properties(props, ["version", "count"])
    assert len(lines) == 2
    assert "    version: str = Field(...)" in lines
    assert "    count: int = Field(...)" in lines


def test_map_json_type_to_python_non_string_enum():
    codegen = codegen_pydantic.PydanticCodegen("v1.0")
    enum_prop = {"enum": [1, 2, 3]}
    assert codegen.map_json_type_to_python("num_enum", enum_prop) == "Literal[1, 2, 3]"

    enum_mixed = {"enum": ["a", 1, True]}
    assert (
        codegen.map_json_type_to_python("mixed_enum", enum_mixed)
        == 'Literal["a", 1, True]'
    )


def test_generated_python_syntax_validity():
    """Verifies that the codegen script generates syntactically valid Python code for all available versions."""
    with tempfile.TemporaryDirectory() as tmpdir:
        orig_root = codegen_pydantic.CORE_SRC_ROOT
        codegen_pydantic.CORE_SRC_ROOT = tmpdir
        try:
            versions = ["v0.8", "v0.9", "v1.0"]
            for ver in versions:
                codegen_pydantic.generate_version_schemas(ver)
                codegen_pydantic.generate_basic_catalog(ver)

            # Test root schema __init__.py update
            codegen_pydantic.update_root_schema_init(versions, out_root=tmpdir)

            # Check that all generated .py files parse cleanly with AST
            py_files_count = 0
            for root, _, files in os.walk(tmpdir):
                for f in files:
                    if f.endswith(".py"):
                        py_files_count += 1
                        fpath = os.path.join(root, f)
                        with open(fpath, "r", encoding="utf-8") as py_file:
                            content = py_file.read()
                        ast.parse(content, filename=fpath)
            assert py_files_count > 0
        finally:
            codegen_pydantic.CORE_SRC_ROOT = orig_root


def test_basic_catalog_operator_and_index_api():
    from a2ui.core.basic_catalog import AddApi
    from a2ui.core.basic_catalog.v1_0.operator_apis import IndexApi, IndexArgs
    from a2ui.core.basic_catalog import v0_9, v1_0

    # Verify IndexApi definition
    assert IndexApi.name == "@index"
    assert IndexApi.return_type == "number"
    assert IndexApi.schema == IndexArgs

    # Verify shared basic_catalog and v0.9 basic catalog do not have IndexApi
    import a2ui.core.basic_catalog as basic_catalog

    assert not hasattr(basic_catalog, "IndexApi")
    assert hasattr(v0_9, "AddApi")
    assert "AddApi" in v0_9.__all__
    assert not hasattr(v0_9, "IndexApi")
    assert "IndexApi" not in v0_9.__all__

    # Verify v1.0 basic catalog exports both AddApi and IndexApi
    assert hasattr(v1_0, "AddApi")
    assert "AddApi" in v1_0.__all__
    assert hasattr(v1_0, "IndexApi")
    assert "IndexApi" in v1_0.__all__


def test_validate_version_field_non_dict_context():
    from a2ui.core.schema.v0_9.client_to_server import A2uiClientDataModel

    # Should not raise AttributeError when context is not a dict
    model = A2uiClientDataModel.model_validate(
        {"version": "v0.9", "surfaces": {}},
        context="not_a_dict",
    )
    assert model.version == "v0.9"

    model_list = A2uiClientDataModel.model_validate(
        {"version": "v0.9", "surfaces": {}},
        context=["list_context"],
    )
    assert model_list.version == "v0.9"


def test_function_definition_conditional_validation():
    from pydantic import ValidationError
    from a2ui.core.schema.v1_0.catalog_definition import FunctionDefinition

    # Valid: requiresUserActivation=True with allowedCallers='rendererOnly'
    fd_valid = FunctionDefinition.model_validate({
        "returnType": "boolean",
        "allowedCallers": "rendererOnly",
        "requiresUserActivation": True,
    })
    assert fd_valid.requires_user_activation is True
    assert fd_valid.allowed_callers == "rendererOnly"

    # Invalid: requiresUserActivation=True with allowedCallers='rendererOrAgent'
    with pytest.raises(
        ValidationError,
        match=(
            "requiresUserActivation=True can only have allowedCallers equal to"
            " 'rendererOnly'"
        ),
    ):
        FunctionDefinition.model_validate({
            "returnType": "boolean",
            "allowedCallers": "rendererOrAgent",
            "requiresUserActivation": True,
        })

    # Invalid: requiresUserActivation=True with allowedCallers='agentOnly'
    with pytest.raises(
        ValidationError,
        match=(
            "requiresUserActivation=True can only have allowedCallers equal to"
            " 'rendererOnly'"
        ),
    ):
        FunctionDefinition.model_validate({
            "returnType": "boolean",
            "allowedCallers": "agentOnly",
            "requiresUserActivation": True,
        })
