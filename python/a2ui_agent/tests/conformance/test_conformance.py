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

import contextlib
import os
import re

import pytest
import yaml

from a2ui.catalog_transformers import (
    CatalogTransformer,
    ComponentPruningTransformer,
    FunctionPruningTransformer,
)
from a2ui.core import (
    A2uiCatalogError,
    A2uiError,
    A2uiIntegrityError,
    A2uiParseError,
    A2uiRecursionError,
    A2uiValidationError,
    Catalog,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats import (
    DirectJsonFormat,
    DirectJsonParser,
    DirectJsonStreamParser,
    to_message_dicts,
    to_message_models,
)
from a2ui.inference_formats.experimental.atom import AtomFormat, AtomParser
from a2ui.inference_formats.experimental.elemental import (
    ElementalFormat,
    ElementalParser,
)
from a2ui.inference_formats.experimental.express import ExpressFormat, ExpressParser
from a2ui.parser import A2uiCompilationError, parse_and_fix, parse_response
from a2ui.schema import (
    CatalogConfig,
    InMemoryCatalogProvider,
    VERSION_0_8,
    VERSION_0_9,
)
from a2ui.utils import resolve_catalogs

from .conformance_helpers import (
    get_conformance_path,
    load_conformance_json as load_json_file,
    load_conformance_yaml as load_tests,
)

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
    """Builds the catalog that a legacy case describes.

    The case's `s2cSchema` and `commonTypesSchema` are ignored on purpose. A
    core `Catalog` validates against the published schemas for its protocol
    version, so the simplified fixture schemas have no place to go. Cases that
    need a stricter or looser schema must express it in `catalogSchema`.
    """
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
        catalogs = (
            case.get("catalogs", []) if isinstance(case.get("catalogs"), list) else []
        )
        first_catalog = (
            catalogs[0] if catalogs and isinstance(catalogs[0], dict) else {}
        )
        version = str(
            case.get("protocolVersion")
            or catalog.get("protocolVersion")
            or first_catalog.get("protocolVersion")
            or "v0.9"
        )
        if not version.startswith("v"):
            version = f"v{version}"

        if version not in SUPPORTED_PROTOCOL_VERSIONS or name in SKIP_TEST_NAMES:
            continue
        filtered.append((name, case))
    return filtered


def make_stream_parser(test_case):
    """Builds the stream parser that a case's catalog configs describe.

    A case configures one catalog under `catalog`, or several under
    `catalogs`. The shared suites name the progressive keys
    `customCuttableKeys`, on the catalog config or, for several catalogs, on
    the case.
    """
    if "catalogs" in test_case:
        catalogs = [setup_catalog(config) for config in test_case["catalogs"]]
        progressive_keys = test_case.get("customCuttableKeys")
    else:
        catalog_config = test_case.get("catalog", {})
        catalogs = [setup_catalog(catalog_config)]
        progressive_keys = catalog_config.get("customCuttableKeys")
    if progressive_keys is None:
        return DirectJsonStreamParser(catalogs)
    return DirectJsonStreamParser(
        catalogs, progressive_keys=frozenset(progressive_keys)
    )


def _disable_validation(parser: DirectJsonStreamParser) -> None:
    parser._validate_message = lambda m: None
    parser._validate_components = lambda comp_models, available_reachable: None


# --- Streaming Parser Conformance ---
cases_parser = get_conformance_cases("agent/legacy/streaming_parser.yaml")


@pytest.mark.parametrize(
    "name, test_case", cases_parser, ids=[c[0] for c in cases_parser]
)
def test_parser_conformance(name, test_case):
    parser = make_stream_parser(test_case)
    if test_case.get("disableValidation"):
        _disable_validation(parser)

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
cases_parser_non_streaming = get_conformance_cases("agent/legacy/parser.yaml")


@pytest.mark.parametrize(
    "name, test_case",
    cases_parser_non_streaming,
    ids=[c[0] for c in cases_parser_non_streaming],
)
def test_parser_non_streaming_conformance(name, test_case):
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
        # `has_a2ui_parts` has no facade export, so this is the one deep import
        # the harness keeps.
        from a2ui.parser.parser import has_a2ui_parts

        result = has_a2ui_parts(content)
        assert result == test_case["expect"]


# --- Schema Manager Conformance ---
cases_schema_manager = get_conformance_cases("agent/legacy/inference_format.yaml")

# These cases describe the legacy schema manager, which merged inline catalogs
# into the selected catalog and rejected them when it didn't accept them.
# `resolve_catalogs` activates each inline catalog as a catalog of its own and
# drops inline catalogs that the agent doesn't accept.
_INLINE_MERGE_CASES = {
    "test_select_catalog_inline",
    "test_select_catalog_inline_not_accepted",
    "test_select_catalog_multiple_inline",
    "test_select_catalog_no_match_with_inline",
}

# The key that each protocol version's capabilities are sent under.
_CAPABILITIES_KEYS = {"0.8": "v0.8", "0.9": "v0.9", "0.9.1": "v0.9", "1.0": "v1.0"}


def _resolve(configs, version, client_capabilities, accepts_inline_catalogs):
    """Resolves the legacy cases' unkeyed client capabilities.

    The legacy cases leave out fields that the capabilities models require and
    the schema manager didn't: `supportedCatalogIds` and, for v0.8 inline
    catalogs, `styles`. They're filled in empty.
    """
    renderer_capabilities = None
    if client_capabilities:
        entry = {"supportedCatalogIds": [], **client_capabilities}
        if version == VERSION_0_8:
            entry["inlineCatalogs"] = [
                {"styles": {}, **c} for c in entry.get("inlineCatalogs", [])
            ]
        renderer_capabilities = {_CAPABILITIES_KEYS[version]: entry}
    return resolve_catalogs(
        configs,
        renderer_capabilities,
        accepts_inline_catalogs=accepts_inline_catalogs,
    )


@pytest.mark.parametrize(
    "name, test_case",
    cases_schema_manager,
    ids=[c[0] for c in cases_schema_manager],
)
def test_schema_manager_conformance(name, test_case):
    action = test_case["action"]
    args = test_case.get("args", {})

    if action == "select_catalog":
        if name in _INLINE_MERGE_CASES:
            pytest.skip("Inline catalogs are resolved as separate catalogs.")
        supported_catalogs = args.get("supportedCatalogs", [])
        client_capabilities = args.get("clientCapabilities", {})
        accepts_inline_catalogs = args.get("acceptsInlineCatalogs", False)

        configs = [
            CatalogConfig.from_catalog(
                cat_def["catalogId"],
                CatalogConfig(
                    name=cat_def["catalogId"],
                    provider=MemoryCatalogProvider(cat_def),
                ).to_catalog(protocol_version=VERSION_0_9),
            )
            for cat_def in supported_catalogs
        ]

        expect_error = test_case.get("expectError")
        if expect_error:
            with assert_raises(expect_error):
                _resolve(
                    configs, VERSION_0_9, client_capabilities, accepts_inline_catalogs
                )
        else:
            selected = _resolve(
                configs, VERSION_0_9, client_capabilities, accepts_inline_catalogs
            )[0]
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
        catalogs = [
            CatalogConfig.from_path(
                name=cfg["name"], catalog_path=get_conformance_path(cfg["path"])
            ).to_catalog(protocol_version=VERSION_0_8)
            for cfg in catalog_configs
        ]
        direct_json_format = DirectJsonFormat(catalogs)
        selected = direct_json_format.catalogs[0]
        expected = test_case["expect"]
        if isinstance(expected, dict) and "supportedCatalogIds" in expected:
            exp_ids = expected["supportedCatalogIds"]
            assert [c.catalog_id for c in direct_json_format.catalogs] == exp_ids
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

        catalogs = _resolve(
            [CatalogConfig.from_catalog("basic", BasicCatalog(version))],
            version,
            args.get("clientUiCapabilities"),
            args.get("acceptsInlineCatalogs", False),
        )
        direct_json_format = DirectJsonFormat(catalogs, examples_path=examples_path)

        output = direct_json_format.prompt_generator.generate(
            role_description=role,
            workflow_description=workflow,
            ui_description=ui_desc,
            include_schema=args.get("includeSchema", False),
            include_examples=args.get("includeExamples", False),
            allowed_components=args.get("allowedComponents"),
            allowed_messages=args.get("allowedMessages"),
        )

        output_normalized = re.sub(r"\s+", "", output.strip())

        expect_contains = test_case.get("expectContains")
        if expect_contains:
            for expected in expect_contains:
                if expected == "### Server To Client Schema:":
                    expected = "### Agent to Renderer Schema:"
                expected_normalized = re.sub(r"\s+", "", expected.strip())
                assert expected_normalized in output_normalized

    elif action == "parse_full":
        fmt_name = test_case.get("format", "direct_json")
        content = test_case["input"]

        cat_config = test_case.get("catalog", {})
        protocol_ver = cat_config.get("protocolVersion", "v1.0")
        core_cat = BasicCatalog(protocol_ver)

        if fmt_name == "express":
            parser = ExpressParser(core_cat, surface_id="main", version=protocol_ver)
        elif fmt_name == "elemental":
            parser = ElementalParser(core_cat)
        elif fmt_name == "atom":
            parser = AtomParser(core_cat)
        else:
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
        parser = make_stream_parser(test_case)
        if test_case.get("disableValidation"):
            _disable_validation(parser)

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


# --- Compiler / Decompiler Conformance ---
#
# These suites are written against the blueprint `Parser` interface, so a case
# names the call it exercises (`compile`, `decompile`) and carries its catalog
# as a path into `conformance/test_data/`.
#
# One thing the suites leave to the harness is the surface a block compiles
# into. The suites fix `default_surface` as the surface id a block that names no
# surface compiles against, which is what `ExpressCompiler.compile` defaults to;
# `ExpressParser` takes it as a constructor argument and defaults to `main`
# instead, so the harness passes it explicitly rather than testing a constructor
# default other languages may not have.


CONFORMANCE_SURFACE_ID = "default_surface"

DEFAULT_CATALOG = "test_data/catalogs/simplified_catalog_v1_0.json"

# Cases the suites fix and this SDK does not yet satisfy. Marked strict so that
# fixing the implementation fails the marker instead of passing silently.
#
# NOTE ON REMAINING GAPS (Category B):
# Most gaps below are response parser and wrapping architectural gaps, shared
# by every format. They depend on migrating the Python SDK from its legacy
# response parser interface (which bundles preceding text and payload into a
# single part) to the module blueprint Parser contract
# (blueprints/modules/a2ui_agent.blueprint.md), where responses are decomposed
# into sequences of disjoint [TextPart, A2uiPart, ...] parts and wrap()
# consumes structured ResponsePart objects. The prompt generator and request
# processor gaps after them are listed with their own reasons.
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
    # Express reserved keys (#3006). v1.0 writes a data binding as `@path` and
    # a function call as `@call`, and the compiler still writes `path` and
    # `call`. The decompiler reads both, so the decompile cases fail only on
    # their round trip back through the compiler.
    **{
        name: (
            "the compiler writes v1.0 data bindings and function calls with"
            " `path` and `call` rather than `@path` and `@call` (#3006)"
        )
        for name in (
            "test_compile_express_template_children",
            "test_compile_express_absolute_data_binding_path",
            "test_compile_express_nested_function_call",
            "test_compile_express_validation_expression",
            "test_compile_express_validation_expression_with_an_argument",
            "test_compile_express_data_model_assignment",
            "test_compile_express_standalone_function_call",
            "test_compile_express_function_call_action",
            "test_compile_express_bare_path_is_the_whole_bound_value",
            "test_compile_express_several_checks_in_one_list",
            "test_compile_express_check_without_a_message_still_carries_one",
            "test_decompile_express_data_model",
            "test_decompile_express_function_call_action",
            "test_decompile_express_renderer_function_call",
        )
    },
    "test_compile_express_surface_targeting_names_a_catalog": (
        "the Express compiler resolves against one catalog and does not yet"
        " take a list of catalogs"
    ),
}


KNOWN_GAPS.update({
    # Prompt generators. The allowlist of message types narrows the
    # message schema but not the rest of the snippet.
    "test_snippet_describes_only_the_allowed_envelopes": (
        "allowed_messages prunes the top-level message union, but the"
        " DeleteSurfaceMessage definition stays in the embedded schema's"
        " $defs"
    ),
})


# Cases this SDK has no API to run at all, as opposed to running and
# disagreeing.
UNSUPPORTED: dict[str, str] = {}


def _transformer(spec):
    """Builds the SDK transformer that a case's transformer spec names."""
    if "component_pruning" in spec:
        return ComponentPruningTransformer(spec["component_pruning"])
    if "function_pruning" in spec:
        return FunctionPruningTransformer(spec["function_pruning"])
    raise ValueError(f"Unknown transformer: {spec}")


def catalog_config_from_document(ref) -> CatalogConfig:
    """Builds the CatalogConfig that a case's catalog entry describes.

    An entry is a path into `conformance/`, an inline catalog document, or a
    CatalogConfigSpec mapping (`catalog` plus optional `transformers`). The
    transformers are handed to `CatalogConfig`, the way an agent registers
    them, so that pruning goes through the SDK rather than through the harness.
    """
    transformers: list[CatalogTransformer] = []
    if isinstance(ref, dict) and "catalog" in ref:
        transformers = [_transformer(t) for t in ref.get("transformers", [])]
        ref = ref["catalog"]

    if isinstance(ref, dict):
        return CatalogConfig(
            name=str(ref.get("catalogId", "inline")),
            provider=InMemoryCatalogProvider(ref),
            transformers=transformers,
        )

    relative_path = str(ref)
    return CatalogConfig.from_path(
        name=os.path.basename(relative_path).removesuffix(".json"),
        catalog_path=get_conformance_path(relative_path),
        transformers=transformers,
    )


def setup_catalog_from_document(ref) -> Catalog:
    """Builds the transformed Catalog that a case's catalog entry describes."""
    return catalog_config_from_document(ref).to_catalog()


def _catalogs_for(args):
    if "catalogs" in args:
        return [setup_catalog_from_document(p) for p in args["catalogs"]]
    return [setup_catalog_from_document(args.get("catalog", DEFAULT_CATALOG))]


def _protocol_version(catalogs) -> str:
    """The `vX.Y` protocol version of the first catalog, which Express targets."""
    version = str(getattr(catalogs[0].protocol_version, "value", None) or "")
    if not version:
        version = str(catalogs[0].protocol_version)
    return version if version.startswith("v") else f"v{version}"


def make_parser(args):
    """Builds the parser for the format a case names.

    The unwrap and wrap cases carry no catalog, since neither call consults one,
    but both formats need one to build a parser at all. Those cases get the
    simplified fixture, which they never read.
    """
    return _format_for(args["format"], _catalogs_for(args)).parser


def _format_for(format_name, catalogs, examples_path=None):
    if format_name == "express":
        return ExpressFormat(
            catalog=catalogs[0],
            examples_path=examples_path,
            surface_id=CONFORMANCE_SURFACE_ID,
            version=_protocol_version(catalogs),
        )
    if format_name == "elemental":
        return ElementalFormat(
            catalog=catalogs[0],
            examples_path=examples_path,
            surface_id=CONFORMANCE_SURFACE_ID,
        )
    if format_name == "atom":
        return AtomFormat(
            catalog=catalogs[0],
            examples_path=examples_path,
            surface_id=CONFORMANCE_SURFACE_ID,
        )
    if format_name == "direct_json":
        return DirectJsonFormat(catalogs=catalogs, examples_path=examples_path)
    raise ValueError(f"Unknown inference format: {format_name}")


def stage_examples(examples, tmp_path):
    """Copies a case's example files into a directory the formats can read.

    The formats read examples from a directory and order them by file name, so
    each file is prefixed with its position in the case.
    """
    if not examples or tmp_path is None:
        return None
    examples_dir = str(tmp_path / "examples")
    os.makedirs(examples_dir, exist_ok=True)
    for idx, ex_rel in enumerate(examples):
        src = get_conformance_path(ex_rel)
        dst = os.path.join(examples_dir, f"{idx:02d}_{os.path.basename(ex_rel)}")
        with open(src, "rb") as rf, open(dst, "wb") as wf:
            wf.write(rf.read())
    return examples_dir


def make_format(args, tmp_path=None, catalogs=None, format_name=None):
    """Builds the InferenceFormat instance for a conformance case."""
    if catalogs is None:
        if "catalogs" in args:
            catalogs = [setup_catalog_from_document(p) for p in args["catalogs"]]
        elif "catalog" in args:
            catalogs = [setup_catalog_from_document(args["catalog"])]
        else:
            catalogs = []

    if not catalogs:
        raise A2uiCatalogError("At least one active catalog is required.")

    examples_dir = stage_examples(args.get("examples", []), tmp_path)
    return _format_for(format_name or args["format"], catalogs, examples_dir)


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

    raw_compiled = parser.compile(payload)
    compiled = to_message_dicts(raw_compiled)

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

    if test_case["args"]["format"] == "direct_json":
        notation = parser.decompile(to_message_models(messages))
    else:
        notation = parser.decompile(messages if len(messages) > 1 else messages[0])

    for fragment in test_case.get("expect_contains", []):
        assert fragment in notation, f"{fragment!r} not in {notation!r}"

    for fragment in test_case.get("expect_absent", []):
        assert fragment not in notation, f"{fragment!r} unexpectedly in {notation!r}"

    if test_case.get("expect_round_trip"):
        assert to_message_dicts(parser.compile(notation)) == messages


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


# --- Multi-Catalog Formats Conformance ---

cases_multi_catalog = get_marked_conformance_cases(
    "agent/multi_catalog_formats.yaml",
)


def sort_components_by_id(messages):
    """Returns the messages with each component list sorted by component id."""
    normalized = []
    for message in messages:
        message = dict(message)
        for key in ("createSurface", "updateComponents"):
            body = message.get(key)
            if isinstance(body, dict) and isinstance(body.get("components"), list):
                body = dict(body)
                body["components"] = sorted(
                    body["components"], key=lambda c: str(c.get("id"))
                )
                message[key] = body
        normalized.append(message)
    return normalized


def _expect_snippet(snippet, contains, absent):
    for fragment in contains:
        assert fragment in snippet, f"{fragment!r} not in {snippet!r}"
    for fragment in absent:
        assert fragment not in snippet, f"{fragment!r} unexpectedly in {snippet!r}"


@pytest.mark.parametrize("name, test_case", cases_multi_catalog)
def test_multi_catalog_formats_conformance(name, test_case, tmp_path):
    run_format_case(test_case, tmp_path)


def run_format_case(test_case, tmp_path):
    """Runs a format-level case: compile, decompile, parse, prompt, or factory."""
    action = test_case["action"]
    args = test_case["args"]

    if action == "compile":
        parser = make_parser(args)
        if "expect_error" in test_case:
            with assert_raises(test_case["expect_error"]):
                parser.compile(test_case["input"])
            return
        raw_compiled = parser.compile(test_case["input"])
        assert isinstance(raw_compiled, list)
        assert all(hasattr(m, "model_dump") for m in raw_compiled)
        compiled = to_message_dicts(raw_compiled)
        assert sort_components_by_id(compiled) == sort_components_by_id(
            test_case["expect"]
        )

    elif action == "decompile":
        parser = make_parser(args)
        messages = test_case["messages"]
        notation = parser.decompile(to_message_models(messages))
        _expect_snippet(
            notation,
            test_case.get("expect_contains", []),
            test_case.get("expect_absent", []),
        )
        if test_case.get("expect_round_trip"):
            recompiled = to_message_dicts(parser.compile(notation))
            assert sort_components_by_id(recompiled) == sort_components_by_id(messages)

    elif action == "parse_response":
        parser = make_parser(args)
        if "expect_error" in test_case:
            with assert_raises(test_case["expect_error"]):
                parser.parse_response(test_case["input"])
            return
        parts = parser.parse_response(test_case["input"])
        assert_parts_match(parts, test_case["expect"])

    elif action == "generate_prompt_snippet":
        include_examples = bool(args.get("examples"))

        def generate(fmt):
            return fmt.prompt_generator.generate(
                role_description="Role",
                include_schema=True,
                include_examples=include_examples,
                allowed_messages=args.get("allowed_messages"),
            )

        if "expect_error" in test_case:
            with assert_raises(test_case["expect_error"]):
                generate(make_format(args, tmp_path=tmp_path))
            return
        fmt = make_format(args, tmp_path=tmp_path)
        snippet = generate(fmt)
        _expect_snippet(
            snippet,
            test_case.get("expect_contains", []),
            test_case.get("expect_absent", []),
        )
        if test_case.get("expect_deterministic"):
            assert snippet == generate(fmt)

    elif action == "create_format":
        if "expect_error" in test_case:
            with assert_raises(test_case["expect_error"]):
                make_format(args, tmp_path=tmp_path)
            return
        fmt = make_format(args, tmp_path=tmp_path)
        expect = test_case.get("expect", {})
        # Direct JSON keeps one stateless `parser` per format and hands out a
        # fresh stateful parser from `create_stream_parser`; the DSL formats
        # build a new parser on every `parser` access.
        create_stream_parser = getattr(fmt, "create_stream_parser", None)

        def create_parser():
            return create_stream_parser() if create_stream_parser else fmt.parser

        if expect.get("parsers_are_distinct"):
            assert create_parser() is not create_parser()
        if expect.get("parser_state_isolated"):
            chunks = args["probe_chunks"]

            def read(parser):
                return [
                    [(p.text, p.a2ui_json) for p in parser.process_chunk(chunk)]
                    for chunk in chunks
                ]

            first_parts = read(create_parser())
            assert any(first_parts)
            assert read(create_parser()) == first_parts
        snippet = fmt.prompt_generator.generate(
            role_description="Role",
            include_schema=True,
            include_examples=bool(args.get("examples")),
        )
        _expect_snippet(
            snippet,
            expect.get("prompt_snippet_contains", []),
            expect.get("prompt_snippet_absent", []),
        )

    else:
        raise ValueError(f"Unknown format case action: {action}")


# --- Prompt Generator Conformance ---

cases_prompt_generator = get_marked_conformance_cases(
    "agent/direct_json/prompt_generator.yaml",
)


@pytest.mark.parametrize("name, test_case", cases_prompt_generator)
def test_prompt_generator_conformance(name, test_case, tmp_path):
    run_format_case(test_case, tmp_path)
