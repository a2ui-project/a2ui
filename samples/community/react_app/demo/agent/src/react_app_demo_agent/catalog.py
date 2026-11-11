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
                    " order. Answers in about 100 ms."
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
                    "Agent function. The 2025 orders of a region between two"
                    " dates, oldest first, at most 500. Each order is {id, date,"
                    " region, customer, product, amount}."
                ),
            ),
        ],
    )
