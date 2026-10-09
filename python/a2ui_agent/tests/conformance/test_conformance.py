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

from __future__ import annotations

import contextlib
import os
import re

import pytest

from a2ui.catalog_transformers import CatalogTransformer
from a2ui.catalog_transformers import ComponentPruningTransformer
from a2ui.catalog_transformers import FunctionPruningTransformer
from a2ui.core import A2uiCatalogError
from a2ui.core import A2uiError
from a2ui.core import A2uiIntegrityError
from a2ui.core import A2uiParseError
from a2ui.core import A2uiRecursionError
from a2ui.core import A2uiValidationError
from a2ui.inference_formats import DirectJsonFormat
from a2ui.inference_formats import to_message_dicts
from a2ui.inference_formats import to_message_models
from a2ui.inference_formats.experimental.atom import AtomFormat
from a2ui.inference_formats.experimental.elemental import ElementalFormat
from a2ui.inference_formats.experimental.express import ExpressFormat
from a2ui.parser import A2uiCompilationError
from a2ui.parser import A2uiPart
from a2ui.parser import RawA2uiPart
from a2ui.parser import RawResponsePart
from a2ui.parser import TextPart
from a2ui.processor import CatalogConfig
from a2ui.processor import InMemoryCatalogProvider
from a2ui.schema import load_examples
from a2ui.utils import resolve_catalogs

from .conformance_helpers import get_conformance_path
from .conformance_helpers import load_conformance_json as load_json_file
from .conformance_helpers import load_conformance_yaml as load_tests

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
SKIP_TEST_NAMES: set[str] = set()

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


def part_to_dict(part) -> dict:
    if isinstance(part, TextPart):
        return {"text": part.text}
    if isinstance(part, A2uiPart):
        return {"a2ui": to_message_dicts(part.a2ui)}
    raise TypeError(f"Unexpected part type: {type(part)}")


def assert_parts_match(actual_parts, expected_parts):
    actual_dicts = [part_to_dict(p) for p in actual_parts]
    assert actual_dicts == expected_parts


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


CONFORMANCE_SURFACE_ID = "default_surface"

DEFAULT_CATALOG = "test_data/catalogs/simplified_catalog_v1_0.json"

# Cases the suites fix and this SDK does not yet satisfy. Marked strict so that
# fixing the implementation fails the marker instead of passing silently.
KNOWN_GAPS: dict[str, str] = {
    "test_compile_express_checks_on_uncheckable_component_is_a_validation_error": (
        "ExpressCompiler does not reject check lists on components that do not"
        " declare checks (https://github.com/a2ui-project/a2ui/issues/3099)"
    ),
    "test_compile_express_components_without_root_is_update_components": (
        "ExpressCompiler does not emit updateComponents for component blocks"
        " that omit root (https://github.com/a2ui-project/a2ui/issues/3099)"
    ),
    "test_compile_express_inline_array_id_collision_is_a_validation_error": (
        "ExpressCompiler does not reject inline array child IDs that collide"
        " with assigned variables"
        " (https://github.com/a2ui-project/a2ui/issues/3099)"
    ),
    "test_compile_express_inline_id_collision_is_a_validation_error": (
        "ExpressCompiler does not reject inline child IDs that collide with"
        " assigned variables (https://github.com/a2ui-project/a2ui/issues/3099)"
    ),
    "test_decompile_express_update_data_model_map_at_path": (
        "ExpressDecompiler does not flatten map values in updateDataModel at a"
        " non-root path into per-leaf assignments"
        " (https://github.com/a2ui-project/a2ui/issues/3099)"
    ),
}

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
    """Builds the CatalogConfig that a case's catalog entry describes."""
    transformers: list[CatalogTransformer] = []
    if isinstance(ref, dict) and "catalog" in ref:
        transformers = [_transformer(t) for t in ref.get("transformers", [])]
        ref = ref["catalog"]

    if isinstance(ref, dict):
        catalog = InMemoryCatalogProvider(
            ref,
            protocol_version=None if "protocolVersion" in ref else "v1.0",
            catalog_id=None if "catalogId" in ref else "inline",
        ).load()
        return CatalogConfig(
            catalog=catalog,
            transformers=transformers,
        )

    relative_path = str(ref)
    doc = load_json_file(relative_path)
    return CatalogConfig.from_path(
        catalog_path=get_conformance_path(relative_path),
        transformers=transformers,
        protocol_version=None if "protocolVersion" in doc else "v1.0",
        catalog_id=(
            None
            if "catalogId" in doc
            else os.path.basename(relative_path).removesuffix(".json")
        ),
    )


def setup_catalog_from_document(ref):
    """Builds the transformed Catalog that a case's catalog entry describes."""
    return catalog_config_from_document(ref).transformed_catalog


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
    """Builds the parser for the format a case names."""
    return _format_for(
        args["format"],
        _catalogs_for(args),
        allowed_messages=args.get("allowed_messages"),
        progressive_keys=args.get("progressive_keys"),
    ).create_parser()


def _format_for(
    format_name,
    catalogs,
    examples=None,
    allowed_messages=None,
    progressive_keys=None,
):
    if format_name == "express":
        return ExpressFormat(
            catalogs=catalogs,
            examples=examples,
            allowed_messages=allowed_messages,
            surface_id=CONFORMANCE_SURFACE_ID,
            version=_protocol_version(catalogs),
        )
    if format_name == "elemental":
        return ElementalFormat(
            catalogs=catalogs,
            examples=examples,
            allowed_messages=allowed_messages,
            surface_id=CONFORMANCE_SURFACE_ID,
        )
    if format_name == "atom":
        return AtomFormat(
            catalogs=catalogs,
            examples=examples,
            allowed_messages=allowed_messages,
            surface_id=CONFORMANCE_SURFACE_ID,
        )
    if format_name == "direct_json":
        kwargs = {}
        if progressive_keys is not None:
            kwargs["progressive_keys"] = frozenset(progressive_keys)
        return DirectJsonFormat(
            catalogs=catalogs,
            examples=examples,
            allowed_messages=allowed_messages,
            **kwargs,
        )
    raise ValueError(f"Unknown inference format: {format_name}")


def stage_examples(examples, tmp_path):
    """Copies a case's example files into a directory and loads them."""
    if not examples or tmp_path is None:
        return None
    examples_dir = str(tmp_path / "examples")
    os.makedirs(examples_dir, exist_ok=True)
    loaded = []
    for idx, ex_rel in enumerate(examples):
        src = get_conformance_path(ex_rel)
        dst = os.path.join(examples_dir, f"{idx:02d}_{os.path.basename(ex_rel)}")
        with open(src, "rb") as rf, open(dst, "wb") as wf:
            wf.write(rf.read())
        loaded.append(to_message_models(load_json_file(ex_rel)))
    return loaded


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

    loaded_examples = stage_examples(args.get("examples", []), tmp_path)
    return _format_for(
        format_name or args["format"],
        catalogs,
        examples=loaded_examples,
        allowed_messages=args.get("allowed_messages"),
        progressive_keys=args.get("progressive_keys"),
    )


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
    assert isinstance(raw_compiled, list)
    assert all(hasattr(m, "model_dump") for m in raw_compiled)
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

    notation = parser.decompile(to_message_models(messages))

    for fragment in test_case.get("expect_contains", []):
        assert fragment in notation, f"{fragment!r} not in {notation!r}"

    for fragment in test_case.get("expect_absent", []):
        assert fragment not in notation, f"{fragment!r} unexpectedly in {notation!r}"

    if test_case.get("expect_round_trip"):
        assert to_message_dicts(parser.compile(notation)) == messages

    if "expect_recompiled" in test_case:
        assert (
            to_message_dicts(parser.compile(notation)) == test_case["expect_recompiled"]
        )


# --- Response Parser Conformance ---


def raw_part_to_dict(part: RawResponsePart) -> dict:
    inner = part.part if isinstance(part, RawResponsePart) else part
    is_final = part.is_final if isinstance(part, RawResponsePart) else True
    if isinstance(inner, TextPart):
        return {"text": inner.text}
    if isinstance(inner, RawA2uiPart):
        res = {"a2ui_raw": inner.a2ui_raw}
        if not is_final:
            res["is_final"] = False
        return res
    raise TypeError(f"Unexpected raw part type: {type(part)}")


def without_final_flags(expected):
    if isinstance(expected, list):
        return [without_final_flags(item) for item in expected]
    if isinstance(expected, dict):
        return {
            k: v for k, v in expected.items() if not (k == "is_final" and v is True)
        }
    return expected


def assert_raw_parts_match(actual_parts, expected_parts):
    """Compares unwrapped parts, which carry raw payload text rather than messages."""
    actual_dicts = [raw_part_to_dict(p) for p in actual_parts]
    assert actual_dicts == without_final_flags(expected_parts)


def to_raw_parts(parts_dicts) -> list[RawResponsePart]:
    result: list[RawResponsePart] = []
    for part in parts_dicts:
        is_final = part.get("is_final", True)
        if "text" in part:
            result.append(
                RawResponsePart(part=TextPart(text=part["text"]), is_final=is_final)
            )
        elif "a2ui_raw" in part:
            result.append(
                RawResponsePart(
                    part=RawA2uiPart(a2ui_raw=part["a2ui_raw"]),
                    is_final=is_final,
                )
            )
        else:
            raise ValueError(f"Invalid raw part dict: {part}")
    return result


def wrap_parts(parser, parts):
    """Writes parts back out through `parser.wrap`."""
    return parser.wrap(to_raw_parts(parts))


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


# --- Streaming Response Conformance (Direct JSON) ---

cases_response_streaming = get_marked_conformance_cases(
    "agent/direct_json/response_streaming.yaml",
)


@pytest.mark.parametrize("name, test_case", cases_response_streaming)
def test_response_streaming_conformance(name, test_case):
    args = test_case["args"]
    wrapped = args.get("wrapped", True)
    parser = make_parser(args)
    chunks: list[str] = []
    yielded: list[dict] = []

    for step in test_case["steps"]:
        chunk = step["input"]
        chunks.append(chunk)
        if "expect_error" in step:
            with assert_raises(step["expect_error"]):
                parser.parse_chunk(chunk, wrapped=wrapped)
            return
        parts = parser.parse_chunk(chunk, wrapped=wrapped)
        assert_parts_match(parts, step["expect"])
        yielded.extend(part_to_dict(p) for p in parts)

    if test_case.get("expect_matches_single_shot"):
        fresh_parser = make_parser(args)
        single_shot_parts = fresh_parser.parse_response(
            "".join(chunks), wrapped=wrapped
        )
        assert [part_to_dict(p) for p in single_shot_parts] == yielded


# --- Multi-Catalog Formats Conformance (Express, Elemental, Atom, Direct JSON) ---

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

        def generate(fmt):
            return fmt.prompt_generator.generate()

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

        if expect.get("parsers_are_distinct"):
            assert fmt.create_parser() is not fmt.create_parser()
        if expect.get("parser_state_isolated"):
            chunks = args["probe_chunks"]

            def read(parser):
                return [
                    [part_to_dict(p) for p in parser.parse_chunk(chunk)]
                    for chunk in chunks
                ]

            first_parts = read(fmt.create_parser())
            assert any(first_parts)
            assert read(fmt.create_parser()) == first_parts
        snippet = fmt.prompt_generator.generate()
        _expect_snippet(
            snippet,
            expect.get("prompt_snippet_contains", []),
            expect.get("prompt_snippet_absent", []),
        )

    elif action == "create_processor":
        run_create_processor_case(test_case, tmp_path)

    else:
        raise ValueError(f"Unknown format case action: {action}")


# --- Prompt Generator Conformance ---

cases_prompt_generator = get_marked_conformance_cases(
    "agent/direct_json/prompt_generator.yaml",
    "agent/express/prompt_generator.yaml",
)


@pytest.mark.parametrize("name, test_case", cases_prompt_generator)
def test_prompt_generator_conformance(name, test_case, tmp_path):
    run_format_case(test_case, tmp_path)


# --- Request Processor Conformance ---

cases_request_processor = get_marked_conformance_cases(
    "agent/request_processor.yaml",
)


def _describe_configs(configs):
    """What a set of registered configs holds, to compare across a negotiation."""
    described = []
    for config in configs:
        catalog = config.transformed_catalog
        described.append(
            (catalog.catalog_id, sorted(catalog.components), sorted(catalog.functions))
        )
    return described


def _expect_catalog(catalog, expected):
    """Checks a catalog against a case's expectations. Name lists are exhaustive."""
    if "catalog_id" in expected:
        assert catalog.catalog_id == expected["catalog_id"]
    if "components" in expected:
        assert sorted(catalog.components) == sorted(set(expected["components"]))
    if "functions" in expected:
        assert sorted(catalog.functions) == sorted(set(expected["functions"]))


def _factory_for(format_name, allowed_messages=None, progressive_keys=None):
    from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
    from a2ui.inference_formats.experimental.atom import AtomFormatFactory
    from a2ui.inference_formats.experimental.elemental import ElementalFormatFactory
    from a2ui.inference_formats.experimental.express import ExpressFormatFactory

    if format_name == "express":
        return ExpressFormatFactory(
            allowed_messages=allowed_messages,
            surface_id=CONFORMANCE_SURFACE_ID,
        )
    if format_name == "elemental":
        return ElementalFormatFactory(
            allowed_messages=allowed_messages,
            surface_id=CONFORMANCE_SURFACE_ID,
        )
    if format_name == "atom":
        return AtomFormatFactory(
            allowed_messages=allowed_messages,
            surface_id=CONFORMANCE_SURFACE_ID,
        )
    if format_name == "direct_json":
        kwargs = {}
        if progressive_keys is not None:
            kwargs["progressive_keys"] = frozenset(progressive_keys)
        return DirectJsonFormatFactory(
            allowed_messages=allowed_messages,
            **kwargs,
        )
    raise ValueError(f"Unknown inference format: {format_name}")


def run_create_processor_case(test_case, tmp_path):
    from a2ui.processor import A2uiGenerator

    args = test_case["args"]
    configs = [catalog_config_from_document(entry) for entry in args["catalogs"]]
    before = _describe_configs(configs)
    loaded_examples = stage_examples(args.get("examples", []), tmp_path)
    base_factory = _factory_for(
        args.get("format", "direct_json"),
        allowed_messages=args.get("allowed_messages"),
        progressive_keys=args.get("progressive_keys"),
    )
    override_factory = (
        _factory_for(
            args["format_override"],
            allowed_messages=args.get("allowed_messages"),
            progressive_keys=args.get("progressive_keys"),
        )
        if "format_override" in args
        else None
    )
    generator = A2uiGenerator(
        catalogs=configs,
        examples=loaded_examples,
        inference_format_factory=base_factory,
        accepts_inline_catalogs=args.get("accepts_inline_catalogs", False),
    )

    def create():
        processor = generator.create_processor(
            args.get("renderer_capabilities"),
            inference_format_factory=override_factory,
        )
        snippet = processor.prompt_snippet
        return processor, snippet

    if "expect_error" in test_case:
        with assert_raises(test_case["expect_error"]):
            create()
        return

    processor, snippet = create()
    active = processor.active_catalogs
    expect = test_case.get("expect", {})
    if "active_catalog_ids" in expect:
        assert [c.catalog_id for c in active] == expect["active_catalog_ids"]
    for catalog, expected in zip(active, expect.get("catalogs", [])):
        _expect_catalog(catalog, expected)
    _expect_snippet(
        snippet,
        expect.get("prompt_snippet_contains", []),
        expect.get("prompt_snippet_absent", []),
    )
    if expect.get("generator_catalogs_unchanged"):
        assert _describe_configs(generator.catalogs) == before

    parse = test_case.get("then_parse")
    if parse is not None:
        if "expect_error" in parse:
            with assert_raises(parse["expect_error"]):
                processor.parse_response(parse["input"])
        else:
            assert_parts_match(
                processor.parse_response(parse["input"]), parse["expect"]
            )


@pytest.mark.parametrize("name, test_case", cases_request_processor)
def test_request_processor_conformance(name, test_case, tmp_path):
    run_format_case(test_case, tmp_path)
