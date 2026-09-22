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

"""Conformance test harness for A2UI inference formats (Express, round-tripping, etc.)."""

import os
import glob
import json
import re
import yaml
import pytest
from typing import Any, Dict, List, Optional, Union

from a2ui.core.catalog import Catalog
from a2ui.schema.catalog import A2uiCatalog, CatalogConfig
from a2ui.inference_formats.experimental.express.compiler import ExpressCompiler
from a2ui.inference_formats.experimental.express.parser import ExpressParser
from a2ui.inference_formats.experimental.express.format import ExpressFormat
from a2ui.core import (
    A2uiError,
    A2uiParseError,
    A2uiValidationError,
    A2uiCatalogError,
    A2uiIntegrityError,
    A2uiRecursionError,
)
from a2ui.parser.errors import A2uiCompilationError
from a2ui.inference_formats.experimental.express.errors import ExpressCompilerError

REPO_ROOT = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "..",
        "..",
        "..",
    )
)
CONFORMANCE_DIR = os.path.join(REPO_ROOT, "conformance")
INFERENCE_FORMATS_DIR = os.path.join(CONFORMANCE_DIR, "agent", "inference_formats")

CATEGORY_TO_EXCEPTION = {
    "ParseError": A2uiParseError,
    "ValidationError": A2uiValidationError,
    "CatalogError": A2uiCatalogError,
    "IntegrityError": A2uiIntegrityError,
    "RecursionError": A2uiRecursionError,
    "CompilationError": (
        A2uiCompilationError,
        ExpressCompilerError,
        SyntaxError,
        ValueError,
    ),
    "CompileError": (
        A2uiCompilationError,
        ExpressCompilerError,
        SyntaxError,
        ValueError,
    ),
}


def assert_raises_conformance(expect_error):
    if isinstance(expect_error, dict):
        category = expect_error.get("category")
        message = expect_error.get("message", "")
        expected_class = CATEGORY_TO_EXCEPTION.get(
            category, (A2uiError, ExpressCompilerError, SyntaxError, ValueError)
        )
    else:
        expected_class = (A2uiError, ExpressCompilerError, SyntaxError, ValueError)
        message = expect_error

    class Context:

        def __enter__(self):
            self._ctx = pytest.raises(expected_class)
            self.excinfo = self._ctx.__enter__()
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            suppressed = self._ctx.__exit__(exc_type, exc_val, exc_tb)
            if suppressed and message:
                assert re.search(message, str(self.excinfo.value))
            return suppressed

    return Context()


def load_yaml_file(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_json_file(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def normalize_value(val: Any) -> Any:
    if isinstance(val, dict):
        normalized = {}
        for k, v in val.items():
            if k == "returnType":
                continue
            if k == "event" and isinstance(v, dict):
                if "context" in v and not v["context"]:
                    normalized[k] = {
                        ek: normalize_value(ev)
                        for ek, ev in v.items()
                        if ek != "context"
                    }
                    continue
            normalized[k] = normalize_value(v)
        return normalized
    if isinstance(val, list):
        return [normalize_value(item) for item in val]
    return val


def get_catalog_for_test(catalog_spec: Any, version: str = "v1.0") -> A2uiCatalog:
    norm_version = (
        "0.9"
        if version in ["v0.9", "0.9"]
        else ("0.9.1" if version in ["v0.9.1", "0.9.1"] else "1.0")
    )
    spec_dir_name = "v0_9" if norm_version in ["0.9", "0.9.1"] else "v1_0"

    if catalog_spec is None or catalog_spec == "basic":
        cat_path = os.path.join(
            REPO_ROOT,
            "specification",
            spec_dir_name,
            "catalogs",
            "basic",
            "catalog.json",
        )
        config = CatalogConfig.from_path("basic", cat_path)
        return A2uiCatalog.from_config(config, version=norm_version)

    if isinstance(catalog_spec, str):
        cat_path = os.path.join(REPO_ROOT, catalog_spec)
        config = CatalogConfig.from_path("test_catalog", cat_path)
        return A2uiCatalog.from_config(config, version=norm_version)

    if isinstance(catalog_spec, dict):
        if "path" in catalog_spec:
            cat_path = os.path.join(REPO_ROOT, catalog_spec["path"])
            config = CatalogConfig.from_path(
                catalog_spec.get("name", "test_catalog"), cat_path
            )
            return A2uiCatalog.from_config(config, version=norm_version)
        if "catalog_schema" in catalog_spec:
            from a2ui.schema.catalog_provider import InMemoryCatalogProvider

            config = CatalogConfig(
                name=catalog_spec.get("name", "test_catalog"),
                provider=InMemoryCatalogProvider(catalog_spec["catalog_schema"]),
            )
            return A2uiCatalog.from_config(config, version=norm_version)

    raise ValueError(f"Unsupported catalog spec: {catalog_spec}")


def assert_payloads_match(actual: List[Dict[str, Any]], expected: Any) -> None:
    if isinstance(expected, dict) and "messages" in expected:
        messages = expected["messages"]
        expected_components = []
        surface_id = "main"

        for msg in messages:
            if "createSurface" in msg:
                surface_id = msg["createSurface"].get("surfaceId", surface_id)
                if "components" in msg["createSurface"]:
                    expected_components = msg["createSurface"]["components"]
            if "updateComponents" in msg:
                expected_components = msg["updateComponents"].get("components", [])

        if not actual:
            assert not messages
            return

        envelope = actual[0]

        if "deleteSurface" in envelope:
            expected_msg = next((m for m in messages if "deleteSurface" in m), None)
            assert expected_msg is not None
            assert expected_msg["deleteSurface"] == envelope["deleteSurface"]
            return

        if "callFunction" in envelope:
            expected_msg = next((m for m in messages if "callFunction" in m), None)
            assert expected_msg is not None
            assert (
                expected_msg["callFunction"]["call"] == envelope["callFunction"]["call"]
            )
            assert normalize_value(
                expected_msg["callFunction"].get("args", {})
            ) == normalize_value(envelope["callFunction"].get("args", {}))
            return

        if "updateDataModel" in envelope:
            expected_msg = next(
                (m for m in messages if "updateDataModel" in m or "updateData" in m),
                None,
            )
            assert expected_msg is not None
            expected_val = (
                expected_msg.get("updateDataModel", {}).get("value", {})
                if "updateDataModel" in expected_msg
                else expected_msg.get("updateData", {}).get("data", {})
            )
            assert normalize_value(expected_val) == normalize_value(
                envelope["updateDataModel"].get("value", {})
            )
            return

        compiled_components = envelope.get("createSurface", {}).get("components", [])
        assert len(compiled_components) == len(expected_components)

        expected_sorted = sorted(expected_components, key=lambda x: x["id"])
        compiled_sorted = sorted(compiled_components, key=lambda x: x["id"])

        for idx, exp_comp in enumerate(expected_sorted):
            comp = compiled_sorted[idx]
            assert exp_comp["id"] == comp["id"]
            assert exp_comp["component"] == comp["component"]

            for key, exp_val in exp_comp.items():
                if key in ["id", "component"]:
                    continue
                assert key in comp
                assert normalize_value(exp_val) == normalize_value(comp[key])
        return

    # Direct list or single envelope comparison
    expected_list = expected if isinstance(expected, list) else [expected]
    assert len(actual) == len(expected_list)

    for act_env, exp_env in zip(actual, expected_list):
        for key in exp_env:
            assert key in act_env
            if key == "createSurface" and "components" in exp_env["createSurface"]:
                act_comps = sorted(
                    act_env["createSurface"].get("components", []),
                    key=lambda x: x["id"],
                )
                exp_comps = sorted(
                    exp_env["createSurface"]["components"], key=lambda x: x["id"]
                )
                assert len(act_comps) == len(exp_comps)
                for a_c, e_c in zip(act_comps, exp_comps):
                    assert a_c["id"] == e_c["id"]
                    assert a_c["component"] == e_c["component"]
                    for prop in e_c:
                        assert prop in a_c
                        assert normalize_value(e_c[prop]) == normalize_value(a_c[prop])
            else:
                assert normalize_value(exp_env[key]) == normalize_value(act_env[key])


def get_conformance_test_cases(pattern_rel: str) -> List[tuple[str, Dict[str, Any]]]:
    pattern = os.path.join(INFERENCE_FORMATS_DIR, pattern_rel)
    cases = []
    for fpath in sorted(glob.glob(pattern, recursive=True)):
        suite = load_yaml_file(fpath)
        if isinstance(suite, list):
            for case in suite:
                cases.append((case["name"], case))
    return cases


# Collect test cases for each category
compile_cases = get_conformance_test_cases(
    "express/compile.yaml"
) + get_conformance_test_cases("express/specification_examples.yaml")
decompile_cases = get_conformance_test_cases("express/decompile.yaml")
round_trip_cases = get_conformance_test_cases("round_trip.yaml")
prompt_cases = get_conformance_test_cases("express/prompt_generation.yaml")


@pytest.mark.parametrize(
    "name,test_case", compile_cases, ids=[c[0] for c in compile_cases]
)
def test_inference_format_compile(name: str, test_case: Dict[str, Any]):
    version = test_case.get("version", "v1.0")
    catalog = get_catalog_for_test(test_case.get("catalog"), version=version)
    compiler = ExpressCompiler(catalog, version=version)

    if "input_file" in test_case:
        with open(
            os.path.join(REPO_ROOT, test_case["input_file"]), "r", encoding="utf-8"
        ) as f:
            input_content = f.read()
    else:
        input_content = test_case["input"]

    surface_id = test_case.get("surface_id", "main")
    catalog_id = test_case.get("catalog_id")
    is_final = test_case.get("is_final", True)

    if "expect_error" in test_case:
        with assert_raises_conformance(test_case["expect_error"]):
            compiler.compile(
                input_content,
                surface_id=surface_id,
                catalog_id=catalog_id,
                is_final=is_final,
            )
    else:
        actual = compiler.compile(
            input_content,
            surface_id=surface_id,
            catalog_id=catalog_id,
            is_final=is_final,
        )

        if "expect_file" in test_case:
            expected = load_json_file(os.path.join(REPO_ROOT, test_case["expect_file"]))
        else:
            expected = test_case["expect"]

        assert_payloads_match(actual, expected)


@pytest.mark.parametrize(
    "name,test_case", decompile_cases, ids=[c[0] for c in decompile_cases]
)
def test_inference_format_decompile(name: str, test_case: Dict[str, Any]):
    version = test_case.get("version", "v1.0")
    catalog = get_catalog_for_test(test_case.get("catalog"), version=version)
    surface_id = test_case.get("surface_id", "main")
    decompiler = ExpressParser(catalog, surface_id=surface_id, version=version)

    if "input_file" in test_case:
        input_payload = load_json_file(os.path.join(REPO_ROOT, test_case["input_file"]))
    else:
        input_payload = test_case["input"]

    if "expect_error" in test_case:
        with assert_raises_conformance(test_case["expect_error"]):
            decompiler.decompile(input_payload)
    else:
        actual = decompiler.decompile(input_payload)

        if "expect_file" in test_case:
            with open(
                os.path.join(REPO_ROOT, test_case["expect_file"]), "r", encoding="utf-8"
            ) as f:
                expected = f.read()
            assert actual.strip() == expected.strip()
        elif "expect" in test_case:
            assert actual.strip() == test_case["expect"].strip()

        if "expect_contains" in test_case:
            for substr in test_case["expect_contains"]:
                assert substr in actual


@pytest.mark.parametrize(
    "name,test_case", round_trip_cases, ids=[c[0] for c in round_trip_cases]
)
def test_inference_format_round_trip(name: str, test_case: Dict[str, Any]):
    version = test_case.get("version", "v1.0")
    catalog = get_catalog_for_test(test_case.get("catalog"), version=version)
    surface_id = test_case.get("surface_id", "main")
    catalog_id = test_case.get("catalog_id")

    compiler = ExpressCompiler(catalog, version=version)
    decompiler = ExpressParser(catalog, surface_id=surface_id, version=version)

    if "input_file" in test_case:
        raw_input = load_json_file(os.path.join(REPO_ROOT, test_case["input_file"]))
        messages = raw_input.get("messages", [])
        components_list = None
        for msg in messages:
            if "updateComponents" in msg:
                components_list = msg["updateComponents"].get("components", [])
                surface_id = msg["updateComponents"].get("surfaceId", surface_id)
                break
            if "createSurface" in msg and "components" in msg["createSurface"]:
                components_list = msg["createSurface"]["components"]
                surface_id = msg["createSurface"].get("surfaceId", surface_id)
                break

        if components_list:
            envelope_input = {
                "version": version,
                "createSurface": {
                    "surfaceId": surface_id,
                    "catalogId": (
                        catalog_id
                        or "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
                    ),
                    "components": components_list,
                },
            }
        else:
            envelope_input = raw_input
    else:
        envelope_input = test_case["input"]

    dsl = decompiler.decompile(envelope_input)
    compiled = compiler.compile(dsl, surface_id=surface_id, catalog_id=catalog_id)

    assert_payloads_match(compiled, envelope_input)


@pytest.mark.parametrize(
    "name,test_case", prompt_cases, ids=[c[0] for c in prompt_cases]
)
def test_inference_format_generate_prompt(name: str, test_case: Dict[str, Any]):
    version = test_case.get("version", "v1.0")
    catalog = get_catalog_for_test(test_case.get("catalog"), version=version)
    args = test_case.get("args", {})

    examples_path = args.get("examples_path")
    if examples_path:
        examples_path = os.path.join(REPO_ROOT, examples_path)

    fmt = ExpressFormat(
        catalog=catalog,
        examples_path=examples_path,
        version=version,
    )
    generator = fmt.prompt_generator

    generate_kwargs: Dict[str, Any] = {
        "role_description": args.get("role_description", ""),
        "workflow_description": args.get("workflow_description", ""),
        "ui_description": args.get("ui_description", ""),
        "include_schema": args.get("include_schema", False),
        "include_examples": args.get("include_examples", False),
        "validate_examples": args.get("validate_examples", False),
    }
    if "allowed_components" in args:
        generate_kwargs["allowed_components"] = args["allowed_components"]
    if "allowed_messages" in args:
        generate_kwargs["allowed_messages"] = args["allowed_messages"]
    if "client_ui_capabilities" in args:
        generate_kwargs["client_ui_capabilities"] = args["client_ui_capabilities"]

    prompt = generator.generate(**generate_kwargs)

    if "expect" in test_case:
        assert prompt.strip() == test_case["expect"].strip()

    if "expect_contains" in test_case:
        for substr in test_case["expect_contains"]:
            assert substr in prompt

    if "expect_not_contains" in test_case:
        for substr in test_case["expect_not_contains"]:
            assert substr not in prompt
