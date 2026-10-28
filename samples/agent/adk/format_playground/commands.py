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

"""Slash commands that change playground settings or ask for information."""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Literal

from modes import PlaygroundSettings, RenderMode, as_mode

CommandName = Literal[
    "mode", "backend", "compare", "trace", "help", "rate", "ratings", "remix"
]

DECISION_BACKENDS: tuple[str, ...] = ("jev", "gev", "local", "mock")

_KNOWN: tuple[CommandName, ...] = (
    "mode",
    "backend",
    "compare",
    "trace",
    "help",
    "rate",
    "ratings",
    "remix",
)


@dataclass(frozen=True)
class Command:
    """A parsed slash command."""

    name: CommandName
    argument: str | None = None
    """The first word after the command, lowercased; for `/help`, an `unknown:<text>`
    marker when the user typed a command that does not exist."""
    text: str | None = None
    """The remainder of the command line after the argument, if any."""


def parse_command(text: str) -> Command | None:
    """Parses `/mode express`, `/compare`, `/trace`, `/rate`, `/ratings`, or `/help`."""
    stripped = text.strip()
    if not stripped.startswith("/"):
        return None
    words = stripped[1:].split()
    if not words:
        return Command("help", argument="unknown:/")
    name = words[0].lower()
    argument = words[1].lower() if len(words) > 1 else None
    rest = " ".join(words[2:]) if len(words) > 2 else None
    if name not in _KNOWN:
        return Command("help", argument=f"unknown:{stripped}")
    return Command(name, argument, rest)


def apply_command(
    cmd: Command, settings: PlaygroundSettings
) -> tuple[PlaygroundSettings, str | None]:
    """Applies `cmd` to `settings`.

    Returns the new settings and a reply, or `None` as the reply for `/help`
    and `/trace`, which the agent answers itself.
    """
    if cmd.name == "mode":
        mode = as_mode(cmd.argument) if cmd.argument else None
        if mode is None:
            choices = ", ".join(m.value for m in RenderMode)
            return settings, f"Unknown mode `{cmd.argument or ''}`; choose {choices}."
        return replace(settings, mode=mode), f"Mode set to `{mode}`."
    if cmd.name == "compare":
        return replace(settings, compare=True), (
            "Next request renders through all three modes from the same data."
        )
    return settings, None


def help_text(
    settings: PlaygroundSettings, backend_name: str, model_name: str
) -> list[str]:
    """The `/help` reply, one entry per line."""
    return [
        "**Format playground**",
        "Describe an interface and it is rendered through the active mode.",
        (
            f"Active mode: `{settings.mode}` · decision backend: `{backend_name}`"
            f" · model: `{model_name}`"
        ),
        "`/mode decision|express|direct|tool` picks how the next requests render.",
        "`/backend jev|gev|local|mock` switches the decision model.",
        "`/compare` renders the next request through all three modes.",
        "`/trace` shows the planner's questions for the last decision render.",
        "`/rate <mode> [comment]` records a preference vote for the last render.",
        "`/ratings` summarizes recorded mode preference win counts.",
        "`/remix [seed]` re-samples the last decision layout with 0 model calls.",
        "`/help` shows this card.",
        (
            "Try: *give me an address entry form*, *show my stock portfolio*,"
            " or paste a JSON object to render it as is."
        ),
    ]
