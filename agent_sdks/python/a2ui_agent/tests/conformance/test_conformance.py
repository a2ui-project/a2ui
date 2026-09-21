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

import dataclasses
import os
import yaml
import pytest

from a2ui.basic_catalog import BasicCatalog
from a2ui.schema.catalog import A2uiCatalog
from a2ui.inference_formats.direct_json import DirectJsonFormat, DirectJsonStreamParser
from a2ui.validation.validator import A2uiValidator
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
)
from a2ui.parser.errors import A2uiCompilationError

import json
import re

import contextlib


CATEGORY_TO_EXCEPTION = {
    "ParseError": A2uiParseError,
    "ValidationError": A2uiValidationError,
    "CatalogError": A2uiCatalogError,
    "IntegrityError": A2uiIntegrityError,
    "RecursionError": A2uiRecursionError,
    "CompilationError": A2uiCompilationError,
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


def _get_conformance_path(filename):
    return os.path.abspath(
        os.path.join(os.path.dirname(__file__), "../../../../../conformance", filename)
    )


def load_json_file(filename):
    path = _get_conformance_path(filename)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_tests(filename):
    path = _get_conformance_path(filename)
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
cases_parser = get_conformance_cases("agent/legacy/streaming_parser.yaml")


@pytest.mark.parametrize(
    "name, test_case", cases_parser, ids=[c[0] for c in cases_parser]
)
def test_parser_conformance(name, test_case):
    catalog_config = test_case["catalog"]
    catalog = setup_catalog(catalog_config)
    parser = DirectJsonStreamParser(catalog=catalog)
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
            with assert_raises(expect_error):
                parser.process_chunk(step["input"])
        else:
            parts = parser.process_chunk(step["input"])
            assert_parts_match(parts, step["expect"])


# --- Non-Streaming Parser Conformance ---
cases_parser_non_streaming = get_conformance_cases("agent/legacy/parser.yaml")


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
            with assert_raises(test_case["expect_error"]):
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
            with assert_raises(test_case["expect_error"]):
                parse_and_fix(content)
        else:
            result = parse_and_fix(content)
            assert result == test_case["expect"]

    elif action == "has_parts":
        from a2ui.parser.parser import has_a2ui_parts

        result = has_a2ui_parts(content)
        assert result == test_case["expect"]


# --- Validator Conformance ---

cases_validator = get_conformance_cases("core/validator.yaml")


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
            with assert_raises(expect_error):
                validator.validate(step["payload"])
        else:
            validator.validate(step["payload"])


# --- Catalog Conformance ---
cases_catalog = get_conformance_cases("core/catalog.yaml")


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
            full_path = _get_conformance_path(path)
        else:
            full_path = None
        validate = args.get("validate", False)
        if "expect_error" in test_case:
            with assert_raises(test_case["expect_error"]):
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
cases_schema_manager = get_conformance_cases("agent/legacy/inference_format.yaml")


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

        direct_json_format = DirectJsonFormat(
            version=VERSION_0_9,
            catalogs=configs,
            accepts_inline_catalogs=accepts_inline_catalogs,
        )

        if "expect_error" in test_case:
            with assert_raises(test_case["expect_error"]):
                direct_json_format.get_selected_catalog(client_capabilities)
        else:
            selected = direct_json_format.get_selected_catalog(client_capabilities)
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
            full_path = _get_conformance_path(cfg["path"])
            configs.append(
                CatalogConfig.from_path(name=cfg["name"], catalog_path=full_path)
            )
        direct_json_format = DirectJsonFormat(
            version=VERSION_0_8, catalogs=configs, schema_modifiers=schema_modifiers
        )
        selected = direct_json_format.get_selected_catalog()
        expected = test_case["expect"]
        if "catalog_schema" in expected:
            assert selected.catalog_schema == expected["catalog_schema"]
        if "supported_catalog_ids" in expected:
            assert [
                c.catalog_id for c in direct_json_format._supported_catalogs
            ] == expected["supported_catalog_ids"]

    elif action == "generate_prompt":
        version = args.get("version", VERSION_0_8)
        role = args.get("role_description", "")
        workflow = args.get("workflow_description", "")
        ui_desc = args.get("ui_description", "")

        examples_path = args.get("examples_path")
        if examples_path:
            examples_path = _get_conformance_path(examples_path)

        config = BasicCatalog.get_config(version)
        if examples_path:
            config = CatalogConfig(
                name=config.name,
                provider=config.provider,
                examples_path=examples_path,
            )

        direct_json_format = DirectJsonFormat(
            version=version,
            catalogs=[config],
            accepts_inline_catalogs=args.get("accepts_inline_catalogs", False),
        )

        output = direct_json_format.generate_system_prompt(
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


# --- Compiler / Decompiler Conformance ---
#
# These suites are written against the blueprint `Parser` interface, so a case
# names the call it exercises (`compile`, `decompile`) and carries its catalog
# as a path into `conformance/test_data/`.
#
# Two things the suites leave to the harness:
#
# - The surface a block compiles into. The suites fix `default_surface` as the
#   surface id a block that names no surface compiles against, which is what
#   `ExpressCompiler.compile` defaults to; `ExpressParser` takes it as a
#   constructor argument and defaults to `main` instead, so the harness passes
#   it explicitly rather than testing a constructor default other languages may
#   not have.
# - Turning on v1.0 validation, which this SDK gates behind an experiment. The
#   suites are all v1.0, so without it every catalog fails to build a validator.


V1_0_EXPERIMENTS = frozenset({"version_1_0"})

CONFORMANCE_SURFACE_ID = "default_surface"

DEFAULT_CATALOG = "test_data/catalogs/simplified_catalog_v1_0.json"

# Cases the suites fix and this SDK does not yet satisfy. Marked strict so that
# fixing the implementation fails the marker instead of passing silently.
KNOWN_GAPS = {
    # Compiler, Express.
    "test_compile_express_inline_nesting": (
        "an inline component is hoisted out as `_inline_1` rather than"
        " `<parent id>_<property>`"
    ),
    "test_compile_express_event_action": (
        "an Event with no context compiles `context: {}` rather than leaving"
        " `context` out"
    ),
    "test_compile_express_event_variable_is_inlined_at_each_use": (
        "an Event with no context compiles `context: {}` rather than leaving"
        " `context` out"
    ),
    "test_compile_express_standalone_function_call": (
        "a standalone call compiles to `functionCallId`/`callFunction` at the"
        " top level, which agent_to_renderer.json rejects, rather than to"
        " `callRendererFunction`"
    ),
    "test_compile_express_unknown_component_is_a_validation_error": (
        "a component the catalog does not declare is dropped from the compiled"
        " surface instead of failing the compile"
    ),
    "test_compile_express_missing_required_property_is_a_validation_error": (
        "a component missing a property its catalog requires compiles without"
        " it instead of failing the compile"
    ),
    "test_compile_express_unknown_function_is_a_validation_error": (
        "a call to a function the catalog does not declare compiles instead of"
        " failing the compile"
    ),
    # Decompiler, Express.
    "test_decompile_express_update_components": (
        "an updateComponents writes a block naming no root, which the compiler"
        " then rejects, so the round trip fails"
    ),
    "test_decompile_express_update_data_model": (
        "a standalone updateDataModel writes no surface line, so the round trip"
        " lands on the default surface"
    ),
    "test_decompile_express_nested_data_model_is_one_assignment_per_leaf": (
        "a standalone updateDataModel writes no surface line, so the round trip"
        " lands on the default surface"
    ),
    "test_decompile_express_escapes_a_quote_in_a_string": (
        "a string holding a quote is written as a triple quoted string rather"
        " than with the quote escaped"
    ),
    "test_decompile_express_renderer_function_call": (
        "a callRendererFunction decompiles to the empty string"
    ),
    "test_decompile_express_quotes_a_map_key_that_is_not_an_identifier": (
        "a map key that is not an identifier is written unquoted, which the"
        " grammar does not admit"
    ),
    # Response parser. A part carries text and payload together, where the
    # suites fix one or the other per part, so every case with text beside a
    # block comes back short.
    "test_unwrap_express_text_between_blocks": (
        "the text before a block is attached to the same part as the payload"
        " rather than being a part of its own"
    ),
    "test_unwrap_text_before_between_and_after_blocks": (
        "the text before a block is attached to the same part as the payload"
        " rather than being a part of its own"
    ),
    "test_parse_response_express_two_blocks": (
        "the text before a block is attached to the same part as the payload"
        " rather than being a part of its own"
    ),
    "test_parse_response_keeps_text_and_payloads_in_order": (
        "the text before a block is attached to the same part as the payload"
        " rather than being a part of its own"
    ),
    # `wrap` is `wrap_decompiled_blocks` here and takes raw payload strings
    # rather than parts, so it always writes a tagged block and can neither
    # write a text part nor leave the tags off.
    "test_wrap_express_text_only_parts_are_the_text": (
        "wrap_decompiled_blocks takes raw blocks rather than parts, so a text"
        " part cannot be written"
    ),
    "test_wrap_text_only_parts_are_the_text": (
        "wrap_decompiled_blocks takes raw blocks rather than parts, so a text"
        " part cannot be written"
    ),
    "test_wrap_express_no_parts_is_an_empty_string": (
        "wrap_decompiled_blocks writes an empty tagged block rather than an"
        " empty string"
    ),
    "test_wrap_no_parts_is_an_empty_string": (
        "wrap_decompiled_blocks writes an empty tagged block rather than an"
        " empty string"
    ),
    "test_wrap_express_restores_tags_and_order": (
        "wrap_decompiled_blocks takes raw blocks rather than parts, so the text"
        " part is dropped and does not survive the round trip"
    ),
    "test_wrap_keeps_text_and_blocks_in_order": (
        "wrap_decompiled_blocks takes raw blocks rather than parts, so the text"
        " parts are dropped and do not survive the round trip"
    ),
    "test_wrap_express_tags_sit_on_their_own_lines": (
        "wrap_decompiled_blocks takes raw blocks rather than parts, so the text"
        " part is dropped"
    ),
    # Direct JSON unwrapping raises where the suites return parts. These are
    # the three decisions the suite header calls out as departures from
    # legacy/parser.yaml.
    "test_unwrap_response_without_tags_is_one_text_part": (
        "a response with no tags raises ParseError rather than unwrapping to"
        " one text part"
    ),
    "test_parse_response_without_tags_is_one_text_part": (
        "a response with no tags raises ParseError rather than unwrapping to"
        " one text part"
    ),
    "test_unwrap_empty_response_has_no_parts": (
        "an empty response raises ParseError rather than unwrapping to no parts"
    ),
    "test_unwrap_unterminated_block_is_not_final": (
        "an unterminated block raises ParseError rather than coming back as a"
        " part that is not final"
    ),
    # The rest.
    "test_parse_response_express_unwrapped_compiles_the_whole_body": (
        "parse_response takes no `wrapped` argument, so a response the case"
        " declares unwrapped cannot be handed to the compiler whole"
    ),
    "test_parse_response_unwrapped_compiles_the_whole_body": (
        "parse_response takes no `wrapped` argument, so a response the case"
        " declares unwrapped cannot be handed to the compiler whole"
    ),
    "test_parse_response_express_validation_failure_surfaces": (
        "a component the catalog does not declare is dropped from the compiled"
        " surface instead of failing the parse"
    ),
}


# Cases this SDK has no API to run at all, as opposed to running and
# disagreeing.
UNSUPPORTED = {
    "test_compile_express_surface_targeting_names_a_catalog": (
        "a parser holds one catalog, so a block targeting a second catalog by"
        " id cannot be compiled"
    ),
}


def setup_catalog_from_document(relative_path):
    """Builds an A2uiCatalog from a conformance catalog fixture path."""
    document = load_json_file(relative_path)
    version = str(document.get("protocolVersion", "1.0"))
    config = CatalogConfig.from_path(
        name=os.path.basename(relative_path).replace(".json", ""),
        catalog_path=_get_conformance_path(relative_path),
    )
    catalog = A2uiCatalog.from_config(config, version=version)
    return dataclasses.replace(catalog, experiments=V1_0_EXPERIMENTS)


def make_parser(args):
    """Builds the parser for the format a case names.

    The unwrap and wrap cases carry no catalog, since neither call consults one,
    but both formats need one to build a parser at all. Those cases get the
    simplified fixture, which they never read.
    """
    catalog = setup_catalog_from_document(args.get("catalog", DEFAULT_CATALOG))
    format_name = args["format"]

    if format_name == "express":
        from a2ui.inference_formats.experimental.express.format import ExpressFormat

        return ExpressFormat(
            catalog=catalog, surface_id=CONFORMANCE_SURFACE_ID, version="v1.0"
        ).parser

    if format_name == "direct_json":
        from a2ui.inference_formats.direct_json.parser import DirectJsonParser

        return DirectJsonParser(catalog=catalog, validator=catalog.validator)

    raise ValueError(f"Unknown inference format: {format_name}")


def resolve_pointer(payload, pointer):
    """Resolves a slash separated pointer into a compiled payload."""
    current = payload
    for token in pointer.strip("/").split("/"):
        current = current[int(token)] if isinstance(current, list) else current[token]
    return current


def delete_pointer(payload, pointer):
    """Deletes a slash separated pointer from a dict or list structure."""
    tokens = pointer.strip("/").split("/")
    current = payload
    for token in tokens[:-1]:
        current = current[int(token)] if isinstance(current, list) else current[token]
    last_token = tokens[-1]
    if isinstance(current, list):
        del current[int(last_token)]
    else:
        del current[last_token]


def get_marked_conformance_cases(*filenames):
    """Loads cases from several suites, marking the ones this SDK cannot pass."""
    params = []
    for filename in filenames:
        for name, case in get_conformance_cases(filename):
            marks = []
            if name in UNSUPPORTED:
                marks.append(pytest.mark.skip(reason=UNSUPPORTED[name]))
            elif name in KNOWN_GAPS:
                marks.append(pytest.mark.xfail(reason=KNOWN_GAPS[name], strict=True))
            params.append(pytest.param(name, case, marks=marks, id=name))
    return params


cases_compiler = get_marked_conformance_cases(
    "agent/express/compiler.yaml",
    "agent/direct_json/compiler.yaml",
)


@pytest.mark.parametrize("name, test_case", cases_compiler)
def test_compiler_conformance(name, test_case):
    parser = make_parser(test_case["args"])
    payload = test_case["input"]

    if "expect_error" in test_case:
        with assert_raises(test_case["expect_error"]):
            parser.compile(payload)
        return

    compiled = parser.compile(payload)

    if "expect_present" in test_case:
        for pointer in test_case["expect_present"]:
            assert resolve_pointer(compiled, pointer) not in (None, "")
            delete_pointer(compiled, pointer)

    assert compiled == test_case["expect"]


cases_decompiler = get_marked_conformance_cases(
    "agent/express/decompiler.yaml",
    "agent/direct_json/decompiler.yaml",
)


@pytest.mark.parametrize("name, test_case", cases_decompiler)
def test_decompiler_conformance(name, test_case):
    parser = make_parser(test_case["args"])
    messages = test_case["messages"]

    notation = parser.decompile(messages if len(messages) > 1 else messages[0])

    for fragment in test_case.get("expect_contains", []):
        assert fragment in notation, f"{fragment!r} not in {notation!r}"

    if test_case.get("expect_round_trip"):
        assert parser.compile(notation) == messages


# --- Response Parser Conformance ---
#
# Where a payload begins and ends, rather than what it means. `unwrap` splits a
# response into ordered text and raw payload parts, `wrap` writes parts back out
# as a model would have emitted them, and `parse_response` does both and
# compiles each block it finds.
#
# The unwrap and wrap cases carry no catalog, because neither call consults one.
#
# This SDK names `wrap` `wrap_decompiled_blocks` and gives it a list of raw
# payload strings rather than the parts the blueprint declares, so it can only
# write blocks and has nowhere to put a text part. The harness calls it with the
# raw blocks a case names; a case whose parts are not all payload therefore
# fails, and is marked as the gap it is rather than worked around here.


def assert_raw_parts_match(actual_parts, expected_parts):
    """Compares unwrapped parts, which carry raw payload text rather than messages."""
    assert len(actual_parts) == len(expected_parts), (
        f"expected {len(expected_parts)} parts, got"
        f" {[(p.text, p.a2ui_raw) for p in actual_parts]}"
    )
    for actual, expected in zip(actual_parts, expected_parts):
        assert actual.text == expected.get("text", "")
        assert actual.a2ui_raw == expected.get("a2ui_raw")
        assert actual.is_final == expected.get("is_final", True)


def wrap_parts(parser, parts):
    """Writes parts back out through whatever this SDK offers for `wrap`."""
    return parser.wrap_decompiled_blocks(
        [part["a2ui_raw"] for part in parts if "a2ui_raw" in part]
    )


cases_response_parser = get_marked_conformance_cases(
    "agent/express/response_parser.yaml",
    "agent/direct_json/response_parser.yaml",
)


@pytest.mark.parametrize("name, test_case", cases_response_parser)
def test_response_parser_conformance(name, test_case):
    args = test_case["args"]
    parser = make_parser(args)
    action = test_case["action"]

    if action == "unwrap":
        assert_raw_parts_match(parser.unwrap(test_case["input"]), test_case["expect"])

    elif action == "wrap":
        parts = test_case["parts"]
        output = wrap_parts(parser, parts)

        if "expect_output" in test_case:
            assert output == test_case["expect_output"]
        for fragment in test_case.get("expect_contains", []):
            assert fragment in output, f"{fragment!r} not in {output!r}"
        if test_case.get("expect_round_trip"):
            assert_raw_parts_match(parser.unwrap(output), parts)

    elif action == "parse_response":
        kwargs = {} if args.get("wrapped", True) else {"wrapped": False}

        if "expect_error" in test_case:
            with assert_raises(test_case["expect_error"]):
                parser.parse_response(test_case["input"], **kwargs)
            return

        parts = parser.parse_response(test_case["input"], **kwargs)
        assert_parts_match(parts, test_case["expect"])

    else:
        raise ValueError(f"Unknown response parser action: {action}")
