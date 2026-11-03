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

"""The agent functions the test agent serves to a v1.0 renderer.

A renderer calls them with `callAgentFunction`. `lookupPrice(sku)` answers
after a delay, so a test can observe the pending state of a value bound to
it. `failingLookup()` always raises, so a test can observe how a renderer
settles a binding or halts an action when the agent's function fails.
"""

from __future__ import annotations

import asyncio
from typing import Any

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.catalog import AgentFunction, AgentFunctionContext, CatalogApi
from a2ui.core.schema import ProtocolVersion
from a2ui.rpc import AgentFunctionRegistry

__all__ = [
    "FAILING_LOOKUP",
    "LOOKUP_PRICE",
    "PRICES",
    "build_catalog",
    "build_registry",
]

LOOKUP_PRICE = "lookupPrice"
FAILING_LOOKUP = "failingLookup"

PRICES: dict[str, str] = {
    "sku-100": "$10.00",
    "sku-250": "$25.00",
    "sku-999": "$999.00",
}
"""The prices `lookupPrice` knows. Any other SKU costs `DEFAULT_PRICE`."""

DEFAULT_PRICE = "$9.99"


def _lookup_price_function(rpc_delay_ms: int) -> AgentFunction:
    async def lookup_price(args: dict[str, Any], _context: AgentFunctionContext) -> str:
        if rpc_delay_ms > 0:
            await asyncio.sleep(rpc_delay_ms / 1000)
        return PRICES.get(str(args["sku"]).lower(), DEFAULT_PRICE)

    return AgentFunction(
        LOOKUP_PRICE,
        handler=lookup_price,
        return_type="string",
        schema={
            "type": "object",
            "properties": {"sku": {"type": "string"}},
            "required": ["sku"],
            "additionalProperties": False,
        },
        description="Returns the price of a product by its SKU.",
    )


def _failing_lookup_function() -> AgentFunction:
    def failing_lookup(_args: dict[str, Any], _context: AgentFunctionContext) -> str:
        raise RuntimeError(f"{FAILING_LOOKUP} always fails.")

    return AgentFunction(
        FAILING_LOOKUP,
        handler=failing_lookup,
        return_type="string",
        schema={"type": "object", "properties": {}, "additionalProperties": False},
        description="A lookup that always fails on the agent.",
    )


def build_catalog(
    version: ProtocolVersion | str, *, rpc_delay_ms: int = 0
) -> CatalogApi:
    """The basic catalog of `version`, with the test agent's functions on v1.0.

    Agent functions exist from v1.0, so earlier versions get the plain basic
    catalog. The v1.0 copy keeps the basic catalog's id and declares the
    functions as agent-implemented, so the renderer calls the agent for them.
    """
    catalog = BasicCatalog(version)
    if ProtocolVersion(catalog.protocol_version) is not ProtocolVersion.V1_0:
        return catalog
    return catalog.copy_with(
        agent_functions=[
            _lookup_price_function(rpc_delay_ms),
            _failing_lookup_function(),
        ]
    )


def build_registry(catalogs: list[CatalogApi]) -> AgentFunctionRegistry | None:
    """A registry for the agent functions of `catalogs`, or None when they have none."""
    if not any(catalog.agent_functions for catalog in catalogs):
        return None
    return AgentFunctionRegistry(catalogs)
