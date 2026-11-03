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

"""Loads the `conformance/e2e` scenarios the scripted agent replays.

A scenario file holds a list of `e2e_scenario` cases. Each case has a
protocol version and turns, and each turn has the text the user types (or
`null` when the turn is started by the renderer's outbound message for the
previous turn), the chunks the model streams for each inference format, and
the wire messages those chunks parse to.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

__all__ = [
    "Scenario",
    "ScenarioIndex",
    "Turn",
    "load_scenarios",
    "normalize_version",
]

_ACTION = "e2e_scenario"


def normalize_version(version: str) -> str:
    """Returns the protocol version as the scenario files write it.

    Scenario files write `"1.0"` and `"0.9.1"`. Capability keys, extension
    URIs and catalog ids write `v1.0`, `v0.9`, `v1_0` and `v0_9`; this maps
    them all to the scenario form, treating v0.9 and v0.9.1 as one version.
    """
    normalized = version.strip().lower().lstrip("v").replace("_", ".")
    if normalized == "0.9":
        return "0.9.1"
    return normalized


@dataclass(frozen=True)
class Turn:
    """One turn of a scenario."""

    index: int
    user_text: str | None
    model_chunks: Mapping[str, list[str]]
    expect_wire: list[dict[str, Any]]
    expect_outbound: list[dict[str, Any]] = field(default_factory=list)

    @property
    def starts_with_inbound(self) -> bool:
        """Whether the turn starts when a renderer message arrives, not user text."""
        return self.user_text is None

    def chunks_for(self, format_name: str) -> list[str]:
        """The chunks the model streams in `format_name`.

        Raises:
            KeyError: If the scenario does not script the format.
        """
        return list(self.model_chunks[format_name])

    @property
    def text(self) -> str:
        """The turn's text parts of `expectWire`, merged, for a text-only reply."""
        return "\n\n".join(
            str(part["text"]) for part in self.expect_wire if "text" in part
        )

    @property
    def a2ui_messages(self) -> list[dict[str, Any]]:
        """The A2UI messages of `expectWire`, in order."""
        return [
            message
            for part in self.expect_wire
            if "a2ui" in part
            for message in part["a2ui"]
        ]


@dataclass(frozen=True)
class Scenario:
    """One `e2e_scenario` case."""

    name: str
    protocol_version: str
    formats: list[str]
    catalog_paths: list[str]
    turns: list[Turn]
    path: Path

    @property
    def opening_text(self) -> str:
        """The user text of turn 0, which picks the scenario."""
        text = self.turns[0].user_text
        if text is None:
            raise ValueError(f"Scenario '{self.name}' has no user text in turn 0.")
        return text


class ScenarioIndex:
    """The loaded scenarios, looked up by opening text and protocol version."""

    def __init__(self, scenarios: list[Scenario]) -> None:
        self._scenarios = list(scenarios)
        self._by_key: dict[tuple[str, str], Scenario] = {}
        for scenario in scenarios:
            key = (_normalize_text(scenario.opening_text), scenario.protocol_version)
            if key in self._by_key:
                raise ValueError(
                    f"Scenarios '{self._by_key[key].name}' and '{scenario.name}'"
                    f" both open with {scenario.opening_text!r} for"
                    f" v{scenario.protocol_version}."
                )
            self._by_key[key] = scenario

    def __iter__(self) -> Iterator[Scenario]:
        return iter(self._scenarios)

    def __len__(self) -> int:
        return len(self._scenarios)

    def find(self, opening_text: str, version: str) -> Scenario | None:
        """The scenario whose turn 0 is `opening_text`, written for `version`.

        `version` is normalized with `normalize_version`, so a v0.9 renderer
        gets the scenario's v0.9.1 copy when one exists.
        """
        key = (_normalize_text(opening_text), normalize_version(version))
        return self._by_key.get(key)

    def versions_of(self, opening_text: str) -> list[str]:
        """The protocol versions a scenario with this opening text exists in."""
        text = _normalize_text(opening_text)
        return sorted(version for (opening, version) in self._by_key if opening == text)


def _normalize_text(text: str) -> str:
    return " ".join(text.split())


def _turn(index: int, raw: Mapping[str, Any]) -> Turn:
    return Turn(
        index=index,
        user_text=raw.get("userText"),
        model_chunks={
            name: list(chunks) for name, chunks in raw.get("modelChunks", {}).items()
        },
        expect_wire=list(raw.get("expectWire", [])),
        expect_outbound=list(raw.get("expectOutbound") or []),
    )


def _scenario(raw: Mapping[str, Any], path: Path) -> Scenario:
    return Scenario(
        name=str(raw["name"]),
        protocol_version=normalize_version(str(raw["protocolVersion"])),
        formats=list(raw.get("formats", [])),
        catalog_paths=list(raw.get("catalogPaths", [])),
        turns=[_turn(index, turn) for index, turn in enumerate(raw["turns"])],
        path=path,
    )


def load_scenarios(directory: str | Path) -> ScenarioIndex:
    """Loads every `e2e_scenario` case under `directory`, recursively.

    Raises:
        FileNotFoundError: If `directory` does not exist.
        ValueError: If two scenarios share an opening text and version.
    """
    root = Path(directory)
    if not root.is_dir():
        raise FileNotFoundError(f"Scenario directory not found: {root}")
    scenarios: list[Scenario] = []
    for path in sorted(root.rglob("*.yaml")):
        documents = yaml.safe_load(path.read_text(encoding="utf-8")) or []
        if isinstance(documents, Mapping):
            documents = [documents]
        for raw in documents:
            if isinstance(raw, Mapping) and raw.get("action") == _ACTION:
                scenarios.append(_scenario(raw, path))
    return ScenarioIndex(scenarios)
