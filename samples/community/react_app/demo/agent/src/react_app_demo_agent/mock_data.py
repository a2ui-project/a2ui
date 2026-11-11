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

"""Deterministic mock data behind the demo's agent functions."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
import datetime as dt
import hashlib
import math
import random
from typing import Any

SALES_REGIONS = ("North America", "EMEA", "APAC", "LATAM")
"""The regions `querySales` knows, as the prompt lists them."""

MAX_SALES_ROWS = 1000
"""The most rows one `querySales` call returns; a whole year of every region fits."""

_SALES_YEAR = 2025

_REGION_ALIASES = {
    "na": "North America",
    "north america": "North America",
    "americas": "North America",
    "us": "North America",
    "emea": "EMEA",
    "europe": "EMEA",
    "apac": "APAC",
    "asia": "APAC",
    "asia pacific": "APAC",
    "latam": "LATAM",
    "latin america": "LATAM",
    "south america": "LATAM",
}

_CUSTOMERS = (
    "Atelier Nord",
    "Bramble & Co",
    "Cobalt Freight",
    "Dunmore Labs",
    "Elmwood Studio",
    "Fennel Foods",
    "Granite Health",
    "Harbor Lane",
    "Indigo Works",
    "Juniper Retail",
    "Kestrel Air",
    "Lumen Print",
    "Marlow Textiles",
    "Northwind",
    "Orchard Supply",
    "Pine & Pixel",
)

_PRODUCTS = ("Starter plan", "Team plan", "Enterprise plan", "Add-on seats", "Support")

# Approximate coordinates (latitude, longitude) of places a Paris trip names.
_PLACES = {
    "louvre": (48.8606, 2.3376),
    "montmartre": (48.8867, 2.3431),
    "sacre coeur": (48.8867, 2.3431),
    "eiffel": (48.8584, 2.2945),
    "notre dame": (48.8530, 2.3499),
    "notre-dame": (48.8530, 2.3499),
    "orsay": (48.8600, 2.3266),
    "arc de triomphe": (48.8738, 2.2950),
    "pantheon": (48.8462, 2.3464),
    "marais": (48.8590, 2.3622),
    "luxembourg": (48.8462, 2.3372),
    "sainte chapelle": (48.8554, 2.3450),
    "pompidou": (48.8606, 2.3522),
    "opera": (48.8720, 2.3316),
    "trocadero": (48.8616, 2.2893),
}
_PARIS_CENTER = (48.8566, 2.3522)
_MINUTES_PER_KM = 4.0  # Metro and walking, door to door.
_MINUTES_PER_HOP = 6.0  # Waiting, transfers, finding the entrance.


def _stop_name(stop: Any) -> str:
    """The name of a stop given as a string or as an object."""
    if isinstance(stop, Mapping):
        for key in ("name", "title", "label", "id"):
            value = stop.get(key)
            if isinstance(value, str) and value:
                return value
        return str(sorted(stop.items()))
    return str(stop)


def _coordinates(name: str) -> tuple[float, float]:
    """Coordinates of a named place: known landmarks, else a stable point near the center."""
    key = name.lower().replace("_", " ").replace("’", "'")
    for place, coordinates in _PLACES.items():
        if place in key:
            return coordinates
    digest = hashlib.sha256(key.encode()).digest()
    return (
        _PARIS_CENTER[0] + (digest[0] - 128) / 128 * 0.03,
        _PARIS_CENTER[1] + (digest[1] - 128) / 128 * 0.05,
    )


def _distance_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance in kilometers."""
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * 6371 * math.asin(math.sqrt(h))


def estimate_travel_time(stops: Sequence[Any]) -> int:
    """Total travel minutes between the stops, in order.

    Args:
        stops: Stop names, or objects with a `name`, `title`, `label` or `id`.

    Returns:
        Whole minutes, 0 for fewer than two stops.
    """
    points = [_coordinates(_stop_name(stop)) for stop in stops]
    minutes = sum(
        _distance_km(a, b) * _MINUTES_PER_KM + _MINUTES_PER_HOP
        for a, b in zip(points, points[1:])
    )
    return round(minutes)


_ALL_REGIONS = "*"


def _normalize_region(region: Any) -> str | None:
    """The canonical region name, `_ALL_REGIONS`, or None for an unknown region."""
    if isinstance(region, (list, tuple)):
        if not region:
            return _ALL_REGIONS
        region = region[0]
    if not isinstance(region, str) or region.strip().lower() in ("", "all", "*"):
        return _ALL_REGIONS
    key = region.strip().lower()
    known = {name.lower(): name for name in SALES_REGIONS}
    return _REGION_ALIASES.get(key) or known.get(key)


def _parse_date(value: Any, *, end: bool) -> dt.date | None:
    """Reads an ISO date, a `YYYY-MM` month or epoch milliseconds."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return dt.datetime.fromtimestamp(value / 1000, tz=dt.timezone.utc).date()
    if not isinstance(value, str) or not value:
        return None
    text = value.strip()[:10]
    try:
        if len(text) == 7:
            first = dt.date.fromisoformat(f"{text}-01")
            if not end:
                return first
            following = (first.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
            return following - dt.timedelta(days=1)
        return dt.date.fromisoformat(text)
    except ValueError:
        return None


def _orders(region: str) -> list[dict[str, Any]]:
    """The year's orders of one region, the same on every call."""
    rng = random.Random(f"{region}-{_SALES_YEAR}")
    base = {"North America": 9000, "EMEA": 7000, "APAC": 6000, "LATAM": 3500}.get(
        region, 4000
    )
    orders: list[dict[str, Any]] = []
    for month in range(1, 13):
        season = 1 + 0.25 * math.sin((month - 3) / 12 * 2 * math.pi)
        for index in range(rng.randint(14, 22)):
            day = rng.randint(1, 28)
            amount = round(base * season * rng.uniform(0.3, 1.9), -1)
            orders.append({
                "id": f"{region[:2].upper()}-{month:02d}{index:02d}",
                "date": dt.date(_SALES_YEAR, month, day).isoformat(),
                "region": region,
                "customer": rng.choice(_CUSTOMERS),
                "product": rng.choice(_PRODUCTS),
                "amount": amount,
            })
    return orders


def query_sales(region: Any, start: Any, end: Any) -> list[dict[str, Any]]:
    """Orders of a region between two dates, both included, oldest first."""
    wanted = _normalize_region(region)
    if wanted is None:
        return []
    regions = SALES_REGIONS if wanted == _ALL_REGIONS else (wanted,)
    first = _parse_date(start, end=False) or dt.date(_SALES_YEAR, 1, 1)
    last = _parse_date(end, end=True) or dt.date(_SALES_YEAR, 12, 31)
    if first > last:
        first, last = last, first
    rows = [
        order
        for name in regions
        for order in _orders(name)
        if first <= dt.date.fromisoformat(order["date"]) <= last
    ]
    rows.sort(key=lambda order: (order["date"], order["id"]))
    return rows[:MAX_SALES_ROWS]


_COMPANY_METADATA: dict[str, dict[str, str]] = {
    "Atelier Nord": {
        "industry": "Architecture & Design",
        "hq": "Oslo, Norway",
        "tier": "Enterprise",
        "region": "EMEA",
    },
    "Bramble & Co": {
        "industry": "Artisan Goods & Gifts",
        "hq": "London, UK",
        "tier": "Growth",
        "region": "EMEA",
    },
    "Cobalt Freight": {
        "industry": "Global Freight Logistics",
        "hq": "Rotterdam, Netherlands",
        "tier": "Enterprise",
        "region": "EMEA",
    },
    "Dunmore Labs": {
        "industry": "Biotechnology Research",
        "hq": "Boston, USA",
        "tier": "Enterprise",
        "region": "North America",
    },
    "Elmwood Studio": {
        "industry": "Creative Media & UX",
        "hq": "Toronto, Canada",
        "tier": "Standard",
        "region": "North America",
    },
    "Fennel Foods": {
        "industry": "Organic Food Supply",
        "hq": "Bologna, Italy",
        "tier": "Growth",
        "region": "EMEA",
    },
    "Granite Health": {
        "industry": "Medical Diagnostics",
        "hq": "Zurich, Switzerland",
        "tier": "Enterprise",
        "region": "EMEA",
    },
    "Harbor Lane": {
        "industry": "Maritime Supply & Marine",
        "hq": "Singapore",
        "tier": "Enterprise",
        "region": "APAC",
    },
    "Indigo Works": {
        "industry": "Robotics & Automation",
        "hq": "Tokyo, Japan",
        "tier": "Enterprise",
        "region": "APAC",
    },
    "Juniper Retail": {
        "industry": "Omnichannel Retail",
        "hq": "Austin, USA",
        "tier": "Enterprise",
        "region": "North America",
    },
    "Kestrel Air": {
        "industry": "Regional Aviation",
        "hq": "Sydney, Australia",
        "tier": "Growth",
        "region": "APAC",
    },
    "Lumen Print": {
        "industry": "Precision Publishing",
        "hq": "Munich, Germany",
        "tier": "Standard",
        "region": "EMEA",
    },
    "Marlow Textiles": {
        "industry": "Sustainable Fabrics",
        "hq": "Manchester, UK",
        "tier": "Growth",
        "region": "EMEA",
    },
    "Northwind": {
        "industry": "Wind & Renewable Energy",
        "hq": "Copenhagen, Denmark",
        "tier": "Enterprise",
        "region": "EMEA",
    },
    "Orchard Supply": {
        "industry": "AgriTech Equipment",
        "hq": "São Paulo, Brazil",
        "tier": "Growth",
        "region": "LATAM",
    },
    "Pine & Pixel": {
        "industry": "Video Game Development",
        "hq": "Stockholm, Sweden",
        "tier": "Standard",
        "region": "EMEA",
    },
}


def query_companies(
    region: Any = None,
    sort_by: str = "totalSpend",
    sort_order: str = "desc",
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Aggregated company accounts with total spend, order count and latest activity."""
    wanted_region = _normalize_region(region)
    all_orders = [order for r in SALES_REGIONS for order in _orders(r)]
    by_customer: dict[str, list[dict[str, Any]]] = {}
    for order in all_orders:
        by_customer.setdefault(order["customer"], []).append(order)

    companies: list[dict[str, Any]] = []
    for name, meta in _COMPANY_METADATA.items():
        comp_region = meta["region"]
        if (
            wanted_region is not None
            and wanted_region != _ALL_REGIONS
            and comp_region != wanted_region
        ):
            continue
        cust_orders = by_customer.get(name, [])
        total_spend = sum(o["amount"] for o in cust_orders)
        order_count = len(cust_orders)
        latest_date = max((o["date"] for o in cust_orders), default="2025-01-01")
        prod_counts: dict[str, int] = {}
        for o in cust_orders:
            prod_counts[o["product"]] = prod_counts.get(o["product"], 0) + 1
        top_prod = (
            max(prod_counts.items(), key=lambda kv: kv[1])[0]
            if prod_counts
            else "Enterprise plan"
        )
        companies.append({
            "name": name,
            "region": comp_region,
            "industry": meta["industry"],
            "headquarters": meta["hq"],
            "tier": meta["tier"],
            "orderCount": order_count,
            "totalSpend": total_spend,
            "latestOrderDate": latest_date,
            "topProduct": top_prod,
        })

    reverse = sort_order.lower() in ("desc", "descending")
    valid_sorts = (
        "totalSpend",
        "orderCount",
        "latestOrderDate",
        "name",
        "region",
        "industry",
    )
    field = sort_by if sort_by in valid_sorts else "totalSpend"
    companies.sort(key=lambda c: c[field], reverse=reverse)
    return companies[:limit]


def get_company_details(company: str) -> dict[str, Any] | None:
    """Returns company profile and full order history."""
    if not isinstance(company, str) or not company.strip():
        return None
    matched = None
    target = company.strip().lower()
    for name in _COMPANY_METADATA:
        if name.lower() == target or target in name.lower():
            matched = name
            break
    if not matched:
        return None
    meta = _COMPANY_METADATA[matched]
    all_orders = [
        dict(
            order,
            status="Delivered" if order["date"] < "2025-11-01" else "In Transit",
        )
        for r in SALES_REGIONS
        for order in _orders(r)
        if order["customer"] == matched
    ]
    all_orders.sort(key=lambda o: o["date"], reverse=True)
    total_spend = sum(o["amount"] for o in all_orders)
    return {
        "name": matched,
        "region": meta["region"],
        "industry": meta["industry"],
        "headquarters": meta["hq"],
        "tier": meta["tier"],
        "orderCount": len(all_orders),
        "totalSpend": total_spend,
        "latestOrderDate": all_orders[0]["date"] if all_orders else "2025-01-01",
        "orders": all_orders,
    }


def get_order_details(order_id: str) -> dict[str, Any] | None:
    """Returns detailed order line items and shipping tracking."""
    if not isinstance(order_id, str) or not order_id.strip():
        return None
    target = order_id.strip().upper()
    for r in SALES_REGIONS:
        for o in _orders(r):
            if o["id"].upper() == target:
                meta = _COMPANY_METADATA.get(
                    o["customer"], {"hq": "Metropolis", "industry": "General"}
                )
                status = "Delivered" if o["date"] < "2025-11-01" else "In Transit"
                qty = max(1, round(o["amount"] / 1200))
                unit_price = round(o["amount"] / qty, 2)
                digest = hashlib.sha256(o["id"].encode()).hexdigest()[:10].upper()
                return {
                    "id": o["id"],
                    "date": o["date"],
                    "customer": o["customer"],
                    "region": o["region"],
                    "product": o["product"],
                    "amount": o["amount"],
                    "quantity": qty,
                    "unitPrice": unit_price,
                    "status": status,
                    "shippingAddress": f"100 Enterprise Way, {meta['hq']}",
                    "trackingNumber": f"TRK-{digest}",
                }
    return None
