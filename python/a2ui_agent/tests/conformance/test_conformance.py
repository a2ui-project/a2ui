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

import os
import yaml
import pytest
from .conformance_helpers import (
    get_conformance_path,
    load_conformance_json as load_json_file,
    load_conformance_yaml as load_tests,
)

from a2ui.basic_catalog import BasicCatalog
from a2ui.schema.catalog import A2uiCatalog
from a2ui.inference_formats.direct_json import DirectJsonFormat, DirectJsonStreamParser
from a2ui.core.processing import MessageProcessor
from a2ui.schema.catalog import CatalogConfig
from a2ui.schema.common_modifiers import remove_strict_validation
from a2ui.schema.constants import VERSION_0_8, VERSION_0_9
from a2ui.core import (
    A2uiError,
    A2uiParseError,
    A2uiValidationError,
    A2uiCatalogError,
    A2uiIntegrityError,
    A2uiRecursionError,
    A2uiCompileError,
)

import json
import re

import contextlib

CATEGORY_TO_EXCEPTION = {
    "ParseError": A2uiParseError,
    "ValidationError": A2uiValidationError,
    "CatalogError": A2uiCatalogError,
    "IntegrityError": A2uiIntegrityError,
    "RecursionError": A2uiRecursionError,
    "CompileError": A2uiCompileError,
}

# Set of A2UI specification versions supported by this Python Agent SDK conformance harness.
SUPPORTED_PROTOCOL_VERSIONS = {"v0.8", "v0.9", "v1.0"}

# Transition skip list containing specific test case names to skip during active feature transitions.
SKIP_TEST_NAMES = set()

# Transition skip list containing specific test suite files to skip during active feature transitions.
SKIP_TEST_SUITES = {
    "core/catalog.yaml",
    "core/validator.yaml",
}


@contextlib.contextmanager
def assert_raises(expect_error):
    if isinstance(expect_error, dict):
        category = expect_error.get("category")
        message = expect_error.get("message", "")
        expected_class = CATEGORY_TO_EXCEPTION.get(category, A2uiError)
        expected_details = expect_error.get("details", None)
    else:
        expected_class = ValueError
        message = expect_error
        expected_details = None

    with pytest.raises(expected_class) as excinfo:
        yield

    if message:
        assert re.search(_align_error_match(message), str(excinfo.value))

    if expected_details is not None:
        actual_details = getattr(excinfo.value, "details", [])
        for expected in expected_details:
            exp_path = expected["path"]
            exp_code = expected["code"]
            found = False
            for actual in actual_details:
                act_path = getattr(actual, "path", None) or actual.get("path")
                act_code = getattr(actual, "code", None) or actual.get("code")
                if act_path == exp_path and act_code == exp_code:
                    found = True
                    break
            assert found, (
                f"Expected validation error detail with path '{exp_path}' and code"
                f" '{exp_code}' not found in:"
                f" {[getattr(d, 'to_dict', lambda: d)() for d in actual_details]}"
            )


class MemoryCatalogProvider:

    def __init__(self, schema):
        self.schema = schema

    def load(self):
        return self.schema


def setup_catalog(catalog_config):
    version = str(catalog_config.get("protocolVersion", "v0.9")).removeprefix("v")

    s2c_schema = catalog_config.get("s2cSchema")
    if isinstance(s2c_schema, str):
        s2c_schema = load_json_file(s2c_schema)

    catalog_schema = catalog_config.get("catalogSchema")
    if isinstance(catalog_schema, str):
        catalog_schema = load_json_file(catalog_schema)
    elif catalog_schema is None:
        catalog_schema = {}

    common_types_schema = catalog_config.get("commonTypesSchema")
    if isinstance(common_types_schema, str):
        common_types_schema = load_json_file(common_types_schema)
    elif common_types_schema is None:
        common_types_schema = {}

    custom_cuttable_keys = catalog_config.get("customCuttableKeys")
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
    if filename in SKIP_TEST_SUITES or os.path.basename(filename) in SKIP_TEST_SUITES:
        return []

    cases = load_tests(filename)
    filtered = []
    for case in cases:
        name = case.get("name")
        catalog = (
            case.get("catalog", {}) if isinstance(case.get("catalog"), dict) else {}
        )
        version = str(catalog.get("protocolVersion", "v0.9"))
        if not version.startswith("v"):
            version = f"v{version}"

        if version not in SUPPORTED_PROTOCOL_VERSIONS or name in SKIP_TEST_NAMES:
            continue
        filtered.append((name, case))
    return filtered


# --- Streaming Parser Conformance ---
cases_parser = get_conformance_cases("agent/streaming_parser.yaml")


@pytest.mark.parametrize(
    "name, test_case", cases_parser, ids=[c[0] for c in cases_parser]
)
def test_parser_conformance(name, test_case):
    catalog_config = test_case["catalog"]
    catalog = setup_catalog(catalog_config)
    parser = DirectJsonStreamParser(catalog=catalog)
    if test_case.get("disableValidation"):
        parser._validator = None

    steps = test_case.get("steps")
    if steps is None and "process_chunk" in test_case:
        steps = test_case["process_chunk"]

    if steps is None and "input" in test_case:
        steps = [test_case]

    for step in steps:
        expect_error = step.get("expectError") or test_case.get("expectError")
        if expect_error:
            with assert_raises(expect_error):
                parser.process_chunk(step["input"])
        else:
            parts = parser.process_chunk(step["input"])
            assert_parts_match(parts, step["expect"])


# --- Non-Streaming Parser Conformance ---
cases_parser_non_streaming = get_conformance_cases("agent/parser.yaml")


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
        expect_error = test_case.get("expectError")
        if expect_error:
            with assert_raises(expect_error):
                parse_response(content)
        else:
            parts = parse_response(content)
            expected = test_case["expect"]
            assert len(parts) == len(expected)
            for actual, exp in zip(parts, expected):
                assert actual.text.strip() == exp.get("text", "").strip()
                assert actual.a2ui_json == exp.get("a2ui")

    elif action == "fix_payload":
        expect_error = test_case.get("expectError")
        if expect_error:
            with assert_raises(expect_error):
                parse_and_fix(content)
        else:
            result = parse_and_fix(content)
            assert result == test_case["expect"]

    elif action == "has_parts":
        from a2ui.parser.parser import has_a2ui_parts

        result = has_a2ui_parts(content)
        assert result == test_case["expect"]


# --- Schema Manager Conformance ---
cases_schema_manager = get_conformance_cases("agent/inference_format.yaml")


@pytest.mark.parametrize(
    "name, test_case",
    cases_schema_manager,
    ids=[c[0] for c in cases_schema_manager],
)
def test_schema_manager_conformance(name, test_case):
    action = test_case["action"]
    args = test_case.get("args", {})

    if action == "select_catalog":
        supported_catalogs = args.get("supportedCatalogs", [])
        client_capabilities = args.get("clientCapabilities", {})
        accepts_inline_catalogs = args.get("acceptsInlineCatalogs", False)

        configs = []
        for cat_def in supported_catalogs:
            configs.append(
                CatalogConfig(
                    name=cat_def["catalogId"],
                    provider=MemoryCatalogProvider(cat_def),
                )
            )

        direct_json_format = DirectJsonFormat(
            version=VERSION_0_9,
            catalogs=configs,
            accepts_inline_catalogs=accepts_inline_catalogs,
        )

        expect_error = test_case.get("expectError")
        if expect_error:
            with assert_raises(expect_error):
                direct_json_format.get_selected_catalog(client_capabilities)
        else:
            selected = direct_json_format.get_selected_catalog(client_capabilities)
            if "expect" in test_case:
                expected = test_case["expect"]
                if isinstance(expected, dict):
                    assert selected.catalog_schema == expected
            expect_selected = test_case.get("expectSelected")
            if expect_selected:
                assert selected.catalog_id == expect_selected

    elif action == "load_catalog":
        catalog_configs = test_case.get("catalogConfigs", [])
        modifiers = test_case.get("modifiers", [])
        schema_modifiers = []
        if "remove_strict_validation" in modifiers:
            schema_modifiers.append(remove_strict_validation)
        configs = []
        for cfg in catalog_configs:
            full_path = get_conformance_path(cfg["path"])
            configs.append(
                CatalogConfig.from_path(name=cfg["name"], catalog_path=full_path)
            )
        direct_json_format = DirectJsonFormat(
            version=VERSION_0_8, catalogs=configs, schema_modifiers=schema_modifiers
        )
        selected = direct_json_format.get_selected_catalog()
        expected = test_case["expect"]
        if isinstance(expected, dict) and "supportedCatalogIds" in expected:
            exp_ids = expected["supportedCatalogIds"]
            assert [
                c.catalog_id for c in direct_json_format._supported_catalogs
            ] == exp_ids
        elif isinstance(expected, dict):
            assert selected.catalog_schema == expected

    elif action == "generate_prompt":
        version = args.get("version", VERSION_0_8)
        role = args.get("roleDescription", "")
        workflow = args.get("workflowDescription", "")
        ui_desc = args.get("uiDescription", "")

        examples_path = args.get("examplesPath")
        if examples_path:
            examples_path = get_conformance_path(examples_path)

        config = BasicCatalog.get_config(version)
        if examples_path:
            config = CatalogConfig(
                name=config.name,
                provider=config.provider,
                examples_path=examples_path,
            )

        accepts_inline = args.get("acceptsInlineCatalogs", False)
        direct_json_format = DirectJsonFormat(
            version=version,
            catalogs=[config],
            accepts_inline_catalogs=accepts_inline,
        )

        output = direct_json_format.generate_system_prompt(
            role_description=role,
            workflow_description=workflow,
            ui_description=ui_desc,
            include_schema=args.get("includeSchema", False),
            include_examples=args.get("includeExamples", False),
            client_ui_capabilities=args.get("clientUiCapabilities"),
            allowed_components=args.get("allowedComponents"),
            allowed_messages=args.get("allowedMessages"),
        )

        output_normalized = re.sub(r"\s+", "", output.strip())

        expect_contains = test_case.get("expectContains")
        if expect_contains:
            for expected in expect_contains:
                expected_normalized = re.sub(r"\s+", "", expected.strip())
                assert expected_normalized in output_normalized

    elif action == "parse_full":
        fmt_name = test_case.get("format", "direct_json")
        content = test_case["input"]

        from a2ui.core.catalog import Catalog
        from a2ui.schema.utils import get_basic_catalog_path

        with open(get_basic_catalog_path("v1_0"), "r", encoding="utf-8") as f:
            catalog_dict = json.load(f)
        core_cat = Catalog.from_json(catalog_dict, protocol_version="0.9.1")

        if fmt_name == "express":
            from a2ui.inference_formats.experimental.express import ExpressParser

            parser = ExpressParser(catalog=core_cat, surface_id="main", version="v1.0")
        elif fmt_name == "elemental":
            from a2ui.inference_formats.experimental.elemental import ElementalParser

            parser = ElementalParser(catalog=core_cat)
        elif fmt_name == "atom":
            from a2ui.inference_formats.experimental.atom import AtomParser

            parser = AtomParser(catalog=core_cat)
        else:
            from a2ui.parser.parser import parse_response

            parser = None

        expect_error = test_case.get("expectError")
        if expect_error:
            with assert_raises(expect_error):
                if parser:
                    parser.parse_response(content)
                else:
                    parse_response(content)
        else:
            if parser:
                parts = parser.parse_response(content)
            else:
                parts = parse_response(content)
            expected = test_case["expect"]
            assert len(parts) == len(expected)
            for actual, exp in zip(parts, expected):
                assert actual.text.strip() == exp.get("text", "").strip()
                assert actual.a2ui_json == exp.get("a2ui")

    elif action == "process_chunk":
        catalog_config = test_case.get("catalog", {})
        catalog = setup_catalog(catalog_config)
        parser = DirectJsonStreamParser(catalog=catalog)
        if test_case.get("disableValidation"):
            parser._validator = None

        steps = test_case.get("steps")
        if steps is None and "process_chunk" in test_case:
            steps = test_case["process_chunk"]
        if steps is None and "input" in test_case:
            steps = [test_case]

        for step in steps:
            expect_error = step.get("expectError") or test_case.get("expectError")
            if expect_error:
                with assert_raises(expect_error):
                    parser.process_chunk(step["input"])
            else:
                parts = parser.process_chunk(step["input"])
                assert_parts_match(parts, step["expect"])
