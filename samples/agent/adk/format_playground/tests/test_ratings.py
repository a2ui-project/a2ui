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

"""Tests for format playground rating persistence and summarization."""

from __future__ import annotations

from pathlib import Path

from ratings import RatingRecord, append_rating, summarize_ratings


def test_append_and_summarize_ratings(tmp_path: Path) -> None:
    ratings_file = tmp_path / "logs" / "ratings.jsonl"
    assert summarize_ratings(ratings_file) == {}

    rec1 = RatingRecord(
        session_id="s1",
        request="Show stock portfolio",
        winner="decision",
        comment="Fast and clean",
        candidates=[{"mode": "decision", "ok": True}],
    )
    rec2 = RatingRecord(
        session_id="s2",
        request="Show host health",
        winner="tool",
        comment="Zero model latency",
    )
    rec3 = RatingRecord(
        session_id="s3",
        request="Address form",
        winner="decision",
    )

    append_rating(ratings_file, rec1)
    append_rating(ratings_file, rec2)
    append_rating(ratings_file, rec3)

    summary = summarize_ratings(ratings_file)
    assert summary == {"decision": 2, "tool": 1}


def test_corrupt_lines_ignored(tmp_path: Path) -> None:
    ratings_file = tmp_path / "corrupt.jsonl"
    ratings_file.write_text(
        '{"winner": "decision"}\n'
        "\n"
        '{"not_json": broken\n'
        '{"winner": "express"}\n'
        '{"no_winner_field": 1}\n',
        encoding="utf-8",
    )

    summary = summarize_ratings(ratings_file)
    assert summary == {"decision": 1, "express": 1}


def test_rating_record_dict_roundtrip() -> None:
    rec = RatingRecord(
        session_id="sess-42",
        request="Query text",
        winner="direct",
        comment="Nice layout",
        candidates=[{"mode": "direct", "latency_ms": 12.5}],
    )
    data = rec.to_dict()
    assert data["session_id"] == "sess-42"
    assert data["winner"] == "direct"
    assert data["comment"] == "Nice layout"

    rec2 = RatingRecord.from_dict(data)
    assert rec2.session_id == rec.session_id
    assert rec2.winner == rec.winner
    assert rec2.comment == rec.comment
    assert rec2.candidates == rec.candidates
