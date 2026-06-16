# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# /// script
# requires-python = ">=3.14"
# dependencies = [
#     "jsonschema",
# ]
# ///

import argparse
import copy
import json
import logging
import sys
import traceback
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional
from urllib.error import URLError

try:
  import jsonschema
except ImportError:
  jsonschema = None

# Set up logging
logger = logging.getLogger("a2ui-assembler")


class CatalogError(Exception):
  """Base exception for catalog assembly errors."""
  pass


def is_remote_uri(uri: str) -> bool:
  """Checks if the given URI is an HTTP/HTTPS address."""
  return uri.startswith(("http://", "https://"))


BASIC_CATALOG_URLS = {
    "0.8": "https://raw.githubusercontent.com/a2ui-project/a2ui/refs/heads/main/specification/v0_8/json/standard_catalog_definition.json",
    "0.9": "https://raw.githubusercontent.com/a2ui-project/a2ui/refs/heads/main/specification/v0_9/catalogs/basic/catalog.json",
    "1.0": "https://raw.githubusercontent.com/a2ui-project/a2ui/refs/heads/main/specification/v1_0/catalogs/basic/catalog.json"
}

COMMON_TYPES_URLS = {
    "0.9": "https://raw.githubusercontent.com/a2ui-project/a2ui/refs/heads/main/specification/v0_9/json/common_types.json",
    "1.0": "https://raw.githubusercontent.com/a2ui-project/a2ui/refs/heads/main/specification/v1_0/json/common_types.json"
}


class CatalogAssembler:
  """Assembles multiple catalogs into one, flattening external references."""

  # Maps well-known schema filenames to their local attribute overrides or versioned remote URLs.
  # This allows developers to work with local files while the tool defaults to remote sources.
  INTERCEPT_MAP = {
      "basic_catalog.json": ("local_basic_catalog_path", BASIC_CATALOG_URLS, "basic_catalog"),
      "standard_catalog_definition.json": (
          "local_basic_catalog_path",
          BASIC_CATALOG_URLS,
          "basic_catalog",
      ),
      "common_types.json": ("local_common_types_path", COMMON_TYPES_URLS, "common_types"),
  }

  def __init__(
      self,
      version: str,
      local_basic_catalog_path: Optional[str] = None,
      local_common_types_path: Optional[str] = None,
      max_depth: int = 50,
  ):
    self.version = version
    self.local_basic_catalog_path = local_basic_catalog_path
    self.local_common_types_path = local_common_types_path
    self.max_depth = max_depth
    self.definitions: dict[str, Any] = {}
    self.ref_mapping: dict[str, str] = {}
    self.used_def_keys: set[str] = set()
    self.file_cache: dict[str, dict[str, Any]] = {}

  def fetch_json(self, uri: str, referrer: Optional[str] = None) -> dict[str, Any]:
    """Fetches and caches JSON content from a local file or remote URL."""
    if uri in self.file_cache:
      return self.file_cache[uri]

    try:
      if is_remote_uri(uri):
        logger.debug(f"Fetching remote JSON: {uri}")
        req = urllib.request.Request(uri, headers={"User-Agent": "A2UI-Assembler/1.0"})
        with urllib.request.urlopen(req, timeout=10) as response:
          data = json.load(response)
      else:
        path = Path(uri)
        logger.debug(f"Reading local JSON: {path}")
        data = json.loads(path.read_text(encoding="utf-8"))

      self.file_cache[uri] = data
      return data
    except Exception as e:
      ref_msg = f" (referenced from {referrer})" if referrer else ""
      if isinstance(e, FileNotFoundError):
          raise CatalogError(f"File not found: {uri}{ref_msg}")
      elif isinstance(e, json.JSONDecodeError):
          raise CatalogError(f"Invalid JSON in {uri}{ref_msg}: {e}")
      elif isinstance(e, URLError):
          raise CatalogError(f"Network error fetching {uri}{ref_msg}: {e}")
      else:
          raise CatalogError(f"Unexpected error fetching {uri}{ref_msg}: {e}")

  def resolve_json_pointer(self, schema: Any, pointer: str) -> Any:
    """Resolves a JSON pointer against a schema."""
    # Normalize pointer and handle root cases
    clean_pointer = pointer.strip().lstrip("#")
    if not clean_pointer or clean_pointer == "/":
      return schema

    parts = clean_pointer.lstrip("/").split("/")
    current = schema
    try:
      for part in parts:
        # Handle RFC 6901 escaping
        part = part.replace("~1", "/").replace("~0", "~")
        if isinstance(current, list):
          current = current[int(part)]
        elif isinstance(current, dict):
          current = current[part]
        else:
          raise CatalogError(
            f"Cannot resolve pointer '{pointer}' through non-container type")
      return current
    except (KeyError, IndexError, ValueError) as e:
      raise CatalogError(f"Could not resolve pointer '{pointer}': {e}")

  def get_def_key(self, stem: str, pointer: str) -> str:
    """Generates a unique key for the $defs section."""
    parts = [p for p in pointer.split("/") if p and p != "#"]
    type_name = parts[-1] if parts else "root"
    clean_type_name = type_name.replace("#", "").lstrip("_") or "root"

    base_key = f"{stem}_{clean_type_name}"
    final_key = base_key
    counter = 1
    while final_key in self.used_def_keys:
      final_key = f"{base_key}_{counter}"
      counter += 1

    self.used_def_keys.add(final_key)
    return final_key

  def _resolve_ref_uri(self, ref: str, current_base_uri: str) -> tuple[str, str, str]:
    """Resolves a $ref URI to a target URI, stem, and fragment."""
    parsed = urllib.parse.urlparse(ref)
    file_part = parsed.path
    fragment = parsed.fragment or ""
    target_name = Path(file_part).name

    # Check if the reference targets one of our "core" schemas (e.g., basic_catalog.json)
    if target_name in self.INTERCEPT_MAP:
      attr_name, remote_urls, stem = self.INTERCEPT_MAP[target_name]
      local_path = getattr(self, attr_name)
      # Priority: Local override path > Remote versioned URL
      if local_path:
        target_uri = str(Path(local_path).resolve())
      else:
        target_uri = remote_urls[self.version]
      return target_uri, stem, fragment

    # Handle relative paths based on whether the current file is local or remote
    if is_remote_uri(current_base_uri):
      if is_remote_uri(ref):
        target_uri, fragment = urllib.parse.urldefrag(ref)
      else:
        target_uri = urllib.parse.urljoin(current_base_uri, file_part)
      stem = Path(urllib.parse.urlparse(target_uri).path).stem
    else:
      target_path = (Path(current_base_uri).parent / file_part).resolve()
      target_uri = str(target_path)
      stem = target_path.stem

    return target_uri, stem, fragment

  def _process_ref(self, schema: dict, current_base_uri: str, depth: int) -> None:
    """Resolves an external $ref and updates the schema in place."""
    ref = schema["$ref"]
    
    parsed_ref = urllib.parse.urlparse(ref)
    
    # Treat references to catalog.json as references to the assembled catalog root.
    if Path(parsed_ref.path).name == "catalog.json":
      schema["$ref"] = f"#{parsed_ref.fragment}"
      return

    # Determine target URI and fragment.
    if ref.startswith("#"):
      # Reference is local to the CURRENT file we are processing.
      target_uri = current_base_uri
      fragment = ref.lstrip("#")
      if is_remote_uri(target_uri):
        stem = Path(urllib.parse.urlparse(target_uri).path).stem
      else:
        stem = Path(target_uri).stem
    else:
      target_uri, stem, fragment = self._resolve_ref_uri(ref, current_base_uri)

    full_ref_id = f"{target_uri}#{fragment}"

    if full_ref_id in self.ref_mapping:
      schema["$ref"] = f"#/$defs/{self.ref_mapping[full_ref_id]}"
    else:
      file_data = self.fetch_json(target_uri, referrer=current_base_uri)
      target_subschema = self.resolve_json_pointer(file_data, fragment)

      def_key = self.get_def_key(stem, fragment)
      self.ref_mapping[full_ref_id] = def_key

      processed_sub = self.process_schema(copy.deepcopy(target_subschema), target_uri, depth + 1)
      self.definitions[def_key] = processed_sub
      schema["$ref"] = f"#/$defs/{def_key}"

  def process_schema(self, schema: Any, current_base_uri: str, depth: int = 0) -> Any:
    """Recursively processes a schema to flatten external $refs into $defs."""
    if depth > self.max_depth:
      raise CatalogError(f"Max recursion depth reached ({self.max_depth}) at {current_base_uri}. Check for circular $ref dependencies.")

    if isinstance(schema, dict):
      if "$ref" in schema:
        self._process_ref(schema, current_base_uri, depth)
      
      # Process nested keywords. We skip "$ref" because it was already updated 
      # to a local pointer (e.g., #/$defs/...) by _process_ref.
      for key, value in schema.items():
        if key != "$ref":
          schema[key] = self.process_schema(value, current_base_uri, depth)
    elif isinstance(schema, list):
      for i, item in enumerate(schema):
        schema[i] = self.process_schema(item, current_base_uri, depth)

    return schema

  def _normalize_uri(self, uri: str) -> str:
    """Normalizes a URI, resolving local paths to absolute strings."""
    return str(uri) if is_remote_uri(str(uri)) else str(Path(uri).resolve())

  def _merge_categories(self, source: dict[str, Any], target: dict[str, Any]) -> None:
    """Merges components, functions, and instructions from source catalog into target."""
    category_singular_map = {"components": "Component", "functions": "Function"}
    for category, label in category_singular_map.items():
      if category in source:
        for k, v in source[category].items():
          if k in target[category]:
            logger.warning(f"{label} collision: '{k}' already exists. Overwriting.")
          target[category][k] = v

    if "instructions" in source and isinstance(source["instructions"], str):
      if "instructions" not in target:
        target["instructions"] = source["instructions"]
      else:
        target["instructions"] += f"\n\n{source['instructions']}"

  def _init_combined_catalog(self, base_name: str, file_name: str, input_uris: list[str], custom_catalog_id: Optional[str] = None) -> dict[str, Any]:
    """Initializes the skeleton for the newly combined catalog."""
    catalog_id = custom_catalog_id if custom_catalog_id else f"urn:a2ui:catalog:{base_name}"
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": file_name,
        "title": f"{base_name} A2UI Catalog",
        "description": f"{base_name} A2UI catalog, including {', '.join(Path(uri).stem for uri in input_uris)}.",
        "catalogId": catalog_id,
        "components": {},
        "functions": {},
    }

  def _load_initial_theme(
      self, basic_catalog_uri: str
  ) -> tuple[dict[str, Any], dict[str, str]]:
    """Loads the initial theme from the basic catalog."""
    data = self.fetch_json(basic_catalog_uri)
    theme = {"type": "object", "properties": {}}
    sources = {}

    # Version 0.9+ theme location
    if "$defs" in data and "theme" in data["$defs"]:
      theme = copy.deepcopy(data["$defs"]["theme"])
    # Version 0.8 theme location
    elif "styles" in data:
      theme = {"type": "object", "properties": copy.deepcopy(data["styles"])}

    theme.setdefault("properties", {})
    for k in theme["properties"]:
      sources[k] = "basic_catalog"
    return theme, sources

  def _merge_catalog_theme(
      self,
      processed_data: dict[str, Any],
      catalog_stem: str,
      merged_theme: dict[str, Any],
      theme_property_sources: dict[str, str],
      is_basic: bool,
  ) -> None:
    """Merges theme properties from a processed catalog into the merged theme."""
    if is_basic:
      return

    cat_theme = {}
    if "$defs" in processed_data and "theme" in processed_data["$defs"]:
      cat_theme = processed_data["$defs"]["theme"]
    elif "styles" in processed_data:
      cat_theme = {"type": "object", "properties": processed_data["styles"]}

    if not cat_theme:
      return

    for prop_name, prop_def in cat_theme.get("properties", {}).items():
      # Collision Policy: Properties in basic_catalog can be overridden by any single catalog.
      # However, if two different custom catalogs define the same property, it is an error.
      if (
          prop_name in theme_property_sources
          and theme_property_sources[prop_name] != "basic_catalog"
      ):
        raise CatalogError(
            f"Theme property clash: '{prop_name}' is defined in both"
            f" '{theme_property_sources[prop_name]}' and '{catalog_stem}'"
        )
      merged_theme["properties"][prop_name] = prop_def
      theme_property_sources[prop_name] = catalog_stem

  def _synthesize_union_types(self, combined_catalog: dict, merged_theme: dict) -> None:
    """Finalizes the $defs section with union types and the merged theme."""
    if merged_theme.get("properties") or "type" in merged_theme:
      self.definitions["theme"] = merged_theme

    for category, synthesized_name in [("components", "anyComponent"), ("functions", "anyFunction")]:
      keys = sorted(combined_catalog[category].keys())
      one_of = [{"$ref": f"#/{category}/{k}"} for k in keys]
      self.definitions[synthesized_name] = {"oneOf": one_of if one_of else [{"type": "null"}]}
      if synthesized_name == "anyComponent":
        self.definitions[synthesized_name]["discriminator"] = {"propertyName": "component"}

  def assemble(self, name: str, input_uris: list[str], extend_basic: bool = False, catalog_id: Optional[str] = None, additional_instructions: Optional[list[Path]] = None) -> dict[str, Any]:
    """Assembles a list of catalog URIs into a single, unified catalog JSON."""
    if not input_uris:
      return {}

    file_path = Path(name).with_suffix(".json")
    combined_catalog = self._init_combined_catalog(file_path.stem, file_path.name, input_uris, custom_catalog_id=catalog_id)

    basic_uri = self._normalize_uri(self.local_basic_catalog_path or BASIC_CATALOG_URLS[self.version])
    merged_theme, theme_sources = self._load_initial_theme(basic_uri)

    uris_to_process: list[str] = []
    if extend_basic:
      uris_to_process.append(basic_uri)

    for uri in input_uris:
      normalized_uri = self._normalize_uri(uri)
      if normalized_uri not in uris_to_process:
        uris_to_process.append(normalized_uri)

    for base_uri in uris_to_process:
      catalog_stem = Path(urllib.parse.urlparse(base_uri).path).stem
      logger.info(f"  - Processing: {base_uri}")

      data = self.fetch_json(base_uri)
      processed_data = self.process_schema(copy.deepcopy(data), base_uri)
      self._merge_categories(processed_data, combined_catalog)
      self._merge_catalog_theme(processed_data, catalog_stem, merged_theme, theme_sources, base_uri == basic_uri)

    self._synthesize_union_types(combined_catalog, merged_theme)
    combined_catalog["$defs"] = self.definitions

    if additional_instructions:
      for instr_path in additional_instructions:
        if instr_path.exists():
          content = instr_path.read_text(encoding="utf-8").strip()
          if content:
            logger.info(f"  + Including instructions file: {instr_path}")
            if "instructions" not in combined_catalog:
              combined_catalog["instructions"] = content
            else:
              combined_catalog["instructions"] += f"\n\n{content}"
        else:
          logger.warning(f"Instructions file not found: {instr_path}")

    return combined_catalog



def validate_catalog(catalog: dict[str, Any]):
  """Optional validation using jsonschema if available."""
  if jsonschema is None:
    logger.debug("jsonschema not installed, skipping validation.")
    return

  try:
    # Basic check to see if it's a valid JSON schema itself
    jsonschema.Draft202012Validator.check_schema(catalog)
    logger.info("✅ Catalog is a valid JSON schema (Draft 2020-12)")
  except Exception as e:
    logger.error(f"❌ Validation error: {e}")


def detect_local_overrides(inputs: list[str]) -> tuple[Optional[str], Optional[str]]:
  """Detects if any core catalogs are provided locally in the inputs list."""
  local_basic = None
  local_common = None
  for inp in inputs:
    filename = Path(inp).name
    if filename in ["basic_catalog.json", "standard_catalog_definition.json"]:
      local_basic = inp
    elif filename == "common_types.json":
      local_common = inp
  return local_basic, local_common


def main():
  parser = argparse.ArgumentParser(description="Assemble multiple A2UI Catalogs into a single file.")
  parser.add_argument("inputs", nargs="+", help="Input paths or URLs to A2UI component catalog JSONs")
  parser.add_argument("--output-name", required=True, help="Name of the combined catalog")
  parser.add_argument("--catalog-id", type=str, help="Custom catalogId for the output. Defaults to urn:a2ui:catalog:<base_name>")
  parser.add_argument("--version", choices=["0.8", "0.9", "1.0"], default="0.9", help="A2UI basic_catalog version to use if remote")
  parser.add_argument("--extend-basic-catalog", action="store_true", help="Always include the entire basic_catalog.json in the output")
  parser.add_argument("--instructions", action="extend", nargs="*", type=Path, help="Additional Markdown instructions file(s) to include in the combined catalog (can be specified multiple times)")
  parser.add_argument("--out-dir", "-o", type=Path, default="dist", help="Output directory (default: dist)")
  parser.add_argument("--verbose", "-v", action="store_true", help="Enable verbose logging")

  args = parser.parse_args()

  # Configure logging
  log_level = logging.DEBUG if args.verbose else logging.INFO
  logging.basicConfig(level=log_level, format="%(message)s")

  output_filename = Path(args.output_name).with_suffix(".json").name
  local_basic, local_common = detect_local_overrides(args.inputs)

  logger.info(f"📦 Assembling {len(args.inputs)} catalogs into '{output_filename}' (Version: {args.version})")
  if args.extend_basic_catalog:
    logger.info("🔧 Extending with complete basic_catalog.json")

  try:
    assembler = CatalogAssembler(
        args.version,
        local_basic_catalog_path=local_basic,
        local_common_types_path=local_common,
    )
    final_schema = assembler.assemble(output_filename, args.inputs, extend_basic=args.extend_basic_catalog, catalog_id=args.catalog_id, additional_instructions=args.instructions)

    validate_catalog(final_schema)

    # Ensure out_dir is absolute relative to CWD
    resolved_out_dir = Path.cwd() / args.out_dir
    resolved_out_dir.mkdir(parents=True, exist_ok=True)
    out_path = resolved_out_dir / output_filename

    out_path.write_text(json.dumps(final_schema, indent=2), encoding="utf-8")
    logger.info(f"✅ Created: {out_path}")

  except CatalogError as e:
    logger.error(f"❌ Error: {e}")
    sys.exit(1)
  except Exception as e:
    logger.error(f"❌ Unexpected error: {e}")
    if args.verbose:
      traceback.print_exc()
    sys.exit(1)


if __name__ == "__main__":
  main()
