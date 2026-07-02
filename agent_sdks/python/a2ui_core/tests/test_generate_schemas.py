# Copyright 2026 Google LLC
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

import sys
import os
import pytest

# Add the scripts directory to sys.path to import the generate_schemas script
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_PATH = os.path.abspath(os.path.join(SCRIPT_DIR, "../scripts"))
if SCRIPTS_PATH not in sys.path:
    sys.path.insert(0, SCRIPTS_PATH)

import generate_schemas


def test_map_json_type_to_python():
    # Ref mappings
    assert (
        generate_schemas.map_json_type_to_python(
            "id", {"$ref": "common_types.json#/$defs/ComponentId"}
        )
        == "ComponentId"
    )
    assert (
        generate_schemas.map_json_type_to_python(
            "val", {"$ref": "common_types.json#/$defs/DynamicString"}
        )
        == "DynamicString"
    )
    assert (
        generate_schemas.map_json_type_to_python(
            "common", {"$ref": "#/$defs/CatalogComponentCommon"}
        )
        == "CatalogComponentCommon"
    )
    assert (
        generate_schemas.map_json_type_to_python(
            "unknown", {"$ref": "other.json#/$defs/Unknown"}
        )
        == "Any"
    )

    # Unions
    union_prop = {"oneOf": [{"type": "string"}, {"type": "integer"}]}
    assert (
        generate_schemas.map_json_type_to_python("union", union_prop)
        == "Union[str, int]"
    )

    union_single = {"anyOf": [{"type": "boolean"}]}
    assert (
        generate_schemas.map_json_type_to_python("union_single", union_single) == "bool"
    )

    # allOf schema composition
    allof_prop = {
        "allOf": [
            {"$ref": "common_types.json#/$defs/DynamicString"},
            {"if": {"type": "string"}},
        ]
    }
    assert (
        generate_schemas.map_json_type_to_python("min", allof_prop) == "DynamicString"
    )

    # Basic types
    assert generate_schemas.map_json_type_to_python("prop", {"type": "string"}) == "str"
    assert (
        generate_schemas.map_json_type_to_python(
            "prop", {"type": "string", "enum": ["small", "large"]}
        )
        == 'Literal["small", "large"]'
    )
    assert (
        generate_schemas.map_json_type_to_python("prop", {"type": "number"}) == "float"
    )
    assert (
        generate_schemas.map_json_type_to_python("prop", {"type": "integer"}) == "int"
    )
    assert (
        generate_schemas.map_json_type_to_python("prop", {"type": "boolean"}) == "bool"
    )
    assert (
        generate_schemas.map_json_type_to_python(
            "prop", {"type": "array", "items": {"type": "string"}}
        )
        == "List[str]"
    )
    assert (
        generate_schemas.map_json_type_to_python("prop", {"type": "object"})
        == "Dict[str, Any]"
    )
    assert generate_schemas.map_json_type_to_python("prop", {}) == "Any"


def test_compile_properties_to_pydantic():
    # Required property
    props = {"title": {"type": "string", "description": "Simple title"}}
    lines = generate_schemas.compile_properties_to_pydantic(props, ["title"])
    assert len(lines) == 1
    assert lines[0] == '    title: str = Field(..., description="Simple title")'

    # Optional property
    props = {"title": {"type": "string"}}
    lines = generate_schemas.compile_properties_to_pydantic(props, [])
    assert len(lines) == 1
    assert lines[0] == "    title: Optional[str] = Field(None)"

    # Default values
    props = {
        "num": {"type": "integer", "default": 42},
        "text": {"type": "string", "default": "hello"},
    }
    lines = generate_schemas.compile_properties_to_pydantic(props, [])
    assert len(lines) == 2
    assert "    num: Optional[int] = Field(default=42)" in lines
    assert '    text: Optional[str] = Field(default="hello")' in lines

    # Ignores component keyword in properties
    props = {"component": {"type": "string"}}
    lines = generate_schemas.compile_properties_to_pydantic(props, [])
    assert len(lines) == 0


def test_compile_component_to_pydantic():
    schema = {
        "properties": {
            "component": {"const": "MyComp"},
            "id": {"type": "string"},  # inherited, should be skipped
            "text": {"type": "string"},
            "accessibility": {"type": "object"},  # inherited, should be skipped
        },
        "required": ["component", "text"],
    }
    code = generate_schemas.compile_component_to_pydantic("MyComp", schema)
    assert "class MyCompComponent(ComponentCommon):" in code
    assert '    component: Literal["MyComp"] = "MyComp"' in code
    assert "    text: str = Field(...)" in code
    assert "id: " not in code
    assert "accessibility: " not in code


def test_compile_object_def():
    # Extends StrictBaseModel by default
    spec = {"properties": {"x": {"type": "number"}}, "required": ["x"]}
    code = generate_schemas.compile_object_def("Point", spec)
    assert "class Point(StrictBaseModel):" in code
    assert "    x: float = Field(...)" in code

    # Extends BaseModel if additionalProperties is true
    spec = {"properties": {"x": {"type": "number"}}, "additionalProperties": True}
    code = generate_schemas.compile_object_def("Point", spec)
    assert "class Point(BaseModel):" in code

    # Empty object definition
    code = generate_schemas.compile_object_def("Empty", {})
    assert "class Empty(StrictBaseModel):" in code
    assert "    pass" in code


def test_compile_union_def():
    spec = {
        "oneOf": [{"type": "string"}, {"$ref": "common_types.json#/$defs/DataBinding"}]
    }
    code = generate_schemas.compile_union_def("StringOrBinding", spec)
    assert code == "StringOrBinding = Union[str, DataBinding]\n"


def test_compile_function_to_pydantic():
    # Function with args
    schema = {
        "properties": {
            "args": {"properties": {"x": {"type": "integer"}}, "required": ["x"]},
            "returnType": {"const": "boolean"},
        }
    }
    code, class_name = generate_schemas.compile_function_to_pydantic("add", schema)
    assert class_name == "AddApi"
    assert "class AddArgs(StrictBaseModel):" in code
    assert "    x: int = Field(...)" in code
    assert "class AddApi(FunctionApi):" in code
    assert '    name = "add"' in code
    assert "    schema = AddArgs" in code
    assert '    return_type = "boolean"' in code

    # Function with no args
    schema = {"properties": {"returnType": {"const": "number"}}}
    code, class_name = generate_schemas.compile_function_to_pydantic("random", schema)
    assert class_name == "RandomApi"
    assert "class RandomApi(FunctionApi):" in code
    assert '    name = "random"' in code
    assert "    schema = None" in code
    assert '    return_type = "number"' in code


def test_generate_common_types():
    mock_common_data = {
        "$defs": {
            "DataBinding": {"properties": {"path": {"type": "string"}}},
            "FunctionCall": {"properties": {"call": {"type": "string"}}},
            "DynamicValue": {"oneOf": [{"type": "string"}]},
            "DynamicString": {"oneOf": [{"type": "string"}]},
            "DynamicNumber": {"oneOf": [{"type": "number"}]},
            "DynamicBoolean": {"oneOf": [{"type": "boolean"}]},
            "DynamicStringList": {
                "oneOf": [{"type": "array", "items": {"type": "string"}}]
            },
            "ChildList": {
                "oneOf": [
                    {"type": "array", "items": {"type": "string"}},
                    {"properties": {"template": {"type": "string"}}},
                ]
            },
            "AccessibilityAttributes": {"properties": {"label": {"type": "string"}}},
            "CheckRule": {"properties": {"rule": {"type": "string"}}},
            "Action": {
                "oneOf": [
                    {
                        "properties": {
                            "event": {"properties": {"name": {"type": "string"}}}
                        }
                    },
                    {"properties": {"call": {"type": "string"}}},
                ]
            },
            "ComponentCommon": {"properties": {"id": {"type": "string"}}},
        }
    }
    code = generate_schemas.generate_common_types(mock_common_data)
    assert "class StrictBaseModel(BaseModel):" in code
    assert "ComponentId = SingleReference" in code
    assert "class DataBinding(StrictBaseModel):" in code
    assert "class FunctionCall(StrictBaseModel):" in code
    assert "DynamicValue = Union[str]" in code
    assert "ChildList = Union[List[ComponentId], TemplateChildList]" in code


def test_generate_basic_catalog_components():
    # Scenario A: No $defs/anyComponent/oneOf provided (fallback to all components)
    mock_catalog_data = {
        "components": {
            "Text": {"properties": {"text": {"type": "string"}}, "required": ["text"]}
        }
    }
    code, names = generate_schemas.generate_basic_catalog_components(mock_catalog_data)
    assert names == [
        "CatalogComponentCommon",
        "TextComponent",
        "AnyComponent",
        "BASIC_COMPONENTS",
        "TEXT_COMPONENT_API",
    ]
    assert "class CatalogComponentCommon(ComponentCommon):" in code
    assert "class TextComponent(CatalogComponentCommon):" in code
    assert "AnyComponent = Annotated[" in code
    assert "TextComponent," in code
    assert "TEXT_COMPONENT_API = ModelComponentApi(TextComponent)" in code

    # Scenario B: $defs/anyComponent/oneOf is defined.
    # It must intersect: only components BOTH generated AND in oneOf are exported/included.
    mock_catalog_data_defs = {
        "components": {
            "Text": {"properties": {"text": {"type": "string"}}},
            "PrivateHelper": {"properties": {"helper": {"type": "string"}}},
        },
        "$defs": {
            "anyComponent": {
                "oneOf": [
                    {"$ref": "#/components/Text"},
                    {
                        "$ref": "#/components/NonExistent"
                    },  # In oneOf, but not in components map
                ]
            }
        },
    }
    code_defs, names_defs = generate_schemas.generate_basic_catalog_components(
        mock_catalog_data_defs
    )
    # "PrivateHelperComponent" is not in oneOf, so it shouldn't be in any_comp_names.
    # "NonExistentComponent" is not in components map, so it shouldn't be in any_comp_names.
    # Only "TextComponent" is in both! (and AnyComponent is always appended to any_comp_names)
    assert names_defs == [
        "CatalogComponentCommon",
        "TextComponent",
        "AnyComponent",
        "BASIC_COMPONENTS",
        "TEXT_COMPONENT_API",
        "PRIVATE_HELPER_COMPONENT_API",
    ]
    assert "class CatalogComponentCommon(ComponentCommon):" in code_defs
    assert "class TextComponent(CatalogComponentCommon):" in code_defs
    assert (
        "class PrivateHelperComponent(CatalogComponentCommon):" in code_defs
    )  # Class is still generated!
    assert "        TextComponent," in code_defs
    assert (
        "        PrivateHelperComponent," not in code_defs
    )  # But NOT in AnyComponent union!
    assert (
        "        NonExistentComponent," not in code_defs
    )  # And non-existent is not in Union!

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
    code_svg, names_svg = generate_schemas.generate_basic_catalog_components(
        mock_catalog_data_svg
    )
    assert "SvgPath" in names_svg
    assert "class SvgPath(StrictBaseModel):" in code_svg
    assert '    svg_path: str = Field(..., alias="svgPath")' in code_svg
    assert 'Union[Literal["add", "close"], SvgPath]' in code_svg


def test_generate_basic_catalog_functions():
    # Scenario A: Fallback to all functions
    mock_catalog_data = {
        "functions": {
            "toast": {
                "properties": {"args": {"properties": {"message": {"type": "string"}}}}
            }
        }
    }
    code, names = generate_schemas.generate_basic_catalog_functions(mock_catalog_data)
    assert names == ["ToastApi"]
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
    code_defs, names_defs = generate_schemas.generate_basic_catalog_functions(
        mock_catalog_data_defs
    )
    assert names_defs == ["ToastApi"]
    assert "class ToastApi(FunctionApi):" in code_defs
    assert "class PrivateFuncApi(FunctionApi):" in code_defs


def test_generate_basic_catalog_styles():
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
    code = generate_schemas.generate_basic_catalog_styles(mock_catalog_data)
    assert "class Theme(BaseModel):" in code
    assert (
        'primary_color: Optional[str] = Field(None, alias="primaryColor", description="Test color.")'
        in code
    )


def test_generate_server_to_client():
    mock_s2c_data = {
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
    code, names = generate_schemas.generate_server_to_client(mock_s2c_data)
    assert names == ["CreateSurfaceMessage"]
    assert "class CreateSurface(StrictBaseModel):" in code
    assert "class CreateSurfaceMessage(StrictBaseModel):" in code


def test_generate_schema_init():
    code = generate_schemas.generate_schema_init(["CreateSurfaceMessage"])
    assert "from .common_types import (" in code
    assert "from .constants import *" in code
    assert "    CreateSurfaceMessage as CreateSurfaceMessage," in code
    assert "    CreateSurface as CreateSurface," in code


def test_generate_client_capabilities():
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
    code = generate_schemas.generate_client_capabilities(mock_capabilities_data)
    assert "class FunctionDefinition(StrictBaseModel):" in code
    assert "class V09Capabilities(StrictBaseModel):" in code
    assert "class A2uiClientCapabilities(StrictBaseModel):" in code
    assert "v0_9: Optional[V09Capabilities] = Field(None, alias=SPEC_VERSION)" in code


def test_generate_client_to_server():
    mock_c2s_data = {
        "properties": {
            "action": {
                "properties": {"name": {"type": "string"}},
                "required": ["name"],
            },
            "error": {
                "oneOf": [
                    {
                        "title": "Validation Failed Error",
                        "properties": {"code": {"const": "VALIDATION_FAILED"}},
                        "required": ["code"],
                    }
                ]
            },
        }
    }
    code = generate_schemas.generate_client_to_server(mock_c2s_data)
    assert "class A2uiClientAction(StrictBaseModel):" in code
    assert "class A2uiValidationError(StrictBaseModel):" in code
    assert "code: Literal['VALIDATION_FAILED'] = Field(\"VALIDATION_FAILED\")" in code
    assert "A2uiClientError = Union[A2uiValidationError]\n" in code
    assert "class A2uiClientActionMessage(StrictBaseModel):" in code
    assert "class A2uiClientErrorMessage(StrictBaseModel):" in code
    assert (
        "A2uiClientMessage = Union[A2uiClientActionMessage, A2uiClientErrorMessage]"
        in code
    )


def test_const_keyword_mapping():
    assert (
        generate_schemas.map_json_type_to_python("code", {"const": "SUCCESS"})
        == "Literal['SUCCESS']"
    )
    assert (
        generate_schemas.map_json_type_to_python("num", {"const": 404})
        == "Literal[404]"
    )

    props = {"code": {"const": "FAIL"}}
    lines = generate_schemas.compile_properties_to_pydantic(props, ["code"])
    assert len(lines) == 1
    assert "    code: Literal['FAIL'] = Field(\"FAIL\")" in lines[0]


def test_file_header_preamble():
    header = generate_schemas.FILE_HEADER
    assert "Copyright 2026 Google LLC" in header
    assert "Auto-generated. Do not edit manually." in header
