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

"""Pairwise and multi-candidate rating tracking for the format playground."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
import datetime
import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

RATINGS_PATH = Path(__file__).parent / "logs" / "ratings.jsonl"


@dataclass(frozen=True)
class RatingRecord:
    """A record capturing a user preference between playground render modes."""

    session_id: str
    request: str
    winner: str
    comment: str = ""
    timestamp: str = field(
        default_factory=lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
    )
    candidates: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RatingRecord:
        return cls(
            session_id=str(data.get("session_id", "")),
            request=str(data.get("request", "")),
            winner=str(data.get("winner", "")),
            comment=str(data.get("comment", "")),
            timestamp=str(data.get("timestamp", "")),
            candidates=list(data.get("candidates", [])),
        )


def append_rating(path: str | Path, record: RatingRecord) -> None:
    """Appends a rating record to a JSONL file, creating parent directories if needed."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "a", encoding="utf-8") as f:
        f.write(json.dumps(record.to_dict()) + "\n")


def summarize_ratings(path: str | Path) -> dict[str, int]:
    """Reads a ratings JSONL file and summarizes win counts per mode."""
    p = Path(path)
    if not p.is_file():
        return {}

    wins: dict[str, int] = {}
    with open(p, "r", encoding="utf-8") as f:
        for idx, line in enumerate(f, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                data = json.loads(stripped)
                winner = str(data.get("winner", "")).lower()
                if winner:
                    wins[winner] = wins.get(winner, 0) + 1
            except Exception as exc:  # pylint: disable=broad-exception-caught
                logger.warning(
                    "Skipping corrupt rating line %d in %s: %s", idx, path, exc
                )

    return wins
