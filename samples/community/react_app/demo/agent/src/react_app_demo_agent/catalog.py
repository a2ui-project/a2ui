# Copyright 2026 Google LLC
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

"""The demo catalog: the agent functions that ReactApps call."""

from __future__ import annotations

import asyncio
from typing import Any

from a2ui.core import AgentFunction, Catalog, CatalogApi

from . import mock_data

DEMO_CATALOG_ID = "https://a2ui.org/labs/react_app/demo/v1/catalog.json"
"""The catalog ID; the client declares the same functions under it."""

# Agent functions answer after a short delay, so the loading state is visible.
_FUNCTION_DELAY_SECONDS = 0.12


async def _estimate_travel_time(args: dict[str, Any]) -> int:
    await asyncio.sleep(_FUNCTION_DELAY_SECONDS)
    return mock_data.estimate_travel_time(args.get("stops") or [])


async def _query_sales(args: dict[str, Any]) -> list[dict[str, Any]]:
    await asyncio.sleep(_FUNCTION_DELAY_SECONDS)
    return mock_data.query_sales(args.get("region"), args.get("from"), args.get("to"))


async def _query_companies(args: dict[str, Any]) -> list[dict[str, Any]]:
    await asyncio.sleep(_FUNCTION_DELAY_SECONDS)
    return mock_data.query_companies(
        region=args.get("region"),
        sort_by=str(args.get("sortBy") or "totalSpend"),
        sort_order=str(args.get("sortOrder") or "desc"),
        limit=int(args.get("limit") or 50),
    )


async def _get_company_details(args: dict[str, Any]) -> dict[str, Any] | None:
    await asyncio.sleep(_FUNCTION_DELAY_SECONDS)
    return mock_data.get_company_details(str(args.get("company") or ""))


async def _get_order_details(args: dict[str, Any]) -> dict[str, Any] | None:
    await asyncio.sleep(_FUNCTION_DELAY_SECONDS)
    return mock_data.get_order_details(str(args.get("orderId") or ""))


def demo_catalog() -> CatalogApi:
    """Returns the catalog that declares and runs the demo's agent functions."""
    regions = ", ".join(f"'{r}'" for r in mock_data.SALES_REGIONS)
    return Catalog(
        DEMO_CATALOG_ID,
        "1.0",
        components=[],
        functions=[
            AgentFunction(
                "estimateTravelTime",
                handler=_estimate_travel_time,
                return_type="number",
                schema={
                    "type": "object",
                    "properties": {
                        "stops": {
                            "type": "array",
                            "description": (
                                "The stops in visiting order: names, or objects"
                                " with a `name`."
                            ),
                        }
                    },
                    "required": ["stops"],
                },
                description=(
                    "Agent function. Total travel minutes between the stops, in"
                    " order. Answers in about 120 ms."
                ),
            ),
            AgentFunction(
                "querySales",
                handler=_query_sales,
                return_type="array",
                schema={
                    "type": "object",
                    "properties": {
                        "region": {
                            "type": "string",
                            "description": f"One of {regions}, or 'All'.",
                        },
                        "from": {
                            "type": "string",
                            "description": "First day, ISO date such as 2025-03-01.",
                        },
                        "to": {
                            "type": "string",
                            "description": "Last day, ISO date such as 2025-05-31.",
                        },
                    },
                    "required": ["region", "from", "to"],
                },
                description=(
                    "Agent function. The 2025 orders of a region between two dates,"
                    " oldest first, at most 1000 (a whole year of every region fits)."
                    " An unknown region has none. Each order is {id, date, region,"
                    " customer, product, amount}."
                ),
            ),
            AgentFunction(
                "queryCompanies",
                handler=_query_companies,
                return_type="array",
                schema={
                    "type": "object",
                    "properties": {
                        "region": {
                            "type": "string",
                            "description": f"Filter by region: {regions}, or 'All'.",
                        },
                        "sortBy": {
                            "type": "string",
                            "description": "Sort key: 'totalSpend', 'orderCount', 'latestOrderDate', 'name'.",
                        },
                        "sortOrder": {
                            "type": "string",
                            "description": "'desc' or 'asc'.",
                        },
                        "limit": {
                            "type": "number",
                            "description": "Maximum companies to return (default 50).",
                        },
                    },
                },
                description=(
                    "Agent function. Returns aggregated company accounts: {name, region,"
                    " industry, headquarters, tier, orderCount, totalSpend, latestOrderDate, topProduct}."
                ),
            ),
            AgentFunction(
                "getCompanyDetails",
                handler=_get_company_details,
                return_type="object",
                schema={
                    "type": "object",
                    "properties": {
                        "company": {
                            "type": "string",
                            "description": "The exact or partial company name.",
                        },
                    },
                    "required": ["company"],
                },
                description=(
                    "Agent function. Full profile and recent orders for a company: {name,"
                    " region, industry, headquarters, tier, orderCount, totalSpend, latestOrderDate, orders}."
                ),
            ),
            AgentFunction(
                "getOrderDetails",
                handler=_get_order_details,
                return_type="object",
                schema={
                    "type": "object",
                    "properties": {
                        "orderId": {
                            "type": "string",
                            "description": "The order ID such as 'NO-0412'.",
                        },
                    },
                    "required": ["orderId"],
                },
                description=(
                    "Agent function. Detailed line item breakdown, tracking number and shipping info for an order: "
                    "{id, date, customer, region, product, amount, quantity, unitPrice, status, shippingAddress, trackingNumber}."
                ),
            ),
        ],
    )
