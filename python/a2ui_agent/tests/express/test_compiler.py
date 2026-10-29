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

"""Unit tests focusing on the Python A2UI Express Compiler.

Data-driven input/output compilation behavior is comprehensively covered by the
platform-agnostic conformance suite in `conformance/agent/express/compiler.yaml`
(run via `tests/conformance/test_conformance.py`).

These unit tests specifically cover Python language-specific aspects that
conformance suites leave to the SDK implementation:
- Multi-threaded execution and compiler thread safety
- Custom Python exception hierarchies and error properties (e.g. ExpressCompilerError subclasses)
- Catalog initialization from Catalog models
- Python schema helper initialization validation and feature flag gating
"""

import json
import os
import unittest

from a2ui.core import Catalog
from a2ui.inference_formats import to_message_dicts
from a2ui.inference_formats._shared import CatalogSchemaHelper
from a2ui.inference_formats.express import (
    ExpressCompiler,
    ExpressDuplicateParamError,
    ExpressDuplicatePropertyError,
    ExpressInvalidParamError,
    ExpressParseError,
    ExpressParser,
    ExpressUndefinedRootError,
    ExpressUnknownPropertyError,
    ExpressValidationError,
)

from ..repo_paths import find_repo_root

REPO_ROOT = find_repo_root(os.path.dirname(__file__)) or ""
CATALOGS_DIR = os.path.join(REPO_ROOT, "catalogs", "basic")
CATALOG_PATH = os.path.join(CATALOGS_DIR, "v1", "catalog.json")


class TestExpressCompiler(unittest.TestCase):
    """Test suite covering the Express compiler, prompt generation, and schema parsing."""

    def setUp(self):
        """Initializes standard test paths and schema helpers."""
        self.catalog_path = CATALOG_PATH
        with open(self.catalog_path, "r", encoding="utf-8") as f:
            catalog_dict = json.load(f)
        self.catalog = Catalog.from_json(catalog_dict, protocol_version="1.0")
        self.helper = CatalogSchemaHelper(self.catalog)

    def test_compiler_concurrency(self):
        """Verifies that ExpressCompiler is thread-safe and supports concurrent compilation."""
        import threading

        compiler = ExpressCompiler([self.catalog])
        errors = []

        dsl_1 = """
root = Column([text1])
text1 = Text("Hello Thread 1")
"""
        dsl_2 = """
root = Column([button2])
button2 = Button(btnLabel, action=Event("click"))
btnLabel = Text("Click Thread 2")
"""

        def compile_worker(dsl: str, expected_id: str):
            try:
                res = to_message_dicts(compiler.compile(dsl, surface_id="test_surf"))[0]
                components = res["createSurface"]["components"]
                child = next((c for c in components if c["id"] == expected_id), None)
                self.assertIsNotNone(child)
                self.assertEqual(child["id"], expected_id)
            except Exception as e:
                errors.append(e)

        threads = []
        for _ in range(5):
            threads.append(
                threading.Thread(target=compile_worker, args=(dsl_1, "text1"))
            )
            threads.append(
                threading.Thread(target=compile_worker, args=(dsl_2, "button2"))
            )

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(errors, [], f"Concurrency errors encountered: {errors}")

    def test_semicolons_and_trailing_commas_and_line_continuation(self):
        """Verifies that optional semicolons, trailing commas, and line continuations compile correctly."""
        compiler = ExpressCompiler([self.catalog])

        # 1. Test optional semicolons at the end of statements
        semicolon_dsl = """
    root = Column([btn1]);
    btn1 = Button("Click Me", action=Event("click"));
    """
        envelope = to_message_dicts(compiler.compile(semicolon_dsl))[0]
        self.assertEqual(len(envelope["createSurface"]["components"]), 2)

        # 2. Test trailing commas in lists, maps, component calls, and checks
        trailing_comma_dsl = """
    root = Column([btn1, btn2,],);
    btn1 = Button("Label", "primary", myAction,);
    btn2 = TextField("Input", $/val, "placeholder", _, ?numeric(1, 10,),);
    myAction = Event("click", {a: 1, b: 2,},);
    """
        envelope2 = to_message_dicts(compiler.compile(trailing_comma_dsl))[0]
        components = envelope2["createSurface"]["components"]
        self.assertEqual(len(components), 3)

        # 3. Test line continuation where newlines are completely insignificant
        continuation_dsl = """
    root
      =
      Column
      (
        [
          btn1
        ]
      )
    btn1 = Text("Hello World")
    """
        envelope3 = to_message_dicts(compiler.compile(continuation_dsl))[0]
        self.assertEqual(len(envelope3["createSurface"]["components"]), 2)

    def test_catalog_initialization(self):
        """Verifies compiler, decompiler, prompt generator, and parser with Catalog."""
        with open(self.catalog_path, "r", encoding="utf-8") as f:
            catalog_dict = json.load(f)

        core_catalog = Catalog.from_json(catalog_dict, protocol_version="1.0")

        dsl = """root = Column([repField, valueField])
repField = TextField("Representative", $/form/rep, "Enter name")
valueField = TextField("Deal Value", $/form/value, "0.00", "number", ?required)"""

        expected_components_count = 3

        # Compiler
        compiler = ExpressCompiler([core_catalog])
        compiled_models = compiler.compile(dsl, surface_id="test_surf")
        envelope = to_message_dicts(compiled_models)[0]
        self.assertEqual(
            len(envelope["createSurface"]["components"]), expected_components_count
        )

        # Decompiler
        decompiler = ExpressParser([core_catalog])
        decompiled_dsl = decompiler.decompile(compiled_models)
        self.assertIn("repField = TextField(", decompiled_dsl)

        # Prompt Generator
        from a2ui.inference_formats.express import ExpressFormat

        fmt = ExpressFormat([core_catalog])
        prompt = fmt.prompt_generator.generate()
        self.assertIn("TextField(", prompt)

        # Parser
        response = f"<a2ui>\n{dsl}\n</a2ui>"
        parts = ExpressParser([core_catalog], surface_id="test_surf").parse_response(
            response
        )
        self.assertEqual(len(parts), 1)
        self.assertIsNotNone(parts[0].a2ui)

    def test_catalog_schema_helper_initialization_errors(self):
        """Verifies that CatalogSchemaHelper raises correct errors for invalid initialization inputs."""
        # 1. None inputs raise ValueError
        # None or unsupported type raises TypeError
        with self.assertRaises(TypeError):
            CatalogSchemaHelper(None)

        with self.assertRaises(TypeError) as context:
            CatalogSchemaHelper(123)
        self.assertIn("Unsupported catalog type", str(context.exception))

        # Passing string path should now raise TypeError
        with self.assertRaises(TypeError) as context:
            CatalogSchemaHelper(self.catalog_path)
        self.assertIn("Unsupported catalog type", str(context.exception))

    def test_custom_exception_types(self):
        """Verifies specific ExpressCompilerError subclasses are raised for invalid DSL constructs."""
        compiler = ExpressCompiler([self.catalog])

        # 1. Unknown component property
        with self.assertRaises(ExpressUnknownPropertyError) as ctx:
            compiler.compile('root = Text(text="Hi", nonExistentProp="bad")')
        self.assertEqual(ctx.exception.comp_name, "Text")
        self.assertEqual(ctx.exception.prop_name, "nonExistentProp")
        self.assertIn("nonExistentProp", str(ctx.exception))

        # 2. Duplicate component property
        with self.assertRaises(ExpressDuplicatePropertyError) as ctx:
            compiler.compile('root = Text("Positional", text="KeywordDuplicate")')
        self.assertEqual(ctx.exception.comp_name, "Text")
        self.assertEqual(ctx.exception.prop_name, "text")

        # 3. Invalid function parameter
        with self.assertRaises(ExpressInvalidParamError) as ctx:
            compiler.compile(
                'root = Button("Click", action=openUrl("https://example.com",'
                " unknownParam=123))"
            )
        self.assertEqual(ctx.exception.fn_name, "openUrl")
        self.assertEqual(ctx.exception.param_name, "unknownParam")

        # 4. Duplicate function parameter
        with self.assertRaises(ExpressDuplicateParamError) as ctx:
            compiler.compile(
                'root = Button("Click", action=openUrl("https://example.com",'
                ' url="https://duplicate.com"))'
            )
        self.assertEqual(ctx.exception.fn_name, "openUrl")
        self.assertEqual(ctx.exception.param_name, "url")

        # 5. Missing root definition
        with self.assertRaises(ExpressUndefinedRootError) as ctx:
            compiler.compile('some_var = Text("Hello")')
        self.assertEqual(ctx.exception.root_target, "root")

    def test_line_wrapped_identifiers_and_strings(self):
        """Verifies stray newlines inside identifiers, paths, and single-line strings are repaired."""
        compiler = ExpressCompiler([self.catalog])
        dsl = (
            'surface("main")\n'
            '$/\nform/phone = "555-0100"\n'
            "root = Column([\n"
            "  card2\nRating\n"
            '], justify="start\n")\n'
            "card2\nRating = Card(lights\nCheckbox)\n"
            "lightsCheckbox = Text($/\nform/phone)\n"
        )
        messages = to_message_dicts(compiler.compile(dsl))
        self.assertEqual(len(messages), 1)
        comps = {c["id"]: c for c in messages[0]["createSurface"]["components"]}
        self.assertEqual(comps["root"]["justify"], "start")
        self.assertEqual(comps["root"]["children"], ["card2Rating"])
        self.assertEqual(comps["card2Rating"]["child"], "lightsCheckbox")
        self.assertEqual(comps["lightsCheckbox"]["text"], {"@path": "/form/phone"})

    def test_sql_comments_and_positional_numeric_skip(self):
        """Verifies `--` comments and positional numeric argument skipping non-numeric properties."""
        compiler = ExpressCompiler([self.catalog])
        dsl = '-- SQL comment\nroot = Column([t], 2)\nt = Text("Hello")'
        messages = to_message_dicts(compiler.compile(dsl))
        self.assertEqual(len(messages), 1)
        comps = {c["id"]: c for c in messages[0]["createSurface"]["components"]}
        self.assertEqual(comps["root"]["children"], ["t"])
        self.assertEqual(comps["root"]["weight"], 2)

    def test_enum_property_with_function_call_not_rejected_by_enum_check(self):
        """Verifies that an enum property passed a function call is not rejected as an invalid enum choice."""
        compiler = ExpressCompiler([self.catalog])
        dsl = 'root = Column([t], justify=formatString("start"))\nt = Text("Hello")'
        messages = to_message_dicts(compiler.compile(dsl))
        self.assertEqual(len(messages), 1)
        comps = {c["id"]: c for c in messages[0]["createSurface"]["components"]}
        self.assertEqual(
            comps["root"]["justify"],
            {"@call": "formatString", "args": {"value": "start"}},
        )

    def test_number_literal_forms(self):
        """Verifies the number literal grammar reads like JSON, with exact Python ints."""
        compiler = ExpressCompiler([self.catalog])
        cases = [
            (".5", 0.5),
            ("-.25", -0.25),
            ("1.", 1.0),
            ("+3", 3),
            ("1e2", 100.0),
            ("1E-2", 0.01),
            ("2.5e-7", 2.5e-7),
            ("9007199254740991", 9007199254740991),
            ("18446744073709551616", 18446744073709551616),
            ("-0", 0),
        ]
        for literal, expected in cases:
            with self.subTest(literal=literal):
                dsl = f'root = Column([t], weight={literal})\nt = Text("Hi")'
                messages = to_message_dicts(compiler.compile(dsl))
                comps = {c["id"]: c for c in messages[0]["createSurface"]["components"]}
                weight = comps["root"]["weight"]
                self.assertEqual(weight, expected)
                self.assertIs(type(weight), type(expected))

    def test_number_literal_parse_errors(self):
        """Verifies out-of-range and malformed number literals are parse errors."""
        compiler = ExpressCompiler([self.catalog])
        for literal in ["1e999", "-1e999", "1e"]:
            with self.subTest(literal=literal):
                dsl = f'root = Column([t], weight={literal})\nt = Text("Hi")'
                with self.assertRaises(ExpressParseError):
                    compiler.compile(dsl)
        # A bare `.` matches no token at all, which the compiler reports the
        # way it reports every lexer error (ExpressParser maps both to
        # A2uiParseError).
        with self.assertRaises(SyntaxError):
            compiler.compile('root = Column([t], weight=.)\nt = Text("Hi")')


def _links_catalog(protocol_version: str) -> Catalog:
    """Builds a catalog whose `Links` component nests an action inside each list item.

    `items[].action` and `primary` are `Action` slots, `tags[]` is a plain
    string list, and `openUrl`/`concat` are catalog functions.
    """
    call_key = "@call" if protocol_version == "1.0" else "call"
    return Catalog.from_json(
        {
            "catalogId": "test/links",
            "components": {
                "Links": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "Links"},
                        "items": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "label": {"type": "string"},
                                    "action": {
                                        "$ref": "common_types.json#/$defs/Action"
                                    },
                                },
                                "required": ["label", "action"],
                            },
                        },
                        "primary": {"$ref": "common_types.json#/$defs/Action"},
                        "tags": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["component", "items"],
                },
            },
            "functions": {
                "openUrl": {
                    "type": "object",
                    "returnType": "void",
                    "properties": {
                        call_key: {"const": "openUrl"},
                        "args": {
                            "type": "object",
                            "properties": {"url": {"type": "string"}},
                            "required": ["url"],
                        },
                    },
                    "required": [call_key, "args"],
                },
                "concat": {
                    "type": "object",
                    "returnType": "string",
                    "properties": {
                        call_key: {"const": "concat"},
                        "args": {
                            "type": "object",
                            "properties": {
                                "a": {"type": "string"},
                                "b": {"type": "string"},
                            },
                            "required": ["a", "b"],
                        },
                    },
                    "required": [call_key, "args"],
                },
            },
        },
        protocol_version=protocol_version,
    )


class TestExpressEventAndNestedActionSlots(unittest.TestCase):
    """Covers the `Event(...)` keyword signature and action slots nested in list items."""

    def setUp(self):
        self.catalog = _links_catalog("1.0")
        self.compiler = ExpressCompiler([self.catalog], version="1.0")

    def _root(self, dsl: str) -> dict:
        messages = to_message_dicts(self.compiler.compile(dsl))
        comps = {c["id"]: c for c in messages[0]["createSurface"]["components"]}
        return comps["root"]

    def test_event_user_message_compiles_to_v1_field(self):
        root = self._root(
            'root = Links([{label: "Reply", action: Event("reply",'
            ' userMessage="Now")}])'
        )
        self.assertEqual(
            root["items"][0]["action"],
            {"event": {"name": "reply", "userMessage": "Now"}},
        )

    def test_event_context_keeps_a_function_call_a_plain_call(self):
        root = self._root(
            'root = Links([{label: "Go", action: Event("go",'
            ' {label: concat("a", "b")})}])'
        )
        self.assertEqual(
            root["items"][0]["action"]["event"]["context"]["label"],
            {"@call": "concat", "args": {"a": "a", "b": "b"}},
        )

    def test_event_user_message_binding_with_positional_context(self):
        root = self._root(
            'root = Links([{label: "Reply", action: Event("reply", {threadId:'
            ' "t1"}, userMessage=$/draft/message)}])'
        )
        self.assertEqual(
            root["items"][0]["action"],
            {
                "event": {
                    "name": "reply",
                    "userMessage": {"@path": "/draft/message"},
                    "context": {"threadId": "t1"},
                }
            },
        )

    def test_event_context_keyword(self):
        root = self._root(
            'root = Links([{label: "Go", action: Event("submit", context={itemId:'
            ' "42"})}])'
        )
        self.assertEqual(
            root["items"][0]["action"],
            {"event": {"name": "submit", "context": {"itemId": "42"}}},
        )

    def test_event_duplicate_context_is_a_validation_error(self):
        with self.assertRaises(ExpressDuplicateParamError) as ctx:
            self.compiler.compile(
                'root = Links([{label: "Go", action: Event("submit", {a: 1},'
                " context={b: 2})}])"
            )
        self.assertIsInstance(ctx.exception, ExpressValidationError)

    def test_event_unknown_keyword_is_a_validation_error(self):
        with self.assertRaises(ExpressInvalidParamError) as ctx:
            self.compiler.compile(
                'root = Links([{label: "Reply", action: Event("reply",'
                ' message="Now")}])'
            )
        self.assertIsInstance(ctx.exception, ExpressValidationError)
        self.assertIn("message", str(ctx.exception))

    def test_event_user_message_accepts_a_function_call(self):
        root = self._root(
            'root = Links([{label: "Reply", action: Event("reply",'
            ' userMessage=concat("a", "b"))}])'
        )
        self.assertEqual(
            root["items"][0]["action"],
            {
                "event": {
                    "name": "reply",
                    "userMessage": {
                        "@call": "concat",
                        "args": {"a": "a", "b": "b"},
                    },
                }
            },
        )

    def test_event_user_message_that_is_not_a_dynamic_string_is_an_error(self):
        with self.assertRaises(ExpressValidationError) as ctx:
            self.compiler.compile(
                'root = Links([{label: "Reply", action: Event("reply",'
                " userMessage=42)}])"
            )
        self.assertEqual(
            str(ctx.exception),
            "Event userMessage must be a string, a $path data binding or a"
            " function call, got the number 42.",
        )
        with self.assertRaises(ExpressValidationError) as ctx:
            self.compiler.compile(
                'root = Links([{label: "Reply", action: Event("reply",'
                " userMessage={a: 1})}])"
            )
        self.assertIn("got a map literal.", str(ctx.exception))

    def test_property_named_items_is_a_property_not_the_array_items(self):
        """A map key `items` is an object property; its item schema is reached through a local $ref."""
        catalog = Catalog.from_json(
            {
                "catalogId": "test/menu",
                "components": {
                    "Menu": {
                        "type": "object",
                        "properties": {
                            "component": {"const": "Menu"},
                            "menu": {
                                "type": "object",
                                "properties": {
                                    "items": {
                                        "type": "array",
                                        "items": {"$ref": "#/$defs/MenuItem"},
                                    }
                                },
                            },
                        },
                        "required": ["component", "menu"],
                    }
                },
                "functions": {
                    "openUrl": {
                        "type": "object",
                        "returnType": "void",
                        "properties": {
                            "@call": {"const": "openUrl"},
                            "args": {
                                "type": "object",
                                "properties": {"url": {"type": "string"}},
                                "required": ["url"],
                            },
                        },
                        "required": ["@call", "args"],
                    }
                },
                "$defs": {
                    "MenuItem": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string"},
                            "action": {"$ref": "common_types.json#/$defs/Action"},
                        },
                        "required": ["label", "action"],
                    }
                },
            },
            protocol_version="1.0",
        )
        compiler = ExpressCompiler([catalog], version="1.0")
        messages = to_message_dicts(
            compiler.compile(
                'root = Menu({items: [{label: "Docs", action:'
                ' openUrl("https://a2ui.org")}]})'
            )
        )
        root = messages[0]["createSurface"]["components"][0]
        self.assertEqual(
            root["menu"]["items"],
            [{
                "label": "Docs",
                "action": {
                    "functionCall": {
                        "@call": "openUrl",
                        "args": {"url": "https://a2ui.org"},
                    }
                },
            }],
        )

    def test_event_too_many_positional_args_is_a_validation_error(self):
        with self.assertRaises(ExpressValidationError):
            self.compiler.compile(
                'root = Links([{label: "Reply", action: Event("reply", {}, "extra")}])'
            )

    def test_event_user_message_before_v1_is_a_validation_error(self):
        compiler = ExpressCompiler([_links_catalog("0.9")], version="v0.9")
        with self.assertRaises(ExpressValidationError) as ctx:
            compiler.compile(
                'root = Links([{label: "Reply", action: Event("reply",'
                ' userMessage="Now")}])'
            )
        self.assertIn("v1.0", str(ctx.exception))

    def test_function_call_in_list_item_action_slot_is_wrapped(self):
        root = self._root(
            'root = Links([{label: "Docs", action: openUrl("https://a2ui.org")}],'
            ' primary=openUrl("https://a2ui.org/start"))'
        )
        self.assertEqual(
            root["items"][0]["action"],
            {
                "functionCall": {
                    "@call": "openUrl",
                    "args": {"url": "https://a2ui.org"},
                }
            },
        )
        self.assertEqual(
            root["primary"],
            {
                "functionCall": {
                    "@call": "openUrl",
                    "args": {"url": "https://a2ui.org/start"},
                }
            },
        )

    def test_function_call_in_list_item_action_slot_through_variable(self):
        root = self._root(
            'docs = {label: "Docs", action: openUrl("https://a2ui.org")}\n'
            "root = Links([docs])"
        )
        self.assertEqual(
            root["items"][0]["action"],
            {
                "functionCall": {
                    "@call": "openUrl",
                    "args": {"url": "https://a2ui.org"},
                }
            },
        )

    def test_function_call_in_non_action_nested_slot_stays_a_plain_call(self):
        root = self._root(
            'root = Links([{label: "Go", action: Event("go")}], tags=[concat("a",'
            ' "b")])'
        )
        self.assertEqual(
            root["tags"],
            [{"@call": "concat", "args": {"a": "a", "b": "b"}}],
        )


if __name__ == "__main__":
    unittest.main()
