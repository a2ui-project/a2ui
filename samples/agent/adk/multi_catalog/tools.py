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

import json
import logging

logger = logging.getLogger(__name__)

# Fixed sample data, so the demo runs without a backend.
_SALES_METRICS = {
    "north america": {
        "region": "North America",
        "quarter": "Q3 2026",
        "revenue": "$4.2M",
        "revenueChange": "+12% vs Q2",
        "newCustomers": "1,284",
        "customersChange": "+8% vs Q2",
        "averageDeal": "$3,270",
        "dealChange": "-2% vs Q2",
        "targetPercent": 84,
        "pipelinePercent": 61,
        "highlights": (
            "Enterprise renewals drove most of the growth. Two large deals moved to Q4."
        ),
    },
    "europe": {
        "region": "Europe",
        "quarter": "Q3 2026",
        "revenue": "$2.9M",
        "revenueChange": "+5% vs Q2",
        "newCustomers": "932",
        "customersChange": "+11% vs Q2",
        "averageDeal": "$3,110",
        "dealChange": "-6% vs Q2",
        "targetPercent": 72,
        "pipelinePercent": 55,
        "highlights": (
            "Self-serve sign-ups grew fastest in Germany. The August holidays slowed"
            " enterprise deals."
        ),
    },
    "asia pacific": {
        "region": "Asia Pacific",
        "quarter": "Q3 2026",
        "revenue": "$1.8M",
        "revenueChange": "+21% vs Q2",
        "newCustomers": "701",
        "customersChange": "+17% vs Q2",
        "averageDeal": "$2,570",
        "dealChange": "+3% vs Q2",
        "targetPercent": 93,
        "pipelinePercent": 70,
        "highlights": (
            "The new Singapore office closed its first ten accounts. Japan is ahead"
            " of plan."
        ),
    },
}

_REGION_ALIASES = {
    "na": "north america",
    "us": "north america",
    "usa": "north america",
    "eu": "europe",
    "emea": "europe",
    "apac": "asia pacific",
    "asia": "asia pacific",
}


def get_sales_metrics(region: str) -> str:
    """Returns the latest quarterly sales metrics of a region.

    Args:
        region: The sales region, one of "North America", "Europe" or "Asia
            Pacific". Common abbreviations such as "NA", "EMEA" and "APAC" work
            too.

    Returns:
        A JSON object with the metrics, or with an `error` and the known
        regions if the region is unknown.
    """
    logger.info(f"--- TOOL CALLED: get_sales_metrics (region: {region}) ---")
    key = region.strip().lower()
    key = _REGION_ALIASES.get(key, key)
    metrics = _SALES_METRICS.get(key)
    if metrics is None:
        return json.dumps({
            "error": f"Unknown region: {region}",
            "knownRegions": [m["region"] for m in _SALES_METRICS.values()],
        })
    return json.dumps(metrics)
