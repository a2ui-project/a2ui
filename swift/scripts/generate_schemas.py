#!/usr/bin/env python3
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

"""Generates static Swift JSON Schema definitions from the A2UI specification.

Reads the canonical JSON Schema files from `specification/v0_9_1/` and
`specification/v1_0/` and writes:
  - `swift/core/Sources/A2UIJSON/v0_9/*.swift`
  - `swift/core/Sources/A2UIJSON/v1_0/*.swift`
  - `swift/core/Sources/A2UIJSON/A2UICommonSchema.swift`
  - `swift/core/Sources/BasicCatalog/v0_9/Components/*Component.swift`
  - `swift/core/Sources/BasicCatalog/v1_0/Components/*Component.swift`
"""

import copy
import json
from pathlib import Path
import shutil
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
SPEC_V091_DIR = REPO_ROOT / "specification" / "v0_9_1"
SPEC_V10_DIR = REPO_ROOT / "specification" / "v1_0"

A2UI_JSON_DIR = REPO_ROOT / "swift" / "core" / "Sources" / "A2UIJSON"
A2UI_JSON_V09_DIR = A2UI_JSON_DIR / "v0_9"
A2UI_JSON_V10_DIR = A2UI_JSON_DIR / "v1_0"
A2UI_COMMON_SCHEMA_OUT = A2UI_JSON_DIR / "A2UICommonSchema.swift"

BASIC_CATALOG_DIR = REPO_ROOT / "swift" / "core" / "Sources" / "BasicCatalog"
LEGACY_BASIC_COMPONENTS_DIR = BASIC_CATALOG_DIR / "Components"
V09_BASIC_COMPONENTS_DIR = BASIC_CATALOG_DIR / "v0_9" / "Components"
V10_BASIC_COMPONENTS_DIR = BASIC_CATALOG_DIR / "v1_0" / "Components"

HEADER = """\
// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
// Generated from specification/ via swift/scripts/generate_schemas.py
"""

V091_BASE_URI = "https://a2ui.org/schemas/v0_9_1/common.json"
V10_BASE_URI = "https://a2ui.org/specification/v1_0/common_types.json"


def format_swift_multiline_json(
    data: Any, base_indent: int = 4, max_line_length: int = 98
) -> str:
  """Formats a JSON object into a Swift multiline string body wrapped <= max_line_length."""
  raw_json = json.dumps(data, indent=2, ensure_ascii=False)
  escaped_json = raw_json.replace("\\", "\\\\")
  prefix = " " * base_indent
  out_lines: list[str] = []

  for line in escaped_json.splitlines():
    full_line = prefix + line
    while len(full_line) > max_line_length:
      limit = max_line_length - 2  # leave room for ' \'
      split_idx = full_line.rfind(" ", base_indent + 4, limit + 1)
      if split_idx <= base_indent:
        split_idx = limit
      else:
        split_idx += 1  # keep the trailing space before '\'
      # Never split in the middle of an escaped backslash sequence '\\'
      backslashes = 0
      idx = split_idx - 1
      while idx >= 0 and full_line[idx] == "\\":
        backslashes += 1
        idx -= 1
      if backslashes % 2 == 1:
        split_idx -= 1
      chunk = full_line[:split_idx]
      remainder = full_line[split_idx:]
      out_lines.append(f"{chunk}\\")
      full_line = prefix + remainder
    out_lines.append(full_line)

  return "\n".join(out_lines)


def rewrite_refs(node: Any, is_v10: bool) -> Any:
  """Rewrites relative or versioned common_types.json $ref URIs to canonical base URIs."""
  if isinstance(node, list):
    return [rewrite_refs(item, is_v10=is_v10) for item in node]
  if isinstance(node, dict):
    out: dict[str, Any] = {}
    for k, v in node.items():
      if k == "$ref" and isinstance(v, str):
        if is_v10 and v.startswith("common_types.json#/"):
          suffix = v[len("common_types.json") :]
          out[k] = f"{V10_BASE_URI}{suffix}"
        elif not is_v10 and v.startswith(
            "https://a2ui.org/specification/v0_9/common_types.json#/"
        ):
          suffix = v[len("https://a2ui.org/specification/v0_9/common_types.json") :]
          out[k] = f"{V091_BASE_URI}{suffix}"
        else:
          out[k] = v
      else:
        out[k] = rewrite_refs(v, is_v10=is_v10)
    return out
  return node


def build_v09_component_schema(comp_def: dict[str, Any]) -> dict[str, Any]:
  """Builds the standalone v0.9.1 component JSON Schema from basic/catalog.json."""
  schema = copy.deepcopy(comp_def)
  schema = rewrite_refs(schema, is_v10=False)

  common_props = {
      "id": {"$ref": f"{V091_BASE_URI}#/$defs/ComponentId"},
      "accessibility": {"$ref": f"{V091_BASE_URI}#/$defs/AccessibilityAttributes"},
      "weight": {"type": "number"},
  }

  if "allOf" in schema and isinstance(schema["allOf"], list):
    filtered_all_of: list[dict[str, Any]] = []
    for item in schema["allOf"]:
      ref = item.get("$ref", "") if isinstance(item, dict) else ""
      if ref.endswith("/ComponentCommon") or ref.endswith("/CatalogComponentCommon"):
        continue
      if isinstance(item, dict) and "properties" in item:
        props = dict(item["properties"])
        for ck, cv in common_props.items():
          props.setdefault(ck, cv)
        item = dict(item)
        item["properties"] = props
      filtered_all_of.append(item)

    if len(filtered_all_of) == 1 and "properties" in filtered_all_of[0]:
      inner = filtered_all_of[0]
      result: dict[str, Any] = {
          "type": "object",
          "properties": inner["properties"],
          "unevaluatedProperties": False,
      }
      if "required" in inner:
        result["required"] = inner["required"]
      return result
    return {
        "type": "object",
        "allOf": filtered_all_of,
        "unevaluatedProperties": False,
    }

  props = dict(schema.get("properties", {}))
  for ck, cv in common_props.items():
    props.setdefault(ck, cv)
  result = {
      "type": "object",
      "properties": props,
      "unevaluatedProperties": False,
  }
  if "required" in schema:
    result["required"] = schema["required"]
  return result


def build_v10_component_schema(comp_def: dict[str, Any]) -> dict[str, Any]:
  """Builds the standalone v1.0 component JSON Schema from basic/catalog.json."""
  schema = copy.deepcopy(comp_def)
  schema = rewrite_refs(schema, is_v10=True)

  common_props = {
      "id": {"$ref": f"{V10_BASE_URI}#/$defs/ComponentId"},
      "catalogId": {"type": "string"},
      "accessibility": {"$ref": f"{V10_BASE_URI}#/$defs/AccessibilityAttributes"},
      "metadata": {
          "type": "object",
          "properties": {
              "extensions": {"$ref": f"{V10_BASE_URI}#/$defs/Extensions"}
          },
          "additionalProperties": False,
      },
  }

  if "allOf" in schema and isinstance(schema["allOf"], list):
    updated_all_of: list[dict[str, Any]] = []
    for item in schema["allOf"]:
      if isinstance(item, dict) and "properties" in item:
        props = dict(item["properties"])
        for ck, cv in common_props.items():
          props.setdefault(ck, cv)
        item = dict(item)
        item["properties"] = props
      updated_all_of.append(item)
    return {
        "type": "object",
        "allOf": updated_all_of,
        "unevaluatedProperties": False,
    }

  props = dict(schema.get("properties", {}))
  for ck, cv in common_props.items():
    props.setdefault(ck, cv)
  result: dict[str, Any] = {
      "type": "object",
      "properties": props,
      "unevaluatedProperties": False,
  }
  if "required" in schema:
    result["required"] = schema["required"]
  return result


def camel_case_component(name: str) -> str:
  return name[0].lower() + name[1:]


def write_standalone_schema_file(
    out_path: Path,
    type_name: str,
    doc_comment: str,
    schema_uri: str,
    schema_data: dict[str, Any],
) -> None:
  """Writes a standalone Swift schema enum file."""
  json_body = format_swift_multiline_json(schema_data, base_indent=4)
  content = f"""{HEADER}
import Foundation
import OrderedJSON

/// {doc_comment}
public enum {type_name} {{
  /// The canonical URI for this schema document.
  public static let schemaURI =
    "{schema_uri}"

  /// The parsed JSON Schema document as a `JSONValue`.
  public static let document: JSONValue = parseEmbedded(rawDocument)

  private static func parseEmbedded(_ raw: String) -> JSONValue {{
    do {{
      return try JSONValue.parse(raw)
    }} catch {{
      assertionFailure("Failed to parse embedded {type_name} document: \\(error)")
      return .object([:])
    }}
  }}

  private static let rawDocument = \"\"\"
{json_body}
    \"\"\"
}}
"""
  out_path.parent.mkdir(parents=True, exist_ok=True)
  out_path.write_text(content, encoding="utf-8")


def generate_v09_schemas() -> None:
  A2UI_JSON_V09_DIR.mkdir(parents=True, exist_ok=True)

  v091_common = json.loads(
      (SPEC_V091_DIR / "json" / "common_types.json").read_text(encoding="utf-8")
  )
  v091_common["$id"] = V091_BASE_URI
  v091_body = format_swift_multiline_json(v091_common, base_indent=4)

  v09_common_content = f"""{HEADER}
import Foundation
import OrderedJSON

/// A2UI v0.9 / v0.9.1 common types JSON Schema definitions.
public enum V09CommonTypesSchema {{
  /// The base URI for all A2UI v0.9.1 common type schemas.
  public static let baseURI =
    "{V091_BASE_URI}"

  /// Returns the full URI for a named A2UI v0.9.1 common type schema definition.
  public static func uri(for name: String) -> String {{
    "\\(baseURI)#/$defs/\\(name)"
  }}

  /// The complete A2UI v0.9.1 common types document as a parsed `JSONValue`.
  public static let document: JSONValue = parseEmbedded(rawDocument)

  /// Baseline v0.9 catalog stub satisfying `catalog.json#/$defs/anyFunction` references.
  public static let catalogFunctionStubDocument: JSONValue = parseEmbedded(
    catalogFunctionStubRawDocument
  )

  private static func parseEmbedded(_ raw: String) -> JSONValue {{
    do {{
      return try JSONValue.parse(raw)
    }} catch {{
      assertionFailure("Failed to parse embedded V09CommonTypesSchema document: \\(error)")
      return .object([:])
    }}
  }}

  private static let catalogFunctionStubRawDocument = \"\"\"
    {{
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "https://a2ui.org/schemas/v0_9_1/catalog.json",
      "$defs": {{
        "anyFunction": {{
          "type": "object",
          "properties": {{
            "call": {{ "type": "string" }},
            "args": {{ "type": "object" }},
            "returnType": {{ "type": "string" }}
          }},
          "required": ["call"],
          "additionalProperties": false
        }},
        "anyComponent": {{
          "type": "object"
        }},
        "theme": {{
          "type": "object"
        }}
      }}
    }}
    \"\"\"

  private static let rawDocument = \"\"\"
{v091_body}
    \"\"\"
}}
"""
  (A2UI_JSON_V09_DIR / "V09CommonTypesSchema.swift").write_text(
      v09_common_content, encoding="utf-8"
  )

  v09_s2c = json.loads(
      (SPEC_V091_DIR / "json" / "server_to_client.json").read_text(encoding="utf-8")
  )
  write_standalone_schema_file(
      out_path=A2UI_JSON_V09_DIR / "V09ServerToClientSchema.swift",
      type_name="V09ServerToClientSchema",
      doc_comment="A2UI v0.9 / v0.9.1 server-to-client message JSON Schema.",
      schema_uri=v09_s2c.get(
          "$id", "https://a2ui.org/specification/v0_9/server_to_client.json"
      ),
      schema_data=v09_s2c,
  )

  v09_c2s = json.loads(
      (SPEC_V091_DIR / "json" / "client_to_server.json").read_text(encoding="utf-8")
  )
  write_standalone_schema_file(
      out_path=A2UI_JSON_V09_DIR / "V09ClientToServerSchema.swift",
      type_name="V09ClientToServerSchema",
      doc_comment="A2UI v0.9 / v0.9.1 client-to-server event JSON Schema.",
      schema_uri=v09_c2s.get(
          "$id", "https://a2ui.org/specification/v0_9/client_to_server.json"
      ),
      schema_data=v09_c2s,
  )

  v09_caps = json.loads(
      (SPEC_V091_DIR / "json" / "client_capabilities.json").read_text(encoding="utf-8")
  )
  write_standalone_schema_file(
      out_path=A2UI_JSON_V09_DIR / "V09ClientCapabilitiesSchema.swift",
      type_name="V09ClientCapabilitiesSchema",
      doc_comment="A2UI v0.9 / v0.9.1 client capabilities JSON Schema.",
      schema_uri=v09_caps.get(
          "$id", "https://a2ui.org/specification/v0_9/client_capabilities.json"
      ),
      schema_data=v09_caps,
  )


def generate_v10_schemas() -> None:
  A2UI_JSON_V10_DIR.mkdir(parents=True, exist_ok=True)

  v10_common = json.loads(
      (SPEC_V10_DIR / "json" / "common_types.json").read_text(encoding="utf-8")
  )
  v10_body = format_swift_multiline_json(v10_common, base_indent=4)

  v10_common_content = f"""{HEADER}
import Foundation
import OrderedJSON

/// A2UI v1.0 common types JSON Schema definitions.
public enum V10CommonTypesSchema {{
  /// The base URI for all A2UI v1.0 common type schemas.
  public static let baseURI =
    "{V10_BASE_URI}"

  /// Returns the full URI for a named A2UI v1.0 common type schema definition.
  public static func uri(for name: String) -> String {{
    "\\(baseURI)#/$defs/\\(name)"
  }}

  /// The complete A2UI v1.0 common types document as a parsed `JSONValue`.
  public static let document: JSONValue = parseEmbedded(rawDocument)

  /// Baseline v1.0 catalog stub satisfying `catalog.json#/$defs/anyFunction` references.
  public static let catalogFunctionStubDocument: JSONValue = parseEmbedded(
    catalogFunctionStubRawDocument
  )

  private static func parseEmbedded(_ raw: String) -> JSONValue {{
    do {{
      return try JSONValue.parse(raw)
    }} catch {{
      assertionFailure("Failed to parse embedded V10CommonTypesSchema document: \\(error)")
      return .object([:])
    }}
  }}

  private static let catalogFunctionStubRawDocument = \"\"\"
    {{
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "https://a2ui.org/specification/v1_0/catalog.json",
      "$defs": {{
        "anyFunction": {{
          "type": "object",
          "not": {{
            "properties": {{
              "call": {{ "const": "@index" }}
            }},
            "required": ["call"]
          }},
          "properties": {{
            "call": {{ "type": "string" }},
            "catalogId": {{ "type": "string" }},
            "args": {{
              "type": "object",
              "additionalProperties": {{
                "$ref": "{V10_BASE_URI}#/$defs/DynamicValue"
              }}
            }}
          }},
          "required": ["call"]
        }},
        "anyComponent": {{
          "type": "object"
        }}
      }}
    }}
    \"\"\"

  private static let rawDocument = \"\"\"
{v10_body}
    \"\"\"
}}
"""
  (A2UI_JSON_V10_DIR / "V10CommonTypesSchema.swift").write_text(
      v10_common_content, encoding="utf-8"
  )

  v10_catalog_def = json.loads(
      (SPEC_V10_DIR / "json" / "catalog_definition.json").read_text(encoding="utf-8")
  )
  write_standalone_schema_file(
      out_path=A2UI_JSON_V10_DIR / "V10CatalogDefinitionSchema.swift",
      type_name="V10CatalogDefinitionSchema",
      doc_comment="A2UI v1.0 catalog definition JSON Schema.",
      schema_uri=v10_catalog_def.get(
          "$id", "https://a2ui.org/specification/v1_0/catalog_definition.json"
      ),
      schema_data=v10_catalog_def,
  )

  v10_a2r = json.loads(
      (SPEC_V10_DIR / "json" / "agent_to_renderer.json").read_text(encoding="utf-8")
  )
  write_standalone_schema_file(
      out_path=A2UI_JSON_V10_DIR / "V10AgentToRendererSchema.swift",
      type_name="V10AgentToRendererSchema",
      doc_comment="A2UI v1.0 agent-to-renderer message JSON Schema.",
      schema_uri=v10_a2r.get(
          "$id", "https://a2ui.org/specification/v1_0/agent_to_renderer.json"
      ),
      schema_data=v10_a2r,
  )

  v10_r2a = json.loads(
      (SPEC_V10_DIR / "json" / "renderer_to_agent.json").read_text(encoding="utf-8")
  )
  write_standalone_schema_file(
      out_path=A2UI_JSON_V10_DIR / "V10RendererToAgentSchema.swift",
      type_name="V10RendererToAgentSchema",
      doc_comment="A2UI v1.0 renderer-to-agent event JSON Schema.",
      schema_uri=v10_r2a.get(
          "$id", "https://a2ui.org/specification/v1_0/renderer_to_agent.json"
      ),
      schema_data=v10_r2a,
  )

  v10_caps = json.loads(
      (SPEC_V10_DIR / "json" / "renderer_capabilities.json").read_text(encoding="utf-8")
  )
  write_standalone_schema_file(
      out_path=A2UI_JSON_V10_DIR / "V10RendererCapabilitiesSchema.swift",
      type_name="V10RendererCapabilitiesSchema",
      doc_comment="A2UI v1.0 renderer capabilities JSON Schema.",
      schema_uri=v10_caps.get(
          "$id", "https://a2ui.org/specification/v1_0/renderer_capabilities.json"
      ),
      schema_data=v10_caps,
  )


def generate_a2ui_common_schema() -> None:
  generate_v09_schemas()
  generate_v10_schemas()

  content = f"""{HEADER}
import Foundation
import JSONSchema
import OrderedJSON

/// Namespace for A2UI common type schema URIs and schema registration.
///
/// Provides the base URIs and embedded specification JSON documents for
/// A2UI v0.9.1 and v1.0 common types and catalog definitions.
public enum A2UICommonSchema {{
  /// The base URI for all A2UI v0.9.1 common type schemas.
  public static let baseURI = V09CommonTypesSchema.baseURI

  /// Returns the full URI for a named A2UI v0.9.1 common type schema definition.
  ///
  /// - Parameter name: The name of the common type (e.g., `"DataBinding"`).
  /// - Returns: The full URI (e.g.,
  ///   `https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DataBinding`).
  public static func uri(for name: String) -> String {{
    V09CommonTypesSchema.uri(for: name)
  }}

  /// The base URI for all A2UI v1.0 common type schemas.
  public static let v10BaseURI = V10CommonTypesSchema.baseURI

  /// The base URI for the A2UI v1.0 catalog definition schema.
  public static let v10CatalogDefinitionURI = V10CatalogDefinitionSchema.schemaURI

  /// Returns the full URI for a named A2UI v1.0 common type schema definition.
  public static func v10URI(for name: String) -> String {{
    V10CommonTypesSchema.uri(for: name)
  }}

  /// The complete A2UI v0.9.1 common types document as a parsed `JSONValue`.
  public static let document: JSONValue = V09CommonTypesSchema.document

  /// The complete A2UI v1.0 common types document as a parsed `JSONValue`.
  public static let v10Document: JSONValue = V10CommonTypesSchema.document

  /// The complete A2UI v1.0 catalog definition document as a parsed `JSONValue`.
  public static let v10CatalogDefinitionDocument: JSONValue =
    V10CatalogDefinitionSchema.document

  /// Baseline v0.9 catalog stub satisfying `catalog.json#/$defs/anyFunction` references.
  public static let v09CatalogFunctionStubDocument: JSONValue =
    V09CommonTypesSchema.catalogFunctionStubDocument

  /// Baseline v1.0 catalog stub satisfying `catalog.json#/$defs/anyFunction` references.
  public static let v10CatalogFunctionStubDocument: JSONValue =
    V10CommonTypesSchema.catalogFunctionStubDocument

  public static var allSchemas: [String: JSONValue] {{
    [
      baseURI: document,
      v10BaseURI: v10Document,
      "common_types.json": v10Document,
      "https://swift-json-schema.invalid/common_types.json": v10Document,
      "https://a2ui.org/specification/v1_0/catalogs/basic/common_types.json": v10Document,
      v10CatalogDefinitionURI: v10CatalogDefinitionDocument,
      "catalog_definition.json": v10CatalogDefinitionDocument,
      "https://swift-json-schema.invalid/catalog_definition.json":
        v10CatalogDefinitionDocument,
      "https://a2ui.org/schemas/v0_9_1/catalog.json": v09CatalogFunctionStubDocument,
      "https://a2ui.org/specification/v0_9/catalog.json": v09CatalogFunctionStubDocument,
      "https://a2ui.org/specification/v0_9_1/catalog.json": v09CatalogFunctionStubDocument,
      "https://a2ui.org/specification/v1_0/catalog.json": v10CatalogFunctionStubDocument,
      "catalog.json": v10CatalogFunctionStubDocument,
      "https://swift-json-schema.invalid/catalog.json": v10CatalogFunctionStubDocument,
    ]
  }}
}}
"""
  A2UI_COMMON_SCHEMA_OUT.write_text(content, encoding="utf-8")


def generate_basic_catalog_components() -> None:
  v091_catalog = json.loads(
      (SPEC_V091_DIR / "catalogs" / "basic" / "catalog.json").read_text(
          encoding="utf-8"
      )
  )
  v10_catalog = json.loads(
      (REPO_ROOT / "catalogs" / "basic" / "v1" / "catalog.json").read_text(
          encoding="utf-8"
      )
  )

  v091_components = v091_catalog["components"]
  v10_components = v10_catalog["components"]

  if V09_BASIC_COMPONENTS_DIR.exists():
    shutil.rmtree(V09_BASIC_COMPONENTS_DIR)
  if V10_BASIC_COMPONENTS_DIR.exists():
    shutil.rmtree(V10_BASIC_COMPONENTS_DIR)
  V09_BASIC_COMPONENTS_DIR.mkdir(parents=True, exist_ok=True)
  V10_BASIC_COMPONENTS_DIR.mkdir(parents=True, exist_ok=True)

  for comp_name, v091_def in v091_components.items():
    v10_def = v10_components[comp_name]
    v09_schema = build_v09_component_schema(v091_def)
    v10_schema = build_v10_component_schema(v10_def)

    prop_name = camel_case_component(comp_name)

    v09_json_body = format_swift_multiline_json(v09_schema, base_indent=8)
    v10_json_body = format_swift_multiline_json(v10_schema, base_indent=8)

    format_validators_arg = (
        ",\n      formatValidators: DefaultFormatValidators.all"
        if comp_name == "DateTimeInput"
        else ""
    )

    v09_file = V09_BASIC_COMPONENTS_DIR / f"V09{comp_name}Component.swift"
    v09_content = f"""{HEADER}
import A2UICore
import A2UIJSON
import JSONSchema

extension V09BasicCatalogComponents {{
  // MARK: - {comp_name} (v0.9)
  public static let {prop_name} = AnyComponentAPI(
    name: "{comp_name}",
    schema: try! Schema(
      instance: \"\"\"
{v09_json_body}
        \"\"\",
      remoteSchemas: A2UICommonSchema.allSchemas{format_validators_arg}
    )
  )
}}
"""
    v09_file.write_text(v09_content, encoding="utf-8")

    v10_file = V10_BASIC_COMPONENTS_DIR / f"V10{comp_name}Component.swift"
    v10_content = f"""{HEADER}
import A2UICore
import A2UIJSON
import JSONSchema

extension V10BasicCatalogComponents {{
  // MARK: - {comp_name} (v1.0)
  public static let {prop_name} = AnyComponentAPI(
    name: "{comp_name}",
    schema: try! Schema(
      instance: \"\"\"
{v10_json_body}
        \"\"\",
      remoteSchemas: A2UICommonSchema.allSchemas{format_validators_arg}
    )
  )
}}
"""
    v10_file.write_text(v10_content, encoding="utf-8")

  if LEGACY_BASIC_COMPONENTS_DIR.exists():
    shutil.rmtree(LEGACY_BASIC_COMPONENTS_DIR)


def main() -> None:
  generate_a2ui_common_schema()
  generate_basic_catalog_components()
  print("Successfully generated Swift schemas from specification/.")


if __name__ == "__main__":
  main()
