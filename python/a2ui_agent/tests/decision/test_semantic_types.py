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

"""Unit tests for semantic pointer classification and payload inspection."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import pytest

from a2ui.inference_formats.decision.models import SemanticType
from a2ui.inference_formats.decision.payload_inspector import (
    inspect_payload_pointers,
)
from a2ui.inference_formats.decision.semantic_types import (
    classify_array_field,
    classify_scalar,
    humanize_key,
    prose_length_level,
)

from .layout_fixtures import HOST, RESORT, SETTINGS, TRANSFER

POSITIVE_CASES: tuple[tuple[SemanticType, Any, str, Mapping[str, Any] | None], ...] = (
    # Text (7)
    (SemanticType.STRING, "prod-1", "host", None),
    (SemanticType.STRING, "Alex Chen", "recipient", None),
    (
        SemanticType.LONG_TEXT,
        "Open-air pavilions with a saltwater infinity pool above the coast.",
        "about",
        None,
    ),
    (
        SemanticType.LONG_TEXT,
        " ".join(["sentence"] * 18),
        "plainField",
        None,
    ),
    (SemanticType.MARKDOWN, "# Welcome\n\nRead **more** here.", "note", None),
    (SemanticType.MARKDOWN, "Plain body with markdown key", "markdown", None),
    (SemanticType.CODE, "SELECT id, email FROM users WHERE active = 1", "text", None),
    (SemanticType.CODE, "total * 0.15", "formula", None),
    (SemanticType.NAME, "Casa Verde", "name", None),
    (SemanticType.NAME, "Elena Mora", "author", None),
    (SemanticType.TITLE, "Quarterly Report", "title", None),
    (SemanticType.TITLE, "System Health", "headline", None),
    (
        SemanticType.IDENTIFIER,
        "550e8400-e29b-41d4-a716-446655440000",
        "record",
        None,
    ),
    (SemanticType.IDENTIFIER, "ord_98765", "orderId", None),
    # Contact & links (7)
    (SemanticType.EMAIL, "alex@example.com", "contact", None),
    (SemanticType.EMAIL, "mailto:help@example.org", "support", None),
    (SemanticType.PHONE, "+1 (415) 555-0199", "contact", None),
    (SemanticType.PHONE, "415-555-0123", "phone", None),
    (SemanticType.URL, "https://example.com/docs", "website", None),
    (SemanticType.URL, "/settings/security", "href", None),
    (
        SemanticType.IMAGE_URL,
        "https://example.com/casa-verde/logo.png",
        "logoUrl",
        None,
    ),
    (
        SemanticType.IMAGE_URL,
        "https://cdn.example.com/u/42",
        "avatarUrl",
        None,
    ),
    (SemanticType.VIDEO_URL, "https://example.com/clip.mp4", "media", None),
    (
        SemanticType.VIDEO_URL,
        "https://cdn.example.com/watch/99",
        "trailerUrl",
        None,
    ),
    (SemanticType.AUDIO_URL, "https://example.com/track.mp3", "media", None),
    (
        SemanticType.AUDIO_URL,
        "https://cdn.example.com/listen/7",
        "podcastAudio",
        None,
    ),
    (
        SemanticType.DOCUMENT_URL,
        "https://example.com/statement.pdf",
        "file",
        None,
    ),
    (
        SemanticType.DOCUMENT_URL,
        "https://cdn.example.com/dl/10",
        "invoiceDocument",
        None,
    ),
    # Time (6)
    (SemanticType.DATE, "2026-10-24", "arrives", None),
    (SemanticType.DATE, "Oct 24, 2026", "published", None),
    (SemanticType.TIME, "14:30", "slot", None),
    (SemanticType.TIME, "9:15 AM", "startTime", None),
    (SemanticType.DATETIME, "2026-10-24T14:30:00Z", "createdAt", None),
    (SemanticType.DATETIME, "2026-10-24 09:15:00+02:00", "updatedAt", None),
    (SemanticType.DURATION, 30, "skipForward", None),
    (SemanticType.DURATION, "PT45M", "elapsed", None),
    (SemanticType.RELATIVE_TIME, "3 hours ago", "seen", None),
    (SemanticType.RELATIVE_TIME, "in 5 days", "renews", None),
    (SemanticType.DATE_RANGE, "2026-10-24..2026-10-27", "window", None),
    (SemanticType.DATE_RANGE, "Oct 24 - Oct 27, 2026", "stayDates", None),
    # Quantity (9)
    (SemanticType.NUMBER, 0.78, "cpu", None),
    (SemanticType.NUMBER, 1.25, "speed", None),
    (SemanticType.INTEGER, 412, "uptimeHours", None),
    (SemanticType.INTEGER, 16, "cores", None),
    (SemanticType.COUNT, 12, "guestCount", None),
    (SemanticType.COUNT, 4, "seats", None),
    (SemanticType.CURRENCY, 240, "priceFrom", None),
    (SemanticType.CURRENCY, "$1,250.00", "value", None),
    (SemanticType.PERCENT, 12.5, "taxRate", None),
    (SemanticType.PERCENT, "78%", "utilization", None),
    (SemanticType.RATIO, 0.85, "confidence", None),
    (SemanticType.RATIO, "3/4", "progressText", None),
    (SemanticType.QUANTITY, "24.2 kWh", "energy", None),
    (SemanticType.QUANTITY, 70, "weightKg", None),
    (SemanticType.RATING, 4.6, "rating", None),
    (SemanticType.RATING, "4.8/5", "review", None),
    (
        SemanticType.BOUNDED,
        65,
        "level",
        {"level": 65, "min": 0, "max": 100},
    ),
    (SemanticType.BOUNDED, 80, "battery", None),
    # State (4)
    (SemanticType.ENUM, "USD", "currency", None),
    (SemanticType.ENUM, "enterprise", "tier", None),
    (SemanticType.STATUS, "degraded", "status", None),
    (SemanticType.STATUS, "healthy", "clusterState", None),
    (SemanticType.BOOLEAN, True, "autoDownload", None),
    (SemanticType.BOOLEAN, False, "healthy", None),
    (SemanticType.COLOR, "#ff5733", "swatch", None),
    (SemanticType.COLOR, "rgb(12, 34, 56)", "fill", None),
    # Structure (3)
    (SemanticType.ARRAY, ["Send", "Cancel"], "actions", None),
    (SemanticType.ARRAY, [{"url": "https://example.com/1.png"}], "photos", None),
    (SemanticType.OBJECT, {"speed": 1.25}, "playback", None),
    (SemanticType.OBJECT, {"plan": "Family"}, "account", None),
    (SemanticType.EMPTY, None, "missing", None),
    (SemanticType.EMPTY, "   ", "blank", None),
)

NEGATIVE_CASES: tuple[tuple[SemanticType, Any, str, Mapping[str, Any] | None], ...] = (
    (SemanticType.STRING, 42, "host", None),
    (SemanticType.LONG_TEXT, "Short", "label", None),
    (SemanticType.MARKDOWN, "Just a normal label", "label", None),
    (SemanticType.CODE, "Casa Verde", "name", None),
    (SemanticType.NAME, "Alex Chen", "recipient", None),
    (SemanticType.TITLE, "Main pool", "caption", None),
    (SemanticType.IDENTIFIER, "prod-1", "host", None),
    (SemanticType.EMAIL, "not-an-email", "label", None),
    (SemanticType.PHONE, "2026-10-24", "arrives", None),
    (SemanticType.URL, "Casa Verde", "name", None),
    (SemanticType.IMAGE_URL, "https://example.com/docs", "website", None),
    (SemanticType.VIDEO_URL, "https://example.com/logo.png", "logoUrl", None),
    (SemanticType.AUDIO_URL, "https://example.com/clip.mp4", "videoUrl", None),
    (SemanticType.DOCUMENT_URL, "https://example.com/song.mp3", "audioUrl", None),
    (SemanticType.DATE, "14:30", "time", None),
    (SemanticType.TIME, "2026-10-24", "date", None),
    (SemanticType.DATETIME, "2026-10-24", "date", None),
    (SemanticType.DURATION, 412, "uptimeHours", None),
    (SemanticType.RELATIVE_TIME, "30 seconds", "duration", None),
    (SemanticType.DATE_RANGE, "2026-10-24", "arrives", None),
    (SemanticType.NUMBER, 16, "cores", None),
    (SemanticType.INTEGER, 0.78, "cpu", None),
    (SemanticType.COUNT, 240, "priceFrom", None),
    (SemanticType.CURRENCY, 16, "cores", None),
    (SemanticType.PERCENT, 0.78, "cpu", None),
    (SemanticType.RATIO, "2026/10/24", "date", None),
    (SemanticType.QUANTITY, 50, "amount", {"amount": 50, "currency": "USD"}),
    (SemanticType.RATING, 100, "price", None),
    (
        SemanticType.BOUNDED,
        100,
        "max",
        {"level": 65, "min": 0, "max": 100},
    ),
    (SemanticType.ENUM, "degraded", "status", None),
    (SemanticType.STATUS, "Casa Verde", "name", None),
    (SemanticType.BOOLEAN, "true", "label", None),
    (SemanticType.COLOR, "#notacolor", "label", None),
    (SemanticType.ARRAY, [], "emptyList", None),
    (SemanticType.OBJECT, {}, "emptyObj", None),
    (SemanticType.EMPTY, 0, "zeroCount", None),
)


class TestSemanticTypesCoverage:
    """Verifies coverage across all 36 `SemanticType` values."""

    def test_every_semantic_type_has_at_least_two_positive_and_one_negative_case(
        self,
    ) -> None:
        pos_counts: dict[SemanticType, int] = {}
        for sem_type, _, _, _ in POSITIVE_CASES:
            pos_counts[sem_type] = pos_counts.get(sem_type, 0) + 1

        neg_types = {sem_type for sem_type, _, _, _ in NEGATIVE_CASES}
        assert set(pos_counts) == set(SemanticType)
        for member in SemanticType:
            assert pos_counts[member] >= 2, f"fewer than 2 positive cases for {member}"
            assert member in neg_types, f"missing negative case for {member}"

    @pytest.mark.parametrize(("expected", "value", "key", "siblings"), POSITIVE_CASES)
    def test_positive_cases(
        self,
        expected: SemanticType,
        value: Any,
        key: str,
        siblings: Mapping[str, Any] | None,
    ) -> None:
        actual, _ = classify_scalar(value, key, siblings=siblings)
        assert actual == expected

    @pytest.mark.parametrize(("unexpected", "value", "key", "siblings"), NEGATIVE_CASES)
    def test_negative_cases(
        self,
        unexpected: SemanticType,
        value: Any,
        key: str,
        siblings: Mapping[str, Any] | None,
    ) -> None:
        actual, _ = classify_scalar(value, key, siblings=siblings)
        assert actual != unexpected


class TestDetectorPrecedenceAndHints:
    """Tests key-hint precedence, sibling hints, prose length levels, and arrays."""

    def test_key_hint_precedes_coarse_numeric_and_url_types(self) -> None:
        assert classify_scalar(240, "priceFrom") == (
            SemanticType.CURRENCY,
            {"keyHint": "price"},
        )
        assert classify_scalar(30, "skipForward") == (
            SemanticType.DURATION,
            {"unit": "seconds", "keyHint": "skip_forward"},
        )
        assert classify_scalar(12, "latencyMs") == (
            SemanticType.DURATION,
            {"unit": "ms", "keyHint": "ms"},
        )
        assert classify_scalar(
            "https://example.com/casa-verde/logo.png", "logoUrl"
        ) == (
            SemanticType.IMAGE_URL,
            {"keyHint": "logo"},
        )

    def test_sibling_currency_and_unit_and_bounded_hints(self) -> None:
        siblings = {"amount": 50, "fee": 0.5, "currency": "USD"}
        assert classify_scalar(50, "amount", siblings=siblings) == (
            SemanticType.CURRENCY,
            {"keyHint": "amount", "currency": "USD"},
        )

        unit_siblings = {"temperature": 21.5, "unit": "°C"}
        assert classify_scalar(21.5, "temperature", siblings=unit_siblings) == (
            SemanticType.QUANTITY,
            {"unit": "°C"},
        )

        bounded_siblings = {"used": 42, "min": 0, "max": 100}
        assert classify_scalar(42, "used", siblings=bounded_siblings) == (
            SemanticType.BOUNDED,
            {"min": 0, "max": 100},
        )
        assert classify_scalar(100, "max", siblings=bounded_siblings) == (
            SemanticType.INTEGER,
            {},
        )

    @pytest.mark.parametrize(
        ("word_count", "expected_level"),
        [
            (5, "line"),
            (14, "line"),
            (15, "blurb"),
            (33, "blurb"),
            (59, "blurb"),
            (60, "summary"),
            (199, "summary"),
            (200, "article"),
            (350, "article"),
        ],
    )
    def test_prose_length_levels_and_long_text_hints(
        self, word_count: int, expected_level: str
    ) -> None:
        assert prose_length_level(word_count) == expected_level
        text = " ".join(["word"] * word_count)
        sem_type, hints = classify_scalar(text, "about")
        assert sem_type == SemanticType.LONG_TEXT
        assert hints["wordCount"] == word_count
        assert hints["length"] == expected_level
        assert hints["keyHint"] == "about"

    def test_classify_array_field_enum_status_and_mixed_numbers(self) -> None:
        assert (
            classify_array_field(["active", "pending", "failed", "active"])
            == SemanticType.STATUS
        )
        assert (
            classify_array_field(
                ["basic", "pro", "basic", "enterprise", "basic", "pro"]
            )
            == SemanticType.ENUM
        )
        assert (
            classify_array_field(["Alice", "Bob", "Carol", "Dave"])
            == SemanticType.STRING
        )
        assert classify_array_field([1, 2.5, 3], "values") == SemanticType.NUMBER
        assert classify_array_field([None, "", "  "], "notes") == SemanticType.EMPTY

    @pytest.mark.parametrize(
        ("raw_key", "expected_label"),
        [
            ("priceFrom", "Price from"),
            ("skip_forward", "Skip forward"),
            ("uptimeHours", "Uptime hours"),
            ("newEpisodes", "New episodes"),
            ("URLPath", "Url path"),
            ("", ""),
        ],
    )
    def test_humanize_key(self, raw_key: str, expected_label: str) -> None:
        assert humanize_key(raw_key) == expected_label


class TestFixturePayloadPointerSemantics:
    """Verifies semantic pointer extraction on the canonical layout fixtures."""

    def test_resort_fixture_pointers(self) -> None:
        by_path = {
            p.path: p
            for p in inspect_payload_pointers(
                RESORT.payload, mutable_paths=RESORT.mutable_paths
            )
        }
        assert by_path["/name"].semantic_type == "name"
        assert by_path["/name"].label == "Name"
        assert by_path["/logoUrl"].semantic_type == "image_url"
        assert by_path["/logoUrl"].hints.get("keyHint") == "logo"
        assert by_path["/rating"].semantic_type == "rating"
        assert by_path["/priceFrom"].semantic_type == "currency"
        assert by_path["/priceFrom"].label == "Price from"
        assert by_path["/about"].semantic_type == "long_text"
        assert by_path["/about"].hints["wordCount"] >= 25
        assert by_path["/about"].hints["length"] == "blurb"

        photos = by_path["/photos"]
        assert photos.semantic_type == "array"
        assert photos.element_semantic_types == {
            "url": "image_url",
            "caption": "string",
        }
        assert photos.sample_pointers == ("/photos/0/url",)

    def test_host_fixture_pointers(self) -> None:
        by_path = {
            p.path: p
            for p in inspect_payload_pointers(
                HOST.payload, mutable_paths=HOST.mutable_paths
            )
        }
        assert by_path["/host"].semantic_type == "string"
        assert by_path["/cpu"].semantic_type == "number"
        assert by_path["/cpuDelta"].semantic_type == "number"
        assert by_path["/status"].semantic_type == "status"
        assert by_path["/uptimeHours"].semantic_type == "integer"

    def test_transfer_fixture_pointers(self) -> None:
        by_path = {
            p.path: p
            for p in inspect_payload_pointers(
                TRANSFER.payload, mutable_paths=TRANSFER.mutable_paths
            )
        }
        assert by_path["/amount"].semantic_type == "currency"
        assert by_path["/amount"].hints.get("currency") == "USD"
        assert by_path["/currency"].semantic_type == "enum"
        assert by_path["/recipient"].semantic_type == "string"
        assert by_path["/fee"].semantic_type == "currency"
        assert by_path["/fee"].hints.get("currency") == "USD"
        assert by_path["/arrives"].semantic_type == "date"
        assert by_path["/actions"].semantic_type == "array"
        assert by_path["/actions"].mutable_hint is True

    def test_settings_fixture_pointers(self) -> None:
        by_path = {
            p.path: p
            for p in inspect_payload_pointers(
                SETTINGS.payload, mutable_paths=SETTINGS.mutable_paths
            )
        }
        assert by_path["/playback"].value_type == "object"
        assert by_path["/playback"].semantic_type == "object"
        assert by_path["/playback"].cardinality == 3
        assert by_path["/playback"].mutable_hint is True
        assert by_path["/notifications"].semantic_type == "object"
        assert by_path["/notifications"].cardinality == 2
        assert by_path["/account"].semantic_type == "object"
        assert by_path["/account"].cardinality == 1
        assert by_path["/playback/skipForward"].semantic_type == "duration"
        assert by_path["/playback/autoDownload"].semantic_type == "boolean"
        assert by_path["/playback/speed"].semantic_type == "number"
        assert by_path["/account/signOut"].semantic_type == "string"
