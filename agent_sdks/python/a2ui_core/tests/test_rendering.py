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

from typing import Any, Dict, List
import pytest

from a2ui.core.state import ComponentModel, SurfaceModel, DataModel
from a2ui.core.rendering import (
    ComponentContext,
    DataContext,
    GenericBinder,
    MissingDataBindingWarning,
)
from a2ui.core.basic_catalog import BasicCatalog


def test_component_context_from_surface():
    surface = SurfaceModel("s1", BasicCatalog(), theme={"primaryColor": "#123456"})
    c1 = ComponentModel("c1", "Button", {"label": "Click"})
    surface.components_model.add_component(c1)

    ctx = ComponentContext.from_surface(surface, "c1")
    assert ctx.theme == {"primaryColor": "#123456"}
    assert ctx.component_model.id == "c1"

    actions: List[Dict[str, Any]] = []
    surface.on_action.subscribe(lambda act: actions.append(act))

    ctx.dispatch_action({"name": "submit"})
    assert len(actions) == 1
    assert actions[0]["name"] == "submit"
    assert actions[0]["sourceComponentId"] == "c1"

    with pytest.raises(ValueError, match="Component not found"):
        ComponentContext.from_surface(surface, "missing")

    surface.dispose()


def test_data_context_resolve_action_and_locale():
    surface = SurfaceModel("s1", BasicCatalog(), locale="fr-FR")
    surface.data_model.set("/username", "Alice")

    ctx = DataContext(surface=surface)
    assert ctx.locale == "fr-FR"

    # Resolve event action containing dynamic context binding
    action = {
        "event": {
            "name": "save",
            "context": {"user": {"path": "/username"}},
        }
    }
    res = ctx.resolve_action(action)
    assert res == {"event": {"name": "save", "context": {"user": "Alice"}}}

    # Resolve function call action
    func_act = {"functionCall": {"path": "/username"}}
    assert ctx.resolve_action(func_act) == "Alice"

    surface.dispose()


def test_data_context_missing_binding_warning():
    ctx = DataContext()
    with pytest.warns(MissingDataBindingWarning, match="does not physically exist"):
        val = ctx.resolve_dynamic_value({"path": "/missing/pointer"})
    assert val is None


def test_generic_binder_reactive_checks():
    surface = SurfaceModel("s1", BasicCatalog())
    surface.data_model.set("/score", 50)

    c1 = ComponentModel(
        "c1",
        "NumberInput",
        {
            "value": {"path": "/score"},
            "checks": [
                {
                    "condition": {"path": "/score"},
                    "message": "Score must be non-zero",
                }
            ],
        },
    )
    surface.components_model.add_component(c1)

    ctx = ComponentContext.from_surface(surface, "c1")
    binder = GenericBinder(ctx)

    props_history: List[Dict[str, Any]] = []
    binder.subscribe(lambda p: props_history.append(p))

    assert binder.current_props["value"] == 50
    assert binder.current_props["isValid"] is True

    # Mutating score to 0 should reactively trigger check failure
    surface.data_model.set("/score", 0)
    assert binder.current_props["value"] == 0
    assert binder.current_props["isValid"] is False
    assert "Score must be non-zero" in binder.current_props["validationErrors"]

    binder.dispose()
    surface.dispose()


def test_data_context_relative_scoping():
    data_model = DataModel()
    data_model.set("/users/0/name", "Alice")

    # Root context
    root_ctx = DataContext(path="/", data_model=data_model)
    assert root_ctx.resolve_path("users/0/name") == "/users/0/name"

    # Nested context scope
    nested_ctx = root_ctx.nested("users/0")
    assert nested_ctx.path == "/users/0/"
    assert nested_ctx.resolve_path("name") == "/users/0/name"
    assert nested_ctx.resolve_dynamic_value({"path": "name"}) == "Alice"


def test_resolve_dynamic_values():
    data_model = DataModel({"user": {"name": "Bob", "age": 25}})
    ctx = DataContext(path="/", data_model=data_model)

    # 1. Literal
    assert ctx.resolve_dynamic_value("hello") == "hello"
    assert ctx.resolve_dynamic_value(42) == 42

    # 2. Data Pointer Path
    assert ctx.resolve_dynamic_value({"path": "user/name"}) == "Bob"
    assert ctx.resolve_dynamic_value({"path": "/user/age"}) == 25

    # 3. Nested elements resolution
    mixed_properties = {
        "title": "Welcome",
        "user_name": {"path": "user/name"},
        "score": 100,
    }
    resolved = ctx.resolve_dynamic_value(mixed_properties)
    assert resolved == {"title": "Welcome", "user_name": "Bob", "score": 100}


def test_string_interpolation_format_string():
    from a2ui.core.basic_catalog import BasicCatalog

    data_model = DataModel({"user": {"name": "Charlie"}})
    ctx = DataContext(path="/", data_model=data_model, catalog=BasicCatalog())

    # Test basic formatString execution
    expr = {"call": "formatString", "args": {"value": "Hello ${user/name}!"}}

    resolved = ctx.resolve_dynamic_value(expr)
    assert resolved == "Hello Charlie!"


def test_string_interpolation_with_escapes():
    from a2ui.core.basic_catalog import BasicCatalog

    data_model = DataModel({"user": {"name": "Charlie"}})
    ctx = DataContext(path="/", data_model=data_model, catalog=BasicCatalog())

    # Escaped block resolving to literal string
    expr = {
        "call": "formatString",
        "args": {"value": r"Keep \${escaped} as literal and resolve ${user/name}"},
    }

    resolved = ctx.resolve_dynamic_value(expr)
    assert resolved == "Keep ${escaped} as literal and resolve Charlie"


def test_generic_binder_reactive_property_changes():
    data_model = DataModel({"item": {"title": "Original"}})
    comp = ComponentModel("text_1", "Text", {"text": {"path": "item/title"}})
    ctx = DataContext(path="/", data_model=data_model)
    context = ComponentContext(comp, ctx)

    binder = GenericBinder(context)
    assert binder.current_props["text"] == "Original"

    # Mutate data model
    data_model.set("/item/title", "Mutated")
    assert binder.current_props["text"] == "Mutated"

    binder.dispose()


def test_generic_binder_checks_validation():
    data_model = DataModel({"checkbox_state": False})
    comp = ComponentModel(
        "btn_1",
        "Button",
        {
            "checks": [
                {
                    "condition": {"path": "/checkbox_state"},
                    "message": "You must check the box!",
                }
            ]
        },
    )
    ctx = DataContext(path="/", data_model=data_model)
    context = ComponentContext(comp, ctx)

    binder = GenericBinder(context)

    # Initial: State is False, so check fails
    assert binder.current_props["isValid"] is False
    assert binder.current_props["validationErrors"] == ["You must check the box!"]

    # Update state to True
    data_model.set("/checkbox_state", True)
    assert binder.current_props["isValid"] is True
    assert binder.current_props["validationErrors"] == []

    binder.dispose()


def test_expression_parser_literals_and_interpolation():
    from a2ui.core.basic_catalog.expression_parser import ExpressionParser

    parser = ExpressionParser()

    assert parser.parse("hello world") == ["hello world"]
    assert parser.parse("hello ${foo}") == ["hello ", {"path": "foo"}]
    assert parser.parse("${true} ${false} ${null}") == [True, " ", False, " "]
    assert parser.parse('${${"nested"}}') == ["nested"]


def test_expression_parser_function_calls():
    from a2ui.core.basic_catalog.expression_parser import ExpressionParser

    parser = ExpressionParser()

    parsed = parser.parse("sum is ${add(a: 10, b: 20)}")
    assert parsed == [
        "sum is ",
        {"call": "add", "args": {"a": 10, "b": 20}, "returnType": "any"},
    ]


def test_expression_parser_parse_errors():
    from a2ui.core.basic_catalog.expression_parser import ExpressionParser

    parser = ExpressionParser()

    with pytest.raises(ValueError, match="Unclosed interpolation"):
        parser.parse("hello ${world")

    with pytest.raises(ValueError, match="Expected '\\)'"):
        parser.parse("${add(a: 1, b: 2}")

    with pytest.raises(ValueError, match="Max recursion depth reached"):
        parser.parse("deep", 11)


def test_string_interpolation_complex_execution():
    data_model = DataModel({"a": 10, "b": 20})

    class MockCatalog:

        def invoker(self, name, args, context):
            if name == "add":
                return args["a"] + args["b"]
            elif name == "formatString":
                from a2ui.core.basic_catalog.function_impls import _format_string

                return _format_string(args, context)
            return None

    ctx = DataContext(path="/", data_model=data_model, catalog=MockCatalog())
    expr = {"call": "formatString", "args": {"value": "Calculated: ${add(a: 5, b: 7)}"}}

    resolved = ctx.resolve_dynamic_value(expr)
    assert resolved == "Calculated: 12"
