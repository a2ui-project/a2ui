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

from __future__ import annotations
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Set, Tuple, Union

from .constants import VERSION_0_8, VERSION_0_9, VERSION_1_0
from .validator_v08 import (
    LegacyA2uiValidatorV08,
    extract_component_required_fields as v08_req,
    extract_component_ref_fields as v08_ref,
)
from a2ui.core.validating import A2uiValidator as CoreValidator
from a2ui.core.validating.integrity_checker import get_component_references
from a2ui.core.validating.topology_analyzer import analyze_topology
from a2ui.core.validating.validator import ValidationConfig, STRICT_VALIDATION
from a2ui.core.validating.catalog_schema_validator import CatalogSchemaValidator

if TYPE_CHECKING:
  from .catalog import A2uiCatalog


def extract_component_required_fields(catalog: A2uiCatalog) -> Dict[str, Set[str]]:
  if catalog.version == VERSION_0_8:
    return v08_req(catalog)
  cs = catalog.catalog_schema
  all_components = cs.get("components", {}) if isinstance(cs, dict) else {}
  req_map = {}
  for comp_name, comp_schema in all_components.items():
    reqs = set(comp_schema.get("required", [])) - {"component"}
    if reqs:
      req_map[comp_name] = reqs
  return req_map


def extract_component_ref_fields(
    catalog: A2uiCatalog,
) -> Dict[str, Tuple[Set[str], Set[str]]]:
  if catalog.version == VERSION_0_8:
    return v08_ref(catalog)
  result = CatalogSchemaValidator(
      catalog.core_catalog,
      catalog.common_types_schema,
  ).extract_ref_fields()
  return result


class A2uiValidatorWrapper:
  """Validates v0.9+ payloads using a2ui_core."""

  def __init__(self, catalog: A2uiCatalog):
    self._catalog = catalog
    self._validator = CoreValidator()

  def validate(
      self,
      a2ui_json: Union[Dict[str, Any], List[Any]],
      root_id: Optional[str] = None,
      config: ValidationConfig = STRICT_VALIDATION,
  ) -> None:
    self._validator.validate(
        schema_validator=CatalogSchemaValidator(
            self._catalog.core_catalog,
            self._catalog.common_types_schema,
        ),
        a2ui_payload=a2ui_json,
        config=config,
    )


class A2uiValidatorWrapperV10:
  """Validates v1.0 payloads dynamically using jsonschema and core component integrity checks."""

  def __init__(self, catalog: A2uiCatalog):
    self._catalog = catalog
    from urllib.parse import urljoin
    from jsonschema import Draft202012Validator
    from referencing import Registry, Resource

    s2c = catalog.s2c_schema
    common = catalog.common_types_schema
    cat = catalog.catalog_schema

    resources = []
    for schema in [s2c, common]:
      if schema and "$id" in schema:
        resources.append((schema["$id"], Resource.from_contents(schema)))

    if cat and "$id" in cat:
      resources.append((cat["$id"], Resource.from_contents(cat)))
      s2c_id = s2c.get("$id", "") if s2c else ""
      if s2c_id:
        resolved_catalog_uri = urljoin(s2c_id, "catalog.json")
        resources.append((resolved_catalog_uri, Resource.from_contents(cat)))

    self._registry = Registry().with_resources(resources)
    self._wrapped_schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "array",
        "items": {"$ref": s2c["$id"]},
    }
    self._schema_validator = Draft202012Validator(
        self._wrapped_schema, registry=self._registry
    )

  def validate(
      self,
      a2ui_json: Union[Dict[str, Any], List[Any]],
      root_id: Optional[str] = None,
      config: ValidationConfig = STRICT_VALIDATION,
  ) -> None:
    messages = a2ui_json if isinstance(a2ui_json, list) else [a2ui_json]

    # 1. Run schema validation
    errors = list(self._schema_validator.iter_errors(messages))
    if errors:
      error = errors[0]
      msg = f"Validation failed: {error.message}"
      if error.context:
        msg += "\nContext failures:"
        for sub_error in error.context:
          msg += f"\n  - {sub_error.message}"
      raise ValueError(msg)

    # 2. Run component integrity validation
    from a2ui.core.validating.integrity_checker import (
        validate_component_integrity,
        validate_recursion_and_paths,
    )

    all_components = []
    for msg in messages:
      if not isinstance(msg, dict):
        continue
      if "createSurface" in msg and isinstance(msg["createSurface"], dict):
        all_components.extend(msg["createSurface"].get("components", []))
      elif "updateComponents" in msg and isinstance(msg["updateComponents"], dict):
        all_components.extend(msg["updateComponents"].get("components", []))

    if all_components:
      ref_fields = CatalogSchemaValidator(
          self._catalog.core_catalog,
          self._catalog.common_types_schema,
      ).extract_ref_fields()

      validate_component_integrity(
          all_components,
          ref_fields,
          allow_dangling_references=config.allow_dangling_references,
          allow_missing_root=config.allow_missing_root,
      )

      validate_recursion_and_paths(messages)


class A2uiValidator:
  """Version-aware validation facade dispatching to v0.8 or v0.9+ engines."""

  def __init__(self, catalog: A2uiCatalog):
    ver = catalog.version
    self.version = ver if isinstance(ver, str) else VERSION_0_8
    if self.version == VERSION_0_8:
      self._delegator = LegacyA2uiValidatorV08(catalog)
    elif self.version == VERSION_1_0:
      import os

      v1_0_enabled = os.environ.get("A2UI_VERSION_1_0", "").lower() in (
          "true",
          "1",
          "yes",
      )
      express_enabled = os.environ.get("A2UI_EXPRESS_ENABLED", "").lower() in (
          "true",
          "1",
          "yes",
      )
      if v1_0_enabled or express_enabled:
        self._delegator = A2uiValidatorWrapperV10(catalog)
      else:
        raise ValueError(
            "A2UI v1.0 validation is experimental and is disabled by default. "
            "To enable it, set the environment variable A2UI_VERSION_1_0=true."
        )
    else:
      self._delegator = A2uiValidatorWrapper(catalog)

  def validate(
      self,
      a2ui_json: Union[Dict[str, Any], List[Any]],
      root_id: Optional[str] = None,
      config: ValidationConfig = STRICT_VALIDATION,
  ) -> None:
    self._delegator.validate(a2ui_json, root_id=root_id, config=config)
