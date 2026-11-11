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

MAX_SALES_ROWS = 500
"""The most rows one `querySales` call returns."""

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


def _normalize_region(region: Any) -> str | None:
    """The canonical region name, or None for all regions."""
    if not isinstance(region, str) or region.strip().lower() in ("", "all", "*"):
        return None
    key = region.strip().lower()
    return _REGION_ALIASES.get(key, region.strip())


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
    """Orders of a region between two dates, both included, oldest first.

    Args:
        region: A region name or alias; empty or `All` for every region.
        start: The first day, as an ISO date, a `YYYY-MM` month or epoch ms.
        end: The last day, in the same forms.

    Returns:
        At most `MAX_SALES_ROWS` orders with `id`, `date`, `region`,
        `customer`, `product` and `amount`.
    """
    wanted = _normalize_region(region)
    regions = SALES_REGIONS if wanted is None else (wanted,)
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
