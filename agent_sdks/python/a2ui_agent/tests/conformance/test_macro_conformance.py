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

"""Conformance test runner for A2UI macro expansion."""

import inspect
import os
from typing import Any, Sequence

from pydantic import ConfigDict
import pytest
import yaml

from a2ui.builder import (
    ComponentBuilderNode,
    DataBinding,
)
from a2ui.inference_formats.experimental.macros import (
    MacroParser,
    clear_macros,
    macro,
)
from a2ui.parser.parser import Parser

TYPE_MAP = {
    "string": str,
    "integer": int,
    "boolean": bool,
    "component": ComponentBuilderNode,
    "component_list": Sequence[ComponentBuilderNode],
    "binding": DataBinding,
}


class DynamicConformanceNode(ComponentBuilderNode):
    """Dynamic AST node allowing arbitrary extra properties for conformance testing."""

    model_config = ConfigDict(extra="allow", arbitrary_types_allowed=True)


def _get_conformance_path(filename: str) -> str:
    return os.path.abspath(
        os.path.join(os.path.dirname(__file__), "../../../../../conformance", filename)
    )


def load_yaml_tests(filename: str) -> list[dict[str, Any]]:
    path = _get_conformance_path(filename)
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def _eval_template(template: Any, kwargs: dict[str, Any]) -> Any:
    if isinstance(template, str):
        if template.startswith("${") and template.endswith("}"):
            var_name = template[2:-1]
            if var_name in kwargs:
                return kwargs[var_name]
        res = template
        for k, v in kwargs.items():
            if isinstance(v, (str, int, float, bool)):
                res = res.replace(f"${{{k}}}", str(v))
        return res

    elif isinstance(template, list):
        res_list: list[Any] = []
        for item in template:
            if isinstance(item, str) and item.startswith("${") and item.endswith("}"):
                var = item[2:-1]
                val = kwargs.get(var)
                if isinstance(val, (list, tuple)):
                    res_list.extend(val)
                    continue
                elif val is not None:
                    res_list.append(val)
                    continue
            res_list.append(_eval_template(item, kwargs))
        return res_list

    elif isinstance(template, dict):
        comp = template.get("component")
        props = {}
        for k, v in template.items():
            if k == "component":
                continue
            props[k] = _eval_template(v, kwargs)
        return DynamicConformanceNode(component=comp, **props)

    return template


class _MockWireParser(Parser):
    """Simple parser returning static wire messages for compile() testing."""

    def __init__(self, messages: list[dict[str, Any]]):
        self._messages = messages

    def has_format_content(self, content: str, *, complete: bool = False) -> bool:
        return True

    def unwrap(self, content: str):
        return []

    def compile(self, format_content: str, *, is_final: bool = True):
        return self._messages

    def parse_response(self, content: str):
        return []

    @property
    def supports_streaming(self) -> bool:
        return False

    def decompile(self, val: Any) -> str:
        return ""

    def wrap_decompiled_blocks(self, blocks: list[str]) -> str:
        return ""


@pytest.fixture(autouse=True)
def _reset_registry():
    clear_macros()
    yield
    clear_macros()


CONFORMANCE_CASES = load_yaml_tests("macros/parsing.yaml")


@pytest.mark.parametrize(
    "case", CONFORMANCE_CASES, ids=[c["name"] for c in CONFORMANCE_CASES]
)
def test_macro_conformance_case(case: dict[str, Any]):
    """Executes a language-agnostic macro conformance test case."""
    clear_macros()

    for m in case.get("macros", []):
        m_name = m["name"]
        m_params = m.get("parameters", {})
        m_tmpl = m["template"]

        param_types = {}
        defaults = {}
        param_objs = []
        for p_name, p_spec in m_params.items():
            p_type = TYPE_MAP.get(p_spec.get("type", "string"), Any)
            param_types[p_name] = p_type
            if "default" in p_spec:
                defaults[p_name] = p_spec["default"]
                p_param = inspect.Parameter(
                    p_name,
                    inspect.Parameter.KEYWORD_ONLY,
                    default=p_spec["default"],
                    annotation=p_type,
                )
            else:
                p_param = inspect.Parameter(
                    p_name, inspect.Parameter.KEYWORD_ONLY, annotation=p_type
                )
            param_objs.append(p_param)

        sig = inspect.Signature(
            parameters=param_objs, return_annotation=ComponentBuilderNode
        )

        def make_func(tmpl: Any, defs: dict[str, Any]):
            def fn(**kwargs: Any):
                all_kwargs = dict(defs)
                all_kwargs.update(kwargs)
                return _eval_template(tmpl, all_kwargs)

            return fn

        fn = make_func(m_tmpl, defaults)
        fn.__signature__ = sig
        fn.__name__ = m_name
        fn.__annotations__ = dict(param_types)
        fn.__annotations__["return"] = ComponentBuilderNode
        macro(fn)

    wire_parser = _MockWireParser(case["input_messages"])
    parser = MacroParser(wire_parser)
    result = parser.compile("conformance_input")

    assert result == case["expected_messages"]
