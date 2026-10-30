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

import pytest

from a2ui.core.basic_catalog.v1_0 import BasicCatalog as BasicCatalogV1_0
from a2ui.core.catalog import (
    AgentFunction,
    AgentFunctionContext,
    Catalog,
    CatalogApi,
    FunctionApi,
)
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

    def test_from_api_keeps_the_declaration(self):
        declaration = FunctionApi(
            "consultOracle",
            return_type="string",
            schema=FX_RATE_SCHEMA,
            allowed_callers="rendererOrAgent",
            requires_user_activation=True,
            description="Asks the oracle.",
        )

        fn = AgentFunction.from_api(declaration, _handler)

        assert fn.declaration is declaration
        assert fn.name == "consultOracle"
        assert fn.return_type == "string"
        assert fn.schema is declaration.schema
        assert fn.allowed_callers == "rendererOrAgent"
        assert fn.requires_user_activation is True
        assert fn.description == "Asks the oracle."
        assert fn.is_definition == declaration.is_definition
        assert fn.from_document == declaration.from_document

    def test_from_api_rejects_an_agent_function(self):
        with pytest.raises(TypeError, match="already an agent function"):
            AgentFunction.from_api(_fetch_fx_rate(), _handler)


class TestCatalogAgentFunctions:

    def test_constructor_adds_agent_functions_to_functions(self):
        fx = _fetch_fx_rate()

        catalog = Catalog("c", "1.0", agent_functions=[fx])

        assert catalog.functions == {"fetchFxRate": fx}
        assert catalog.agent_functions == {"fetchFxRate": fx}

    def test_agent_functions_lists_only_agent_functions(self):
        local = FunctionApi("formatRate", schema=FX_RATE_SCHEMA)
        fx = _fetch_fx_rate()

        catalog = Catalog("c", "1.0", functions=[local], agent_functions=[fx])

        assert _function_names(catalog) == ["formatRate", "fetchFxRate"]
        assert catalog.agent_functions == {"fetchFxRate": fx}

    def test_agent_function_passed_in_functions_is_an_agent_function(self):
        fx = _fetch_fx_rate()

        catalog = Catalog("c", "1.0", functions=[fx])

        assert catalog.agent_functions == {"fetchFxRate": fx}

    def test_rejects_an_agent_function_named_like_another_function(self):
        local = FunctionApi("fetchFxRate", schema=FX_RATE_SCHEMA)

        with pytest.raises(A2uiCatalogError, match="already has a function named"):
            Catalog("c", "1.0", functions=[local], agent_functions=[_fetch_fx_rate()])

    def test_rejects_two_agent_functions_with_one_name(self):
        with pytest.raises(A2uiCatalogError, match="already has a function named"):
            Catalog("c", "1.0", agent_functions=[_fetch_fx_rate(), _fetch_fx_rate()])

    def test_rejects_a_function_list_mixing_an_agent_function_and_its_name(self):
        local = FunctionApi("fetchFxRate", schema=FX_RATE_SCHEMA)

        with pytest.raises(A2uiCatalogError, match="already has a function named"):
            Catalog("c", "1.0", functions=[_fetch_fx_rate(), local])

    def test_rejects_an_entry_that_is_not_an_agent_function(self):
        local = FunctionApi("fetchFxRate", schema=FX_RATE_SCHEMA)

        with pytest.raises(A2uiCatalogError, match="not an `AgentFunction`"):
            Catalog("c", "1.0", agent_functions=[local])  # type: ignore[list-item]

    def test_rejects_agent_functions_before_v1_0(self):
        with pytest.raises(A2uiCatalogError, match="need v1.0 or later"):
            Catalog("c", "0.9", agent_functions=[_fetch_fx_rate()])

    def test_rejects_an_agent_function_with_an_invalid_identifier(self):
        with pytest.raises(A2uiCatalogError, match="Invalid UAX #31"):
            Catalog("c", "1.0", agent_functions=[_fetch_fx_rate("fetch-fx-rate")])

    def test_from_api_entry_replaces_the_declaration_in_place(self):
        declaration = FunctionApi("fetchFxRate", schema=FX_RATE_SCHEMA)
        local = FunctionApi("formatRate", schema=FX_RATE_SCHEMA)
        fx = AgentFunction.from_api(declaration, _handler)

        catalog = Catalog(
            "c", "1.0", functions=[declaration, local], agent_functions=[fx]
        )

        assert _function_names(catalog) == ["fetchFxRate", "formatRate"]
        assert catalog.functions["fetchFxRate"] is fx
        assert catalog.agent_functions == {"fetchFxRate": fx}

    def test_from_api_entry_of_another_entry_is_rejected(self):
        declaration = FunctionApi("fetchFxRate", schema=FX_RATE_SCHEMA)
        same_name = FunctionApi("fetchFxRate", schema=FX_RATE_SCHEMA)

        with pytest.raises(A2uiCatalogError, match="already has a function named"):
            Catalog(
                "c",
                "1.0",
                functions=[same_name],
                agent_functions=[AgentFunction.from_api(declaration, _handler)],
            )


class TestCatalogDocument:

    def test_writes_an_agent_function_like_a_declared_function(self):
        with_agent = Catalog("c", "1.0", agent_functions=[_fetch_fx_rate()])
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
        catalog = _basic_catalog()
        declaration = catalog.functions["formatString"]

        replaced = catalog.copy_with(
            agent_functions=[AgentFunction.from_api(declaration, _handler)]
        )

        assert replaced.to_json() == catalog.to_json()
        assert list(replaced.agent_functions) == ["formatString"]


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

    def test_empty_agent_functions_restore_declarations(self):
        catalog = _basic_catalog()
        declaration = catalog.functions["formatString"]
        with_agent = catalog.copy_with(
            agent_functions=[
                AgentFunction.from_api(declaration, _handler),
                _fetch_fx_rate(),
            ]
        )

        copy = with_agent.copy_with(agent_functions=[])

        assert copy.agent_functions == {}
        assert copy.functions["formatString"] is declaration
        assert _function_names(copy) == _function_names(catalog)

    def test_rejects_an_agent_function_named_like_a_loaded_function(self):
        catalog = _basic_catalog()

        with pytest.raises(A2uiCatalogError, match="formatString"):
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
