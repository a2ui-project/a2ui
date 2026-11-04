# Copyright 2024 Google LLC
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

"""Tests for agent functions declared on a catalog."""

from __future__ import annotations

from typing import Any
import warnings

from pydantic import BaseModel, Field
import pytest

from a2ui.core import AgentFunction, AgentFunctionContext, Catalog, CatalogApi
from a2ui.core.basic_catalog.v1_0 import BasicCatalog as BasicCatalogV1_0
from a2ui.core.catalog import FunctionApi, FunctionImplementation
from a2ui.core.exceptions import A2uiCatalogError, A2uiValidationError
from a2ui.core.validation import STRICT_VALIDATION, PayloadValidator

FX_RATE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "base": {"type": "string"},
        "target": {"type": "string", "default": "USD"},
    },
    "required": ["base"],
    "additionalProperties": False,
}


def _handler(args: dict[str, Any], context: AgentFunctionContext) -> Any:
    return 1.08


CONTEXT = AgentFunctionContext(
    catalog_id="c", surface_id="s", function_call_id="call-1"
)

# A function the catalog declares without implementing it, as a catalog
# document declares a function that the agent provides.
VERIFY_PROVIDER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"provider": {"type": "string"}},
    "required": ["provider"],
    "additionalProperties": False,
}


def _verify_provider() -> FunctionApi:
    return FunctionApi(
        "verifyProvider",
        return_type="boolean",
        schema=VERIFY_PROVIDER_SCHEMA,
        description="Checks a provider with the agent's records.",
    )


def _fetch_fx_rate(name: str = "fetchFxRate") -> AgentFunction:
    return AgentFunction(
        name,
        handler=_handler,
        return_type="number",
        schema=FX_RATE_SCHEMA,
        description="Current exchange rate from base to target.",
    )


def _basic_catalog() -> CatalogApi:
    """The basic catalog as an agent loads it: from its document, schema-only."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        document = BasicCatalogV1_0().catalog_schema
    return Catalog.from_json(document, protocol_version="1.0")


def _declaring_catalog() -> CatalogApi:
    """A loaded catalog whose document declares `verifyProvider`."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        document = BasicCatalogV1_0().catalog_schema
    any_function = document["$defs"]["anyFunction"]
    document = {
        **document,
        "$defs": {
            **document["$defs"],
            "anyFunction": {
                "oneOf": [
                    *any_function["oneOf"],
                    {"$ref": "#/functions/verifyProvider"},
                ]
            },
        },
        "functions": {
            **document["functions"],
            "verifyProvider": {
                "type": "object",
                "description": "Checks a provider with the agent's records.",
                "returnType": "boolean",
                "properties": {
                    "@call": {"const": "verifyProvider"},
                    "args": VERIFY_PROVIDER_SCHEMA,
                },
                "required": ["@call", "args"],
            },
        },
    }
    return Catalog.from_json(document, protocol_version="1.0")


def _function_names(catalog: CatalogApi) -> list[str]:
    return list(catalog.functions)


class TestAgentFunction:

    def test_is_a_function_api_without_an_implementation(self):
        fn = _fetch_fx_rate()

        assert isinstance(fn, FunctionApi)
        assert not hasattr(fn, "execute")
        assert fn.handler is _handler
        assert fn.allowed_callers == "rendererOnly"
        assert fn.declaration is None

    def test_rejects_a_handler_that_is_not_callable(self):
        with pytest.raises(TypeError, match="fetchFxRate"):
            AgentFunction("fetchFxRate", handler="not callable")  # type: ignore[arg-type]

    def test_has_no_allowed_callers_parameter(self):
        with pytest.raises(TypeError):
            AgentFunction(  # type: ignore[call-arg]
                "fetchFxRate", handler=_handler, allowed_callers="agentOnly"
            )

    def test_invoke_passes_the_context_to_a_two_parameter_handler(self):
        received: list[Any] = []

        def handler(args: dict[str, Any], context: AgentFunctionContext) -> Any:
            received.append((args, context))
            return "ok"

        fn = AgentFunction("f", handler=handler)

        assert fn.invoke({"a": 1}, CONTEXT) == "ok"
        assert received == [({"a": 1}, CONTEXT)]

    def test_invoke_passes_only_the_args_to_a_one_parameter_handler(self):
        received: list[Any] = []

        def handler(args: dict[str, Any]) -> Any:
            received.append(args)
            return "ok"

        fn = AgentFunction("f", handler=handler)

        assert fn.invoke({"a": 1}, CONTEXT) == "ok"
        assert received == [{"a": 1}]

    def test_invoke_passes_the_context_to_a_variadic_handler(self):
        fn = AgentFunction("f", handler=lambda *call: call)

        assert fn.invoke({"a": 1}, CONTEXT) == ({"a": 1}, CONTEXT)

    def test_a_defaulted_second_parameter_is_not_given_the_context(self):
        sentinel = object()

        def handler(args: dict[str, Any], client: Any = sentinel) -> Any:
            return client

        fn = AgentFunction("f", handler=handler)

        assert fn.invoke({}, CONTEXT) is sentinel

    @pytest.mark.parametrize("param", ["context", "ctx"])
    def test_a_defaulted_context_parameter_is_given_the_context(self, param: str):
        namespace: dict[str, Any] = {}
        exec(f"def handler(args, {param}=None):\n    return {param}", namespace)

        fn = AgentFunction("f", handler=namespace["handler"])

        assert fn.invoke({}, CONTEXT) is CONTEXT

    def test_a_bound_method_handler(self):
        class Service:

            def run(self, args: dict[str, Any], context: AgentFunctionContext) -> Any:
                return context.function_call_id

        fn = AgentFunction("f", handler=Service().run)

        assert fn.invoke({}, CONTEXT) == "call-1"

    @pytest.mark.parametrize(
        "handler",
        [lambda: 1, lambda a, b, c: 1, lambda *, args: 1],
        ids=["no parameters", "three required", "keyword-only"],
    )
    def test_rejects_a_handler_of_the_wrong_arity(self, handler: Any):
        with pytest.raises(TypeError, match=r"\(args\) or \(args, context\)"):
            AgentFunction("f", handler=handler)

    def test_handler_is_read_only(self):
        fn = _fetch_fx_rate()

        with pytest.raises(AttributeError):
            fn.handler = _handler  # type: ignore[misc]

    def test_with_handler_rebinds_a_direct_agent_function(self):
        fn = _fetch_fx_rate()

        rebound = fn.with_handler(lambda args: 2.0)

        assert rebound is not fn
        assert fn.handler is _handler
        assert rebound.invoke({}, CONTEXT) == 2.0
        assert rebound.name == fn.name
        assert rebound.schema is fn.schema
        assert rebound.description == fn.description
        assert rebound.return_type == fn.return_type
        assert rebound.allowed_callers == "rendererOnly"
        assert rebound.declaration is None

    def test_with_handler_keeps_the_declaration(self):
        declaration = FunctionApi(
            "consultOracle",
            schema=FX_RATE_SCHEMA,
            allowed_callers="rendererOrAgent",
            description="Asks the oracle.",
        )
        fn = AgentFunction.from_api(declaration, _handler)

        rebound = fn.with_handler(lambda args: "yes")

        assert rebound.declaration is declaration
        assert rebound.allowed_callers == "rendererOrAgent"
        assert rebound.description == "Asks the oracle."
        assert rebound.invoke({}, CONTEXT) == "yes"

    def test_with_handler_checks_the_handler(self):
        with pytest.raises(TypeError):
            _fetch_fx_rate().with_handler(lambda: 1)

    def test_constructor_has_no_document_parameters(self):
        for param in ("is_definition", "from_document"):
            with pytest.raises(TypeError):
                AgentFunction("f", handler=_handler, **{param: True})

    def test_from_api_copies_the_document_fields(self):
        declaration = _declaring_catalog().functions["verifyProvider"]

        fn = AgentFunction.from_api(declaration, _handler)

        assert fn.is_definition is declaration.is_definition is True
        assert fn.from_document is declaration.from_document is True

    def test_from_api_rejects_user_activation_without_renderer_only(self):
        declaration = FunctionApi(
            "verifyProvider",
            schema=VERIFY_PROVIDER_SCHEMA,
            allowed_callers="rendererOrAgent",
            requires_user_activation=True,
        )

        with pytest.raises(A2uiCatalogError, match="user activation"):
            AgentFunction.from_api(declaration, _handler)

    def test_from_api_accepts_user_activation_on_renderer_only(self):
        declaration = FunctionApi(
            "verifyProvider",
            schema=VERIFY_PROVIDER_SCHEMA,
            requires_user_activation=True,
        )

        fn = AgentFunction.from_api(declaration, _handler)

        assert fn.requires_user_activation is True

    def test_context_is_keyword_only(self):
        with pytest.raises(TypeError):
            AgentFunctionContext("c", "s", "call-1")  # type: ignore[misc]

    def test_invoke_returns_a_coroutine_of_an_async_handler(self):
        async def handler(args: dict[str, Any]) -> Any:
            return args["a"]

        fn = AgentFunction("f", handler=handler)
        result = fn.invoke({"a": 1}, CONTEXT)

        try:
            with pytest.raises(StopIteration) as stopped:
                result.send(None)
            assert stopped.value.value == 1
        finally:
            result.close()

    def test_from_api_keeps_the_declaration(self):
        declaration = FunctionApi(
            "consultOracle",
            return_type="string",
            schema=FX_RATE_SCHEMA,
            allowed_callers="rendererOrAgent",
            description="Asks the oracle.",
        )

        fn = AgentFunction.from_api(declaration, _handler)

        assert fn.declaration is declaration
        assert fn.name == "consultOracle"
        assert fn.return_type == "string"
        assert fn.schema is declaration.schema
        assert fn.allowed_callers == "rendererOrAgent"
        assert fn.requires_user_activation is False
        assert fn.description == "Asks the oracle."
        assert fn.is_definition == declaration.is_definition
        assert fn.from_document == declaration.from_document

    def test_from_api_keeps_renderer_only(self):
        fn = AgentFunction.from_api(_verify_provider(), _handler)

        assert fn.allowed_callers == "rendererOnly"

    def test_from_api_rejects_an_agent_only_declaration(self):
        declaration = FunctionApi(
            "verifyProvider",
            schema=VERIFY_PROVIDER_SCHEMA,
            allowed_callers="agentOnly",
        )

        with pytest.raises(A2uiCatalogError, match="agentOnly"):
            AgentFunction.from_api(declaration, _handler)

    def test_from_api_rejects_an_agent_function(self):
        with pytest.raises(TypeError, match="already an agent function"):
            AgentFunction.from_api(_fetch_fx_rate(), _handler)

    @pytest.mark.parametrize(
        "api", [None, {"name": "verifyProvider"}, FunctionApi], ids=repr
    )
    def test_from_api_rejects_what_is_not_a_function_api(self, api: Any):
        with pytest.raises(TypeError, match="Expected a FunctionApi"):
            AgentFunction.from_api(api, _handler)


class TestCatalogAgentFunctions:

    def test_constructor_has_no_agent_functions_parameter(self):
        with pytest.raises(TypeError):
            Catalog(  # type: ignore[call-arg]
                "c", "1.0", agent_functions=[_fetch_fx_rate()]
            )

    def test_agent_function_passed_in_functions_is_an_agent_function(self):
        fx = _fetch_fx_rate()

        catalog = Catalog("c", "1.0", functions=[fx])

        assert catalog.functions == {"fetchFxRate": fx}
        assert catalog.agent_functions == {"fetchFxRate": fx}
        assert catalog.renderer_functions == {}

    def test_lists_agent_and_renderer_functions_apart(self):
        local = FunctionApi("formatRate", schema=FX_RATE_SCHEMA)
        fx = _fetch_fx_rate()

        catalog = Catalog("c", "1.0", functions=[local, fx])

        assert _function_names(catalog) == ["formatRate", "fetchFxRate"]
        assert catalog.agent_functions == {"fetchFxRate": fx}
        assert catalog.renderer_functions == {"formatRate": local}

    def test_renderer_functions_is_a_copy(self):
        catalog = Catalog(
            "c", "1.0", functions=[FunctionApi("formatRate", schema=FX_RATE_SCHEMA)]
        )

        catalog.renderer_functions.clear()

        assert list(catalog.renderer_functions) == ["formatRate"]
        assert list(catalog.functions) == ["formatRate"]

    def test_rejects_a_function_list_mixing_an_agent_function_and_its_name(self):
        local = FunctionApi("fetchFxRate", schema=FX_RATE_SCHEMA)

        with pytest.raises(A2uiCatalogError, match="already declares a function"):
            Catalog("c", "1.0", functions=[_fetch_fx_rate(), local])

    def test_rejects_two_agent_functions_with_one_name_in_functions(self):
        with pytest.raises(A2uiCatalogError, match="more than one agent function"):
            Catalog("c", "1.0", functions=[_fetch_fx_rate(), _fetch_fx_rate()])

    def test_rejects_agent_functions_before_v1_0(self):
        with pytest.raises(A2uiCatalogError, match="need v1.0 or later"):
            Catalog("c", "0.9", functions=[_fetch_fx_rate()])

    def test_rejects_an_agent_function_with_an_invalid_identifier(self):
        with pytest.raises(A2uiCatalogError, match="Invalid UAX #31"):
            Catalog("c", "1.0", functions=[_fetch_fx_rate("fetch-fx-rate")])

    @pytest.mark.parametrize(
        "schema",
        [
            {"type": "object", "properties": {"target-currency": {"type": "string"}}},
            {"allOf": [{"properties": {"target-currency": {"type": "string"}}}]},
            {
                "type": "object",
                "properties": {
                    "@call": {"const": "fetchRate"},
                    "args": {"properties": {"target-currency": {"type": "string"}}},
                },
            },
        ],
        ids=["properties", "allOf", "definition"],
    )
    def test_rejects_an_agent_function_with_an_invalid_parameter_name(
        self, schema: dict[str, Any]
    ):
        fn = AgentFunction("fetchRate", handler=_handler, schema=schema)

        with pytest.raises(A2uiCatalogError, match="target-currency"):
            Catalog("c", "1.0", functions=[fn])

    def test_rejects_an_invalid_parameter_name_of_a_pydantic_schema(self):
        class Args(BaseModel):
            target: str = Field(alias="target-currency")

        fn = AgentFunction("fetchRate", handler=_handler, schema=Args)

        with pytest.raises(A2uiCatalogError, match="target-currency"):
            Catalog("c", "1.0", functions=[fn])

    def test_parameter_names_are_not_checked_before_v1_0(self):
        fn = FunctionApi(
            "fetchRate",
            schema={"type": "object", "properties": {"target-currency": {}}},
        )

        assert list(Catalog("c", "0.9", functions=[fn]).functions) == ["fetchRate"]

    def test_renderer_functions_keeps_the_function_type(self):
        impl = FunctionImplementation("double", execute=lambda args: args["n"] * 2)

        catalog: Catalog[Any, FunctionImplementation[Any]] = Catalog(
            "c", "1.0", functions=[impl]
        )

        assert catalog.renderer_functions["double"].execute({"n": 2}) == 4


class TestCatalogDocument:

    def test_writes_an_agent_function_like_a_declared_function(self):
        with_agent = Catalog("c", "1.0", functions=[_fetch_fx_rate()])
        declared = Catalog(
            "c",
            "1.0",
            functions=[
                FunctionApi(
                    "fetchFxRate",
                    return_type="number",
                    schema=FX_RATE_SCHEMA,
                    description="Current exchange rate from base to target.",
                )
            ],
        )

        assert with_agent.to_json() == declared.to_json()

    def test_from_api_keeps_a_document_definition_as_written(self):
        catalog = _declaring_catalog()
        declaration = catalog.functions["verifyProvider"]

        replaced = catalog.copy_with(
            agent_functions=[AgentFunction.from_api(declaration, _handler)]
        )

        assert replaced.to_json() == catalog.to_json()
        assert list(replaced.agent_functions) == ["verifyProvider"]
        assert "verifyProvider" not in replaced.renderer_functions


class TestCopyWith:

    def test_adds_agent_functions_to_a_loaded_catalog(self):
        catalog = _basic_catalog()
        fx = _fetch_fx_rate()

        copy = catalog.copy_with(agent_functions=[fx])

        assert copy.catalog_id == catalog.catalog_id
        assert _function_names(copy) == [*_function_names(catalog), "fetchFxRate"]
        assert copy.agent_functions == {"fetchFxRate": fx}
        assert catalog.agent_functions == {}

    def test_keeps_agent_functions_when_not_given(self):
        catalog = _basic_catalog().copy_with(agent_functions=[_fetch_fx_rate()])

        copy = catalog.copy_with()

        assert copy.agent_functions == catalog.agent_functions

    def test_replaces_the_agent_functions(self):
        catalog = _basic_catalog().copy_with(agent_functions=[_fetch_fx_rate()])
        quote = _fetch_fx_rate("quote")

        copy = catalog.copy_with(agent_functions=[quote])

        assert copy.agent_functions == {"quote": quote}
        assert "fetchFxRate" not in copy.functions

    def test_from_api_entry_replaces_the_declaration_in_place(self):
        catalog = _declaring_catalog()
        declaration = catalog.functions["verifyProvider"]
        fn = AgentFunction.from_api(declaration, _handler)

        copy = catalog.copy_with(agent_functions=[fn])

        assert _function_names(copy) == _function_names(catalog)
        assert copy.functions["verifyProvider"] is fn
        assert copy.agent_functions == {"verifyProvider": fn}

    def test_rejects_a_from_api_entry_the_catalog_does_not_declare(self):
        foreign = AgentFunction.from_api(_verify_provider(), _handler)

        with pytest.raises(A2uiCatalogError, match="has no function named"):
            _basic_catalog().copy_with(agent_functions=[foreign])

    def test_rejects_a_from_api_entry_of_another_declaration_with_its_name(self):
        catalog = _declaring_catalog()
        other = AgentFunction.from_api(_verify_provider(), _handler)

        with pytest.raises(A2uiCatalogError, match="different declaration"):
            catalog.copy_with(agent_functions=[other])

    def test_rejects_a_from_api_entry_of_a_reloaded_catalog(self):
        catalog = _declaring_catalog()
        reloaded = Catalog.from_json(catalog.to_json(), protocol_version="1.0")
        fn = AgentFunction.from_api(reloaded.functions["verifyProvider"], _handler)

        with pytest.raises(A2uiCatalogError, match="different declaration") as e:
            catalog.copy_with(agent_functions=[fn])
        assert "already declares" not in str(e.value)

    def test_keeps_agent_functions_given_in_functions(self):
        catalog = _basic_catalog()
        standalone = _fetch_fx_rate()
        extra = _fetch_fx_rate("quote")

        copy = catalog.copy_with(
            functions=[*catalog.functions.values(), standalone],
            agent_functions=[extra],
        )

        assert copy.agent_functions == {"fetchFxRate": standalone, "quote": extra}

    def test_given_functions_are_not_reverted_to_declarations(self):
        catalog = _declaring_catalog()
        fn = AgentFunction.from_api(catalog.functions["verifyProvider"], _handler)
        with_agent = catalog.copy_with(agent_functions=[fn])

        copy = with_agent.copy_with(
            functions=list(with_agent.functions.values()), agent_functions=[]
        )

        assert copy.functions["verifyProvider"] is fn

    def test_rejects_an_invalid_parameter_name(self):
        fn = AgentFunction(
            "fetchRate",
            handler=_handler,
            schema={
                "type": "object",
                "properties": {"target-currency": {"type": "string"}},
            },
        )

        with pytest.raises(A2uiCatalogError, match="target-currency"):
            _basic_catalog().copy_with(agent_functions=[fn])

    def test_rejects_two_agent_functions_with_one_name(self):
        with pytest.raises(A2uiCatalogError, match="more than one agent function"):
            _basic_catalog().copy_with(
                agent_functions=[_fetch_fx_rate(), _fetch_fx_rate()]
            )

    def test_rejects_two_from_api_entries_of_one_declaration(self):
        catalog = _declaring_catalog()
        declaration = catalog.functions["verifyProvider"]

        with pytest.raises(A2uiCatalogError, match="more than one agent function"):
            catalog.copy_with(
                agent_functions=[
                    AgentFunction.from_api(declaration, _handler),
                    AgentFunction.from_api(declaration, _handler),
                ]
            )

    def test_rejects_an_entry_that_is_not_an_agent_function(self):
        local = FunctionApi("fetchFxRate", schema=FX_RATE_SCHEMA)

        with pytest.raises(A2uiCatalogError, match="not an `AgentFunction`"):
            _basic_catalog().copy_with(agent_functions=[local])  # type: ignore[list-item]

    def test_rejects_agent_functions_before_v1_0(self):
        catalog = Catalog("c", "0.9")

        with pytest.raises(A2uiCatalogError, match="need v1.0 or later"):
            catalog.copy_with(agent_functions=[_fetch_fx_rate()])

    def test_rejects_an_agent_function_with_an_invalid_identifier(self):
        with pytest.raises(A2uiCatalogError, match="Invalid UAX #31"):
            _basic_catalog().copy_with(
                agent_functions=[_fetch_fx_rate("fetch-fx-rate")]
            )

    def test_empty_agent_functions_restore_declarations(self):
        catalog = _declaring_catalog()
        declaration = catalog.functions["verifyProvider"]
        with_agent = catalog.copy_with(
            agent_functions=[
                AgentFunction.from_api(declaration, _handler),
                _fetch_fx_rate(),
            ]
        )

        copy = with_agent.copy_with(agent_functions=[])

        assert copy.agent_functions == {}
        assert copy.functions["verifyProvider"] is declaration
        assert _function_names(copy) == _function_names(catalog)

    def test_rejects_an_agent_function_named_like_a_loaded_function(self):
        catalog = _basic_catalog()

        with pytest.raises(A2uiCatalogError, match="already declares a function"):
            catalog.copy_with(agent_functions=[_fetch_fx_rate("formatString")])

    def test_pruning_functions_drops_their_agent_entries(self):
        catalog = _basic_catalog().copy_with(
            agent_functions=[_fetch_fx_rate(), _fetch_fx_rate("quote")]
        )

        pruned = catalog.copy_with(
            functions=[fn for fn in catalog.functions.values() if fn.name != "quote"]
        )

        assert list(pruned.agent_functions) == ["fetchFxRate"]


class TestDerive:

    def test_keeps_agent_functions(self):
        catalog = _basic_catalog().copy_with(agent_functions=[_fetch_fx_rate()])

        derived = catalog.derive(catalog_id="derived")

        assert derived.agent_functions == catalog.agent_functions

    def test_picks_agent_functions_by_name(self):
        catalog = _basic_catalog().copy_with(
            agent_functions=[_fetch_fx_rate(), _fetch_fx_rate("quote")]
        )

        derived = catalog.derive(catalog_id="derived", functions=["fetchFxRate"])

        assert list(derived.functions) == ["fetchFxRate"]
        assert list(derived.agent_functions) == ["fetchFxRate"]


class TestValidation:

    @pytest.fixture
    def validator(self) -> PayloadValidator:
        catalog = _basic_catalog().copy_with(agent_functions=[_fetch_fx_rate()])
        return PayloadValidator(catalog, config=STRICT_VALIDATION)

    def test_accepts_a_call_to_an_agent_function_and_applies_defaults(
        self, validator: PayloadValidator
    ):
        assert validator.validate_function("fetchFxRate", {"base": "EUR"}) == {
            "base": "EUR",
            "target": "USD",
        }

    @pytest.mark.parametrize("args", [{}, {"base": 1}, {"base": "EUR", "x": 1}])
    def test_checks_the_arguments_of_an_agent_function(
        self, validator: PayloadValidator, args: dict[str, Any]
    ):
        with pytest.raises(A2uiValidationError):
            validator.validate_function("fetchFxRate", args)

    def test_accepts_a_component_bound_to_an_agent_function(
        self, validator: PayloadValidator
    ):
        validator.validate_component({
            "id": "rate",
            "component": "Text",
            "text": {"@call": "fetchFxRate", "args": {"base": "EUR"}},
        })

    def test_still_rejects_an_undeclared_function(self, validator: PayloadValidator):
        with pytest.raises(A2uiValidationError):
            validator.validate_function("notDeclared", {})

    def test_catalog_without_the_agent_function_rejects_the_call(self):
        validator = PayloadValidator(_basic_catalog(), config=STRICT_VALIDATION)

        with pytest.raises(A2uiValidationError):
            validator.validate_function("fetchFxRate", {"base": "EUR"})
