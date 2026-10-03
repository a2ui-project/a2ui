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
from .conformance_helpers import (
    get_conformance_path,
    load_conformance_json as load_json_file,
    load_conformance_yaml as load_tests,
)

from a2ui.core import (
    A2uiCatalogError,
    A2uiError,
    A2uiIntegrityError,
    A2uiParseError,
    A2uiRecursionError,
    A2uiValidationError,
    Catalog,
    MessageProcessor,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.direct_json import DirectJsonFormat, DirectJsonStreamParser
from a2ui.schema import (
    CatalogConfig,
    VERSION_0_8,
    VERSION_0_9,
    remove_strict_validation,
    validate_components,
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

# Set of A2UI specification versions supported by this Python Agent SDK conformance harness.
SUPPORTED_PROTOCOL_VERSIONS = {"v0.8", "v0.9", "v1.0"}

# Transition skip list containing specific test case names to skip during active feature transitions.
SKIP_TEST_NAMES = set()

# Transition skip list containing specific test suite files to skip during active feature transitions.
SKIP_TEST_SUITES = {
    "core/catalog.yaml",
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

    catalog_schema = catalog_config.get("catalogSchema")
    if isinstance(catalog_schema, str):
        catalog_schema = load_json_file(catalog_schema)
    elif catalog_schema is None:
        catalog_schema = {}
    else:
        catalog_schema = dict(catalog_schema)

    name = catalog_config.get("name", "test_catalog")
    if "catalogId" not in catalog_schema:
        catalog_schema["catalogId"] = name

    return Catalog.from_json(
        catalog_schema,
        protocol_version=f"v{version}",
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
cases_parser = get_conformance_cases("agent/legacy/streaming_parser.yaml")


@pytest.mark.parametrize(
    "name, test_case", cases_parser, ids=[c[0] for c in cases_parser]
)
def test_parser_conformance(name, test_case):
    catalogs_config = test_case.get("catalogs")
    if catalogs_config:
        catalogs = [setup_catalog(c) for c in catalogs_config]
        custom_cuttable_keys = test_case.get("customCuttableKeys")
    else:
        catalog_config = test_case["catalog"]
        catalogs = [setup_catalog(catalog_config)]
        custom_cuttable_keys = catalog_config.get("customCuttableKeys")
    expect_init_error = test_case.get("expectError")
    if expect_init_error and not test_case.get("steps") and "input" not in test_case:
        with assert_raises(expect_init_error):
            DirectJsonStreamParser(
                catalogs=catalogs,
                custom_cuttable_keys=frozenset(custom_cuttable_keys)
                if custom_cuttable_keys is not None
                else None,
            )
        return

    parser = DirectJsonStreamParser(
        catalogs=catalogs,
        custom_cuttable_keys=frozenset(custom_cuttable_keys)
        if custom_cuttable_keys is not None
        else None,
    )
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
                parser.parse_chunk(step["input"])
        else:
            parts = parser.parse_chunk(step["input"])
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
                    actual = {
                        "catalogId": selected.catalog_id,
                        "components": {
                            k: v.schema for k, v in selected.components.items()
                        },
                    }
                    assert actual == expected
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
            actual = {
                "catalogId": selected.catalog_id,
                "components": {k: v.schema for k, v in selected.components.items()},
            }
            assert actual == expected

    elif action == "generate_prompt":
        version = args.get("version", VERSION_0_8)
        role = args.get("roleDescription", "")
        workflow = args.get("workflowDescription", "")
        ui_desc = args.get("uiDescription", "")

        examples_path = args.get("examplesPath")
        if examples_path:
            examples_path = get_conformance_path(examples_path)

        config = CatalogConfig.from_catalog(
            "basic",
            BasicCatalog(version),
            examples_path=examples_path,
        )

        accepts_inline = args.get("acceptsInlineCatalogs", False)
        direct_json_format = DirectJsonFormat(
            version=version,
            catalogs=[config],
            accepts_inline_catalogs=accepts_inline,
        )

        selected_catalog = direct_json_format.get_selected_catalog(
            client_ui_capabilities=args.get("clientUiCapabilities"),
            allowed_components=args.get("allowedComponents"),
            allowed_messages=args.get("allowedMessages"),
        )
        direct_json_format.prompt_generator.selected_catalog = selected_catalog
        snippet = direct_json_format.prompt_generator.generate()
        parts = []
        if role:
            parts.append(role)
        parts.append(snippet)
        if workflow:
            parts.append(workflow)
        if ui_desc:
            parts.append(f"## UI Description:\n{ui_desc}")
        output = "\n\n".join(parts)

        output_normalized = re.sub(r"\s+", "", output.strip())

        expect_contains = test_case.get("expectContains")
        if expect_contains:
            for expected in expect_contains:
                expected_normalized = re.sub(r"\s+", "", expected.strip())
                assert expected_normalized in output_normalized

    elif action == "parse_full":
        fmt_name = test_case.get("format", "direct_json")
        content = test_case["input"]

        cat_config = test_case.get("catalog", {})
        protocol_ver = cat_config.get("protocolVersion", "v1.0")
        spec_ver_key = protocol_ver.replace(".", "_").removeprefix("v")
        if not spec_ver_key.startswith("v"):
            spec_ver_key = f"v{spec_ver_key}"

        from a2ui.schema.utils import get_basic_catalog_path

        with open(get_basic_catalog_path(spec_ver_key), "r", encoding="utf-8") as f:
            catalog_dict = json.load(f)
        core_cat = Catalog.from_json(catalog_dict, protocol_version=protocol_ver)

        if fmt_name == "express":
            from a2ui.inference_formats.experimental.express import ExpressParser

            parser = ExpressParser(
                catalog=core_cat, surface_id="main", version=protocol_ver
            )
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
        catalogs_config = test_case.get("catalogs")
        if catalogs_config:
            catalogs = [setup_catalog(c) for c in catalogs_config]
            custom_cuttable_keys = test_case.get("customCuttableKeys")
        else:
            catalog_config = test_case.get("catalog", {})
            catalogs = [setup_catalog(catalog_config)]
            custom_cuttable_keys = catalog_config.get("customCuttableKeys")
        parser = DirectJsonStreamParser(
            catalogs=catalogs,
            custom_cuttable_keys=frozenset(custom_cuttable_keys)
            if custom_cuttable_keys is not None
            else None,
        )
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
                    parser.parse_chunk(step["input"])
            else:
                parts = parser.parse_chunk(step["input"])
                assert_parts_match(parts, step["expect"])


_get_conformance_path = get_conformance_path


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
#
# NOTE ON REMAINING GAPS (Category B):
# Apart from the two compiler entries at the end, the remaining gaps below are
# response parser and wrapping architectural gaps (affecting both Express and
# Direct JSON). They depend on agent SDK
# structural changes: migrating the Python SDK from its legacy response parser
# interface (which bundles preceding text and payload into a single part) to
# the module blueprint Parser contract (blueprints/modules/a2ui_agent.blueprint.md),
# where responses are decomposed into sequences of disjoint [TextPart, A2uiPart, ...]
# parts and wrap() consumes structured ResponsePart objects.
KNOWN_GAPS = {
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
    # `wrap` joins parts with `\n`, and `unwrap` attaches preceding text to the
    # payload part rather than keeping it as a separate text part.
    "test_wrap_express_restores_tags_and_order": (
        "round-trip unwrap attaches preceding text to the payload part rather"
        " than keeping it as a separate text part"
    ),
    "test_wrap_keeps_text_and_blocks_in_order": (
        "round-trip unwrap attaches preceding text to the payload part rather"
        " than keeping it as a separate text part"
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
    # Compiler. The direct JSON parser validates components against the catalog
    # but not the message envelope, so the envelope's `version` goes unchecked.
    "test_compile_json_other_protocol_version_is_a_validation_error": (
        "the envelope is not validated, so a message stating another version"
        " compiles unchanged"
    ),
    "test_compile_json_missing_version_is_a_validation_error": (
        "the envelope is not validated, so a message stating no version"
        " compiles unchanged"
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
    """Builds a Catalog from a conformance catalog fixture path."""
    document = load_json_file(relative_path)
    version = str(document.get("protocolVersion", "1.0"))
    config = CatalogConfig.from_path(
        name=os.path.basename(relative_path).replace(".json", ""),
        catalog_path=_get_conformance_path(relative_path),
    )
    return config.to_catalog(version=version)


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

        return DirectJsonParser(
            catalogs=[catalog],
            validator=lambda payload: validate_components(catalog, payload),
        )

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
    from a2ui.core.schema.v1_0 import AgentToRendererMessage
    from pydantic import TypeAdapter

    parser = make_parser(test_case["args"])
    messages = test_case["messages"]

    adapter = TypeAdapter(list[AgentToRendererMessage])
    notation = parser.decompile(adapter.validate_python(messages))

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
    """Writes parts back out through `parser.wrap`."""
    from a2ui.parser import RawA2uiPart, RawResponsePart, TextPart

    raw_parts = []
    for part in parts:
        if "a2ui_raw" in part:
            raw_parts.append(
                RawResponsePart(
                    part=RawA2uiPart(a2ui_raw=part["a2ui_raw"]),
                    is_final=part.get("is_final", True),
                )
            )
        elif "text" in part:
            raw_parts.append(RawResponsePart(part=TextPart(text=part["text"])))
    return parser.wrap(raw_parts)


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
