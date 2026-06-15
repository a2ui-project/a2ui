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

import os
import yaml
import pytest

from a2ui.basic_catalog import BasicCatalog
from a2ui.schema.catalog import A2uiCatalog
from a2ui.parser.streaming import A2uiStreamParser
from a2ui.schema.validator import A2uiValidator
from a2ui.schema.manager import A2uiSchemaManager, CatalogConfig
from a2ui.schema.common_modifiers import remove_strict_validation
from a2ui.schema.constants import VERSION_0_8, VERSION_0_9

import json
import re


class MemoryCatalogProvider:

  def __init__(self, schema):
    self.schema = schema

  def load(self):
    return self.schema


def _get_conformance_path(filename):
  return os.path.abspath(
      os.path.join(os.path.dirname(__file__), "../../../../conformance", filename)
  )


def load_json_file(filename):
  path = _get_conformance_path(filename)
  with open(path, "r", encoding="utf-8") as f:
    return json.load(f)


def load_tests(filename):
  path = _get_conformance_path(os.path.join("suites", filename))
  with open(path, "r", encoding="utf-8") as f:

    return yaml.safe_load(f)


def setup_catalog(catalog_config):
  version = str(catalog_config["version"])

  s2c_schema = catalog_config.get("s2c_schema")
  if isinstance(s2c_schema, str):
    s2c_schema = load_json_file(s2c_schema)

  catalog_schema = catalog_config.get("catalog_schema")
  if isinstance(catalog_schema, str):
    catalog_schema = load_json_file(catalog_schema)
  elif catalog_schema is None:
    catalog_schema = {}

  common_types_schema = catalog_config.get("common_types_schema")
  if isinstance(common_types_schema, str):
    common_types_schema = load_json_file(common_types_schema)
  elif common_types_schema is None:
    common_types_schema = {}

  custom_cuttable_keys = catalog_config.get("custom_cuttable_keys")
  return A2uiCatalog(
      version=version,
      name=catalog_config.get("name", "test_catalog"),
      s2c_schema=s2c_schema,
      common_types_schema=common_types_schema,
      catalog_schema=catalog_schema,
      custom_cuttable_keys=frozenset(custom_cuttable_keys)
      if custom_cuttable_keys is not None
      else None,
  )


def _align_error_match(expect_error: str) -> str:
  if not expect_error:
    return expect_error
  if "required property" in expect_error:
    return f"({expect_error}|Field required)"
  if "'v0.9' was expected" in expect_error:
    return f"({expect_error}|Input should be 'v0.9')"
  if "is not of type" in expect_error:
    return f"({expect_error}|Input should be a valid)"
  if "Validation failed" in expect_error:
    return f"({expect_error}|Field required|Extra inputs are not permitted)"
  return expect_error


def assert_parts_match(actual_parts, expected_parts):
  assert len(actual_parts) == len(expected_parts)
  for actual, expected in zip(actual_parts, expected_parts):
    assert actual.text == expected.get("text", "")
    assert actual.a2ui_json == expected.get("a2ui")


def get_conformance_cases(filename):
  cases = load_tests(filename)
  return [(case["name"], case) for case in cases]


# --- Streaming Parser Conformance ---
cases_parser = get_conformance_cases("streaming_parser.yaml")


@pytest.mark.parametrize(
    "name, test_case", cases_parser, ids=[c[0] for c in cases_parser]
)
def test_parser_conformance(name, test_case):
  catalog_config = test_case["catalog"]
  catalog = setup_catalog(catalog_config)
  parser = A2uiStreamParser(catalog=catalog)
  if test_case.get("disable_validation"):
    parser._validator = None

  steps = test_case.get("steps")
  if steps is None and "process_chunk" in test_case:
    steps = test_case["process_chunk"]

  if steps is None and "input" in test_case:
    steps = [test_case]

  for step in steps:
    expect_error = step.get("expect_error") or test_case.get("expect_error")
    if expect_error:
      with pytest.raises(ValueError, match=_align_error_match(expect_error)):
        parser.process_chunk(step["input"])
    else:
      parts = parser.process_chunk(step["input"])
      assert_parts_match(parts, step["expect"])


# --- Non-Streaming Parser Conformance ---
cases_parser_non_streaming = get_conformance_cases("parser.yaml")


@pytest.mark.parametrize(
    "name, test_case",
    cases_parser_non_streaming,
    ids=[c[0] for c in cases_parser_non_streaming],
)
def test_parser_non_streaming_conformance(name, test_case):
  from a2ui.parser.parser import parse_response
  from a2ui.parser.payload_fixer import parse_and_fix

  action = test_case.get("action", "parse_full")
  content = test_case["input"]

  if action == "parse_full":
    if "expect_error" in test_case:
      with pytest.raises(ValueError, match=test_case["expect_error"]):
        parse_response(content)
    else:
      parts = parse_response(content)
      expected = test_case["expect"]
      assert len(parts) == len(expected)
      for actual, exp in zip(parts, expected):
        assert actual.text.strip() == exp.get("text", "").strip()
        assert actual.a2ui_json == exp.get("a2ui")

  elif action == "fix_payload":
    if "expect_error" in test_case:
      with pytest.raises(ValueError, match=test_case["expect_error"]):
        parse_and_fix(content)
    else:
      result = parse_and_fix(content)
      assert result == test_case["expect"]

  elif action == "has_parts":
    from a2ui.parser.parser import has_a2ui_parts

    result = has_a2ui_parts(content)
    assert result == test_case["expect"]


# --- Validator Conformance ---

cases_validator = get_conformance_cases("validator.yaml")


@pytest.mark.parametrize(
    "name, test_case", cases_validator, ids=[c[0] for c in cases_validator]
)
def test_validator_conformance(name, test_case):
  catalog_config = test_case["catalog"]
  catalog = setup_catalog(catalog_config)

  steps = test_case.get("steps")
  if steps is None and "validate" in test_case:
    steps = test_case["validate"]

  if steps is None and "payload" in test_case:
    steps = [test_case]

  for step in steps:
    validator = A2uiValidator(catalog=catalog)
    expect_error = step.get("expect_error") or test_case.get("expect_error")
    if expect_error:
      with pytest.raises(ValueError, match=_align_error_match(expect_error)):
        validator.validate(step["payload"])
    else:
      validator.validate(step["payload"])


# --- Catalog Conformance ---
cases_catalog = get_conformance_cases("catalog.yaml")


@pytest.mark.parametrize(
    "name, test_case", cases_catalog, ids=[c[0] for c in cases_catalog]
)
def test_catalog_conformance(name, test_case):
  catalog_config = test_case["catalog"]
  catalog = setup_catalog(catalog_config)
  action = test_case["action"]
  args = test_case.get("args", {})

  if action == "prune":
    allowed_components = args.get("allowed_components", [])
    allowed_messages = args.get("allowed_messages", [])
    pruned = catalog.with_pruning(allowed_components, allowed_messages)
    expected = test_case["expect"]
    if "catalog_schema" in expected:
      assert pruned.catalog_schema == expected["catalog_schema"]
    if "s2c_schema" in expected:
      assert pruned.s2c_schema == expected["s2c_schema"]
    if "common_types_schema" in expected:
      assert pruned.common_types_schema == expected["common_types_schema"]

  elif action == "render":
    output = catalog.render_as_llm_instructions()
    assert output.strip() == test_case["expect_output"].strip()

  elif action == "load":
    path = args.get("path")
    if path:
      full_path = os.path.join(
          os.path.dirname(__file__), "../../../../conformance", path
      )
    else:
      full_path = None
    validate = args.get("validate", False)
    if "expect_error" in test_case:
      with pytest.raises(ValueError, match=test_case["expect_error"]):
        catalog.load_examples(full_path, validate=validate)
    else:
      output = catalog.load_examples(full_path, validate=validate)
      assert output.strip() == test_case["expect_output"].strip()

  elif action == "remove_strict_validation":
    schema = args["schema"]
    modified = remove_strict_validation(schema)
    assert modified == test_case["expect"]["schema"]

  elif action == "verify_cuttable_keys":
    expected = test_case["expect"]["custom_cuttable_keys"]
    assert set(catalog.cuttable_keys) == set(expected)


# --- Schema Manager Conformance ---
cases_schema_manager = get_conformance_cases("schema_manager.yaml")


@pytest.mark.parametrize(
    "name, test_case",
    cases_schema_manager,
    ids=[c[0] for c in cases_schema_manager],
)
def test_schema_manager_conformance(name, test_case):
  action = test_case["action"]
  args = test_case.get("args", {})

  if action == "select_catalog":
    supported_catalogs = args.get("supported_catalogs", [])
    client_capabilities = args.get("client_capabilities", {})
    accepts_inline_catalogs = args.get("accepts_inline_catalogs", False)

    configs = []
    for cat_def in supported_catalogs:
      configs.append(
          CatalogConfig(
              name=cat_def["catalogId"],
              provider=MemoryCatalogProvider(cat_def),
          )
      )

    manager = A2uiSchemaManager(
        version=VERSION_0_9,
        catalogs=configs,
        accepts_inline_catalogs=accepts_inline_catalogs,
    )

    if "expect_error" in test_case:
      with pytest.raises(ValueError, match=test_case["expect_error"]):
        manager.get_selected_catalog(client_capabilities)
    else:
      selected = manager.get_selected_catalog(client_capabilities)
      if "expect_selected" in test_case:
        assert selected.catalog_id == test_case["expect_selected"]
      if "expect_catalog_schema" in test_case:
        assert selected.catalog_schema == test_case["expect_catalog_schema"]

  elif action == "load_catalog":
    catalog_configs = test_case.get("catalog_configs", [])
    modifiers = test_case.get("modifiers", [])
    schema_modifiers = []
    if "remove_strict_validation" in modifiers:
      schema_modifiers.append(remove_strict_validation)
    configs = []
    for cfg in catalog_configs:
      full_path = os.path.join(
          os.path.dirname(__file__), "../../../../conformance", cfg["path"]
      )
      configs.append(CatalogConfig.from_path(name=cfg["name"], catalog_path=full_path))
    manager = A2uiSchemaManager(
        version=VERSION_0_8, catalogs=configs, schema_modifiers=schema_modifiers
    )
    selected = manager.get_selected_catalog()
    expected = test_case["expect"]
    if "catalog_schema" in expected:
      assert selected.catalog_schema == expected["catalog_schema"]
    if "supported_catalog_ids" in expected:
      assert [c.catalog_id for c in manager._supported_catalogs] == expected[
          "supported_catalog_ids"
      ]

  elif action == "generate_prompt":
    version = args.get("version", VERSION_0_8)
    role = args.get("role_description", "")
    workflow = args.get("workflow_description", "")
    ui_desc = args.get("ui_description", "")

    examples_path = args.get("examples_path")
    if examples_path:
      examples_path = os.path.join(
          os.path.dirname(__file__), "../../../../conformance", examples_path
      )

    config = BasicCatalog.get_config(version)
    if examples_path:
      config = CatalogConfig(
          name=config.name,
          provider=config.provider,
          examples_path=examples_path,
      )

    manager = A2uiSchemaManager(
        version=version,
        catalogs=[config],
        accepts_inline_catalogs=args.get("accepts_inline_catalogs", False),
    )

    output = manager.generate_system_prompt(
        role_description=role,
        workflow_description=workflow,
        ui_description=ui_desc,
        include_schema=args.get("include_schema", False),
        include_examples=args.get("include_examples", False),
        client_ui_capabilities=args.get("client_ui_capabilities"),
        allowed_components=args.get("allowed_components"),
        allowed_messages=args.get("allowed_messages"),
    )

    output_normalized = re.sub(r"\s+", "", output.strip())

    if "expect_contains" in test_case:
      for expected in test_case["expect_contains"]:
        expected_normalized = re.sub(r"\s+", "", expected.strip())
        assert expected_normalized in output_normalized
