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
import importlib
import json
import os
import subprocess
import sys
import tempfile

import pytest
from pydantic import TypeAdapter, ValidationError

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
import engine


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
    assert lines[0] == "    title: str | None = Field(default=None)"

    # Defaults are documented, but do not become model defaults.
    props = {
        "num": {"type": "integer", "default": 42},
        "text": {"type": "string", "default": "hello"},
    }
    lines = codegen.compile_properties(props, [])
    assert len(lines) == 2
    assert (
        '    num: int | None = Field(default=None, description="Defaults to 42 when'
        ' absent.")'
        in lines
    )
    assert (
        '    text: str | None = Field(default=None, description="Defaults to'
        ' \\"hello\\" when absent.")'
        in lines
    )

    # JSON Schema regex escapes must survive as the same Python string value.
    pattern = r"^\d+\.[A-Z]+$"
    props = {"code": {"type": "string", "pattern": pattern}}
    lines = codegen.compile_properties(props, ["code"])
    assert lines == [f'    code: str = Field(..., pattern=r"{pattern}")']

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
    assert "font: str | None = Field(default=None" in code_v08
    assert (
        'primary_color: str | None = Field(default=None, alias="primaryColor"'
        in code_v08
    )
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
        'primary_color: str | None = Field(default=None, alias="primaryColor",'
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
    assert (
        "v0_9: V09Capabilities | None = Field(default=None, alias=PROTOCOL_VERSION)"
        in code
    )


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
        == 'Literal["SUCCESS"]'
    )
    assert codegen.map_json_type_to_python("num", {"const": 404}) == "Literal[404]"

    props = {"code": {"const": "FAIL"}}
    lines = codegen.compile_properties(props, ["code"])
    assert len(lines) == 1
    assert '    code: Literal["FAIL"] = Field("FAIL")' in lines[0]


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
    assert (
        '    version: str = Field(..., description="Defaults to \\"v1.0\\" when'
        ' absent.")'
        in lines
    )
    assert (
        '    count: int = Field(..., description="Defaults to 1 when absent.")' in lines
    )


@pytest.mark.parametrize("version", ["v0.9", "v1.0"])
def test_default_annotations_do_not_set_model_defaults(version):
    codegen = codegen_pydantic.PydanticCodegen(version)
    props = {
        "displayName": {
            "type": "string",
            "description": "Name shown in the UI.",
            "default": "Guest",
        },
        "kind": {"const": "email", "default": "ignored"},
    }

    lines = codegen.compile_properties(props, ["kind"])

    assert (
        '    display_name: str | None = Field(default=None, alias="displayName",'
        ' description="Name shown in the UI. Defaults to \\"Guest\\" when absent.")'
        in lines
    )
    assert '    kind: Literal["email"] = Field("email")' in lines


def test_v0_9_function_call_keeps_schema_default_out_of_payload():
    from a2ui.core.schema.v0_9 import FunctionCall

    call = FunctionCall(call="validateEmail")

    assert "returnType" not in call.model_dump(by_alias=True)
    assert call.model_dump(by_alias=True, exclude_none=True) == {
        "call": "validateEmail"
    }
    explicit_call = FunctionCall(call="validateEmail", return_type="boolean")
    assert explicit_call.model_dump(by_alias=True, exclude_none=True) == {
        "call": "validateEmail",
        "returnType": "boolean",
    }
    return_type_schema = FunctionCall.model_json_schema(by_alias=True)["properties"][
        "returnType"
    ]
    assert return_type_schema["default"] == "boolean"


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


SPEC_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", "..", "specification"))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))

# The versions whose basic catalog the specification publishes with functions.
CATALOG_VERSIONS = ("v0_9", "v1_0")


def _published_function_names(version: str) -> set[str]:
    """Returns the function names the published basic catalog for `version` declares."""
    if version == "v1_0":
        catalog_path = os.path.join(
            REPO_ROOT, "catalogs", "basic", "v1", "catalog.json"
        )
    else:
        catalog_path = os.path.join(
            SPEC_ROOT, version, "catalogs", "basic", "catalog.json"
        )
    with open(catalog_path, "r", encoding="utf-8") as catalog_file:
        return set(json.load(catalog_file)["functions"])


def _exported_function_names(module) -> set[str]:
    """Returns the catalog name of every `FunctionApi` `module` exports."""
    from a2ui.core.catalog.functions import FunctionApi

    return {
        getattr(module, exported).name
        for exported in module.__all__
        if isinstance(getattr(module, exported), type)
        and issubclass(getattr(module, exported), FunctionApi)
    }


@pytest.mark.parametrize("version", CATALOG_VERSIONS)
def test_basic_catalog_exports_exactly_the_published_functions(version: str):
    """The exported function APIs are those the catalog declares, and no others.

    An agent can only call what the published catalog advertises, so an API the
    catalog does not declare is unreachable, and a declared function with no API
    is uncallable. Comparing the two sets catches both. Functions in the '@'
    namespace come from the runtime rather than from any catalog document, so
    they are not exported here.
    """
    module = importlib.import_module(f"a2ui.core.basic_catalog.{version}")

    assert _exported_function_names(module) == _published_function_names(version)


def test_index_is_a_system_function_rather_than_a_catalog_export():
    """'@index' reaches a catalog from the runtime, not from a version package.

    The renderer supplies '@index' to every v1.0 catalog, including catalogs
    that never declare it, so publishing it from the basic catalog's package
    would put it out of reach of the others.
    """
    import a2ui.core.basic_catalog as basic_catalog
    from a2ui.core.basic_catalog import v0_9, v1_0
    from a2ui.core.catalog import IndexApi, IndexArgs

    assert IndexApi.name == "@index"
    assert IndexApi.return_type == "number"
    assert IndexApi.schema is IndexArgs

    for module in (basic_catalog, v0_9, v1_0):
        assert not hasattr(module, "IndexApi")


def test_system_functions_carry_forward_to_later_versions():
    """A system function is defined once and inherited by every later version.

    Binding one per version would mean a protocol version that changes nothing
    about '@index' still has to restate it, and would silently lose the
    function if it forgot.
    """
    from a2ui.core.catalog import system_functions_for

    assert set(system_functions_for("v0.9")) == set()
    assert set(system_functions_for(None)) == set()
    for version in ("v1.0", "v1.1", "v2.0"):
        assert set(system_functions_for(version)) == {"@index"}


@pytest.mark.parametrize("context", [["a", "b"], ("a",), "text"])
def test_index_rejects_a_sequence_context(context):
    """A sequence's `index` method is not an iteration index.

    Casting the bound method to int used to raise TypeError. The context is
    now treated as having no iteration scope.
    """
    from a2ui.core.catalog import IndexImplementation
    from a2ui.core.exceptions import A2uiValidationError

    with pytest.raises(A2uiValidationError, match="collection template"):
        IndexImplementation.execute({}, context)


@pytest.mark.parametrize("index", ["first", object()])
def test_index_rejects_a_non_numeric_index(index):
    """A non-numeric iteration index is a validation error that names the value."""
    from types import SimpleNamespace

    from a2ui.core.catalog import IndexImplementation
    from a2ui.core.exceptions import A2uiValidationError

    for context in (SimpleNamespace(index=index), {"index": index}):
        with pytest.raises(A2uiValidationError, match="numeric iteration index"):
            IndexImplementation.execute({}, context)


@pytest.mark.parametrize("offset", [{"path": "/i"}, float("nan")])
def test_index_rejects_a_non_numeric_offset(offset):
    """An unconvertible offset is a validation error that names the value."""
    from a2ui.core.catalog import IndexImplementation
    from a2ui.core.exceptions import A2uiValidationError

    with pytest.raises(A2uiValidationError, match="numeric offset"):
        IndexImplementation.execute({"offset": offset}, {"index": 0})


def test_index_args_match_the_version_specific_model():
    """The shared argument model admits what the v1.0 schema admits.

    '@index' is validated through one version-neutral model, so a version whose
    generated model drifts from it would be validated against the wrong shape.
    """
    from pydantic import ValidationError

    from a2ui.core.catalog import IndexArgs
    from a2ui.core.schema.v1_0 import IndexSystemFunctionArgs

    accepted = ({}, {"offset": 1}, {"offset": 1.5}, {"offset": {"path": "/i"}})
    rejected = ({"offset": "1"}, {"offset": True}, {"offset": 1, "extra": 1})

    for args in accepted:
        assert IndexArgs.model_validate(args)
        assert IndexSystemFunctionArgs.model_validate(args)

    for args in rejected:
        with pytest.raises(ValidationError):
            IndexArgs.model_validate(args)
        with pytest.raises(ValidationError):
            IndexSystemFunctionArgs.model_validate(args)


def test_validate_version_field_non_dict_context():
    from a2ui.core.schema.v0_9 import A2uiClientDataModel

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

    from a2ui.core.schema.v1_0 import FunctionDefinition

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


@pytest.mark.parametrize(
    "spec_version, package",
    # The v0.9.1 common types are identical to v0.9 and share its package.
    [("v0_9", "v0_9"), ("v0_9_1", "v0_9"), ("v1_0", "v1_0")],
)
def test_common_types_defs_manifest_matches_spec_defs(spec_version: str, package: str):
    """COMMON_TYPES_DEFS lists every spec def, each with a usable schema.

    Every entry must build a JSON schema, and a model must declare exactly the
    properties its spec def declares, under their spec names.
    """
    mod = importlib.import_module(f"a2ui.core.schema.{package}")
    assert "COMMON_TYPES_DEFS" in mod.__all__

    spec_path = os.path.join(SPEC_ROOT, spec_version, "json", "common_types.json")
    with open(spec_path, "r", encoding="utf-8") as f:
        spec_defs = json.load(f)["$defs"]

    manifest = mod.COMMON_TYPES_DEFS
    assert list(manifest.keys()) == list(spec_defs.keys())
    for name, symbol in manifest.items():
        schema = TypeAdapter(symbol).json_schema(by_alias=True)
        assert isinstance(schema, dict), name
        if "properties" in spec_defs[name]:
            assert set(schema["properties"]) == set(spec_defs[name]["properties"]), name


@pytest.mark.parametrize(
    "spec_version, package, filename",
    [
        ("v0_8", "v0_8", "server_to_client.json"),
        ("v0_9", "v0_9", "server_to_client.json"),
        ("v0_9_1", "v0_9", "server_to_client.json"),
        ("v1_0", "v1_0", "agent_to_renderer.json"),
    ],
)
def test_agent_to_renderer_defs_manifest_matches_spec_defs(
    spec_version: str, package: str, filename: str
):
    """AGENT_TO_RENDERER_DEFS lists every spec message/def in declaration order."""
    mod = importlib.import_module(f"a2ui.core.schema.{package}")
    assert "AGENT_TO_RENDERER_DEFS" in mod.__all__

    spec_path = os.path.join(SPEC_ROOT, spec_version, "json", filename)
    with open(spec_path, "r", encoding="utf-8") as f:
        spec_doc = json.load(f)

    spec_defs = spec_doc.get("$defs") or spec_doc["properties"]
    manifest = mod.AGENT_TO_RENDERER_DEFS
    assert list(manifest.keys()) == list(spec_defs.keys())
    for name, symbol in manifest.items():
        schema = TypeAdapter(symbol).json_schema(by_alias=True)
        assert isinstance(schema, dict), name
        if "properties" in spec_defs[name]:
            assert set(schema["properties"]) == set(spec_defs[name]["properties"]), name


@pytest.mark.parametrize(
    "value, expected",
    [
        (True, "True"),
        (False, "False"),
        (None, "None"),
        (1.5, "1.5"),
        ('say "hi" \\ é', '"say \\"hi\\" \\\\ é"'),
        ({"a": [None, True, "x"]}, '{"a": [None, True, "x"]}'),
    ],
)
def test_python_literal_renders_json_values(value, expected):
    rendered = engine.python_literal(value)

    assert rendered == expected
    assert ast.literal_eval(rendered) == value


@pytest.mark.parametrize("value", [float("nan"), float("inf"), object(), (1, 2)])
def test_python_literal_rejects_non_json_values(value):
    with pytest.raises(ValueError, match="Not a JSON value"):
        engine.python_literal(value)


def test_model_docstring_keeps_quotes_and_backslashes():
    description = 'Use "quotes", a \\ backslash and """triple quotes" at the end"'
    codegen = codegen_pydantic.PydanticCodegen("v1.0")

    code = codegen.compile_object_def(
        "Doc", {"description": description, "properties": {"a": {"type": "string"}}}
    )

    class_def = ast.parse(code).body[0]
    assert ast.get_docstring(class_def, clean=False) == description


def test_strict_model_rejects_a_description_its_docstring_would_change():
    codegen = codegen_pydantic.PydanticCodegen("v1.0")
    codegen.strict = True

    with pytest.raises(ValueError):
        codegen.compile_object_def(
            "Doc",
            {"description": "two\nlines", "properties": {"a": {"type": "string"}}},
        )


def _common_types(defs: dict) -> str:
    return codegen_pydantic.generate_common_types("v1.0", {"$defs": defs})


def _object(properties: dict, **keywords) -> dict:
    return {"type": "object", "properties": properties, **keywords}


@pytest.mark.parametrize(
    "defs, message",
    [
        (
            {
                "Foo": _object(
                    {"bar": _object({"x": {"type": "string"}})},
                ),
                "FooBar": {"type": "string"},
            },
            "collides",
        ),
        ({"Foo": _object({"a": {"type": "string"}}, required=["b"])}, "undeclared"),
        ({"Foo": _object({"a": {"type": "string"}}, minProperties=1)}, "minProperties"),
        ({"Foo": _object({"a": {"$ref": "#/$defs/Missing"}})}, "Unsupported schema"),
        (
            {"Foo": _object({"a": {"$ref": "#/$defs/Foo", "minLength": 1}})},
            "Unsupported schema",
        ),
        (
            {"Foo": _object({"a": {"const": "x", "type": "number"}})},
            "Unsupported schema",
        ),
        ({"Foo": _object({"a": {"properties": {}}})}, "Unsupported schema"),
        (
            {"Foo": _object({"a": {"oneOf": [{"type": "string"}], "minLength": 1}})},
            "Unsupported schema",
        ),
        ({"Foo": {"oneOf": []}}, "Unsupported union def"),
        (
            {"Foo": {"oneOf": [{"type": "string"}], "anyOf": [{"type": "number"}]}},
            "Unsupported union def",
        ),
    ],
)
def test_common_types_generation_fails_on_unenforced_schema(defs, message):
    """A spec shape the generated models would not enforce fails generation."""
    with pytest.raises(ValueError, match=message):
        _common_types(defs)


@pytest.mark.parametrize(
    "branch",
    [
        {"allOf": [{"$ref": "#/$defs/FunctionCall"}]},
        {
            "allOf": [
                {"$ref": "#/$defs/FunctionCall"},
                {"properties": {"returnType": {"const": "string"}}, "required": []},
            ]
        },
        {
            "allOf": [
                {"$ref": "#/$defs/FunctionCall"},
                {"properties": {"returnType": {"enum": ["string"]}}},
            ]
        },
        "FunctionCall",
    ],
)
def test_dynamic_function_call_branch_requires_the_exact_shape(branch):
    import schema_generators

    with pytest.raises(ValueError, match="Unsupported FunctionCall branch"):
        schema_generators._function_call_branch_return_type("DynamicString", branch)


def test_dynamic_function_call_branch_reads_the_return_type():
    import schema_generators

    branch = {
        "allOf": [
            {"$ref": "#/$defs/FunctionCall"},
            {"properties": {"returnType": {"const": "string"}}},
        ]
    }

    assert (
        schema_generators._function_call_branch_return_type("DynamicString", branch)
        == "string"
    )
    assert (
        schema_generators._function_call_branch_return_type(
            "DynamicValue", {"$ref": "#/$defs/FunctionCall"}
        )
        is None
    )


def test_common_types_generation_is_deterministic():
    """Output does not depend on string hashing, which varies between runs."""
    script = (
        f"import json, sys\nsys.path.insert(0, {SKILL_SCRIPT_PATH!r})\nfrom"
        " schema_generators import generate_common_types\nspec_path ="
        f" {os.path.join(SPEC_ROOT, 'v1_0', 'json', 'common_types.json')!r}\nwith"
        " open(spec_path, encoding='utf-8') as f:\n   "
        " print(generate_common_types('v1.0', json.load(f)))\n"
    )
    outputs = {
        subprocess.run(
            [sys.executable, "-c", script],
            check=True,
            capture_output=True,
            text=True,
            env={**os.environ, "PYTHONHASHSEED": seed},
        ).stdout
        for seed in ("1", "2", "3")
    }

    assert len(outputs) == 1


@pytest.mark.parametrize(
    "package, model, payload",
    [
        ("v1_0", "FunctionResponse", {"functionCallId": "c1", "error": None}),
        ("v1_0", "Surface", {"component": None}),
        ("v1_0", "Surface", {"child": None}),
        ("v1_0", "IndexSystemFunction", {"call": "@index", "args": None}),
        ("v1_0", "ComponentCommon", {"id": "a", "catalogId": None}),
        ("v1_0", "ComponentCommon", {"id": "a", "catalog_id": None}),
        ("v0_9", "ComponentCommon", {"id": "a", "accessibility": None}),
        ("v0_9", "FunctionCall", {"call": "fn", "args": {"a": None}}),
    ],
)
def test_generated_models_reject_null_where_the_spec_does(package, model, payload):
    cls = getattr(importlib.import_module(f"a2ui.core.schema.{package}"), model)

    with pytest.raises(ValidationError, match="null"):
        cls.model_validate(payload)


def test_generated_models_accept_null_where_the_spec_does():
    """`FunctionResponse.value` accepts any JSON value, including null."""
    from a2ui.core.schema.v1_0 import FunctionResponse

    response = FunctionResponse.model_validate({"functionCallId": "c1", "value": None})

    assert response.value is None
    assert "value" in response.model_fields_set


def test_catalog_components_reject_null_for_their_own_optional_fields():
    """Components inherit `SpecBaseModel`'s null rule through `ComponentCommon`."""
    from a2ui.core.basic_catalog.v1_0 import TextComponent

    with pytest.raises(ValidationError, match="must not be null"):
        TextComponent.model_validate(
            {"id": "t", "component": "Text", "text": "Hi", "variant": None}
        )


@pytest.mark.parametrize(
    "payload",
    [
        {"functionCallId": "c1"},
        {"functionCallId": "c1", "value": 1, "error": {"code": "E", "message": "m"}},
    ],
)
def test_declared_required_one_of_is_validated(payload):
    """`FunctionResponse` declares `oneOf` `value` | `error` in its config only."""
    from a2ui.core.schema.v1_0 import FunctionResponse

    with pytest.raises(ValidationError, match="exactly one of: value \\| error"):
        FunctionResponse.model_validate(payload)


def test_declared_schema_keywords_do_not_apply_to_subclasses():
    """`ComponentCommon` is open in the spec; components that subclass it are not."""
    from a2ui.core.basic_catalog.v1_0 import TextComponent
    from a2ui.core.schema.v1_0 import ComponentCommon

    assert "additionalProperties" not in ComponentCommon.model_json_schema()
    assert TextComponent.model_json_schema()["additionalProperties"] is False


@pytest.mark.parametrize("package", ["v0_9", "v1_0"])
def test_open_spec_defs_allow_extra_properties(package):
    """A def without `additionalProperties` in the spec accepts other keys."""
    checkable = importlib.import_module(f"a2ui.core.schema.{package}").Checkable

    validated = checkable.model_validate({"vendorKey": 1})

    assert validated.model_extra == {"vendorKey": 1}


def test_closed_spec_defs_forbid_extra_properties():
    from a2ui.core.schema.v1_0 import AccessibilityAttributes

    with pytest.raises(ValidationError):
        AccessibilityAttributes.model_validate({"label": "Submit", "role": "button"})


def test_agent_to_renderer_types_nested_payload_objects():
    """A nested payload object becomes a model rather than a plain dict."""
    from a2ui.core.schema.v1_0 import CreateSurface, CreateSurfaceMetadata

    surface = CreateSurface.model_validate({
        "surfaceId": "s1",
        "catalogId": "c1",
        "metadata": {"extensions": {"vendorExtension": {"a": 1}}},
    })

    assert isinstance(surface.metadata, CreateSurfaceMetadata)
    with pytest.raises(ValidationError):
        CreateSurface.model_validate({
            "surfaceId": "s1",
            "catalogId": "c1",
            "metadata": {"unknown": True},
        })


def test_generate_agent_to_renderer_extracts_nested_object_models():
    mock_a2r_data = {
        "$defs": {
            "CreateSurfaceMessage": {
                "properties": {
                    "createSurface": {
                        "type": "object",
                        "properties": {
                            "metadata": {
                                "type": "object",
                                "description": "Surface metadata.",
                                "properties": {"theme": {"type": "string"}},
                                "additionalProperties": False,
                            }
                        },
                    }
                },
                "required": ["createSurface"],
            }
        }
    }

    code = codegen_pydantic.generate_agent_to_renderer("v1.0", mock_a2r_data)

    assert "class CreateSurfaceMetadata(StrictBaseModel):" in code
    assert "metadata: CreateSurfaceMetadata | None" in code
    assert code.index("class CreateSurfaceMetadata") < code.index(
        "class CreateSurface("
    )
