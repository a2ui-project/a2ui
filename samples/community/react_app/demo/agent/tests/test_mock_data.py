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

"""Tests for the mock data behind the agent functions."""

from __future__ import annotations

from react_app_demo_agent import mock_data


def test_travel_time_depends_on_the_order() -> None:
    stops = ["Louvre", "Montmartre", "Eiffel Tower", "Notre-Dame"]
    reordered = ["Louvre", "Notre-Dame", "Montmartre", "Eiffel Tower"]

    minutes = mock_data.estimate_travel_time(stops)

    assert minutes > 0
    assert minutes != mock_data.estimate_travel_time(reordered)
    assert minutes == mock_data.estimate_travel_time([{"name": s} for s in stops])


def test_travel_time_is_zero_for_fewer_than_two_stops() -> None:
    assert mock_data.estimate_travel_time([]) == 0
    assert mock_data.estimate_travel_time(["Louvre"]) == 0


def test_query_sales_filters_by_region_and_dates() -> None:
    rows = mock_data.query_sales("emea", "2025-03-01", "2025-05-31")

    assert rows
    assert {row["region"] for row in rows} == {"EMEA"}
    assert all("2025-03-01" <= row["date"] <= "2025-05-31" for row in rows)
    assert rows == sorted(rows, key=lambda row: (row["date"], row["id"]))
    assert rows == mock_data.query_sales("EMEA", "2025-03-01", "2025-05-31")


def test_query_sales_accepts_months_and_all_regions() -> None:
    rows = mock_data.query_sales("All", "2025-02", "2025-02")

    assert {row["region"] for row in rows} == set(mock_data.SALES_REGIONS)
    assert all(row["date"].startswith("2025-02") for row in rows)


def test_query_sales_covers_the_whole_year_for_every_region() -> None:
    rows = mock_data.query_sales("All", "2025-01-01", "2025-12-31")

    assert len(rows) <= mock_data.MAX_SALES_ROWS
    assert {row["date"][:7] for row in rows} == {f"2025-{m:02d}" for m in range(1, 13)}
    assert {row["region"] for row in rows} == set(mock_data.SALES_REGIONS)


def test_query_sales_accepts_list_from_choice_picker() -> None:
    # A2UI ChoicePicker stores value as an array of strings e.g. ["North America"] or ["All"].
    rows = mock_data.query_sales(["North America"], "2025-01-01", "2025-12-31")
    assert rows
    assert {row["region"] for row in rows} == {"North America"}
    assert rows == mock_data.query_sales("North America", "2025-01-01", "2025-12-31")


def test_query_sales_has_no_orders_for_an_unknown_region() -> None:
    assert mock_data.query_sales("Mars", "2025-01-01", "2025-12-31") == []
