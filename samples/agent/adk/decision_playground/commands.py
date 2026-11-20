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

"""Slash-command parser for the decision playground."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from modes import RenderMode

CommandKind = Literal[
    "mode",
    "backend",
    "budget",
    "tool",
    "form",
    "compare",
    "trace",
    "help",
    "unknown",
]

VALID_BACKENDS: tuple[str, ...] = ("mock", "gemini", "jev", "step0")


@dataclass(frozen=True)
class ParsedCommand:
    """Structured result of parsing a slash command."""

    kind: CommandKind
    arg: str = ""
    raw: str = ""


def parse_command(text: str) -> ParsedCommand | None:
    """Parses a slash command from `text`, or returns None for normal prompts."""
    stripped = text.strip()
    if not stripped.startswith("/"):
        return None
    parts = stripped.split(None, 1)
    cmd = parts[0].lower()
    arg = parts[1].strip() if len(parts) > 1 else ""
    mapping: dict[str, CommandKind] = {
        "/mode": "mode",
        "/backend": "backend",
        "/budget": "budget",
        "/tool": "tool",
        "/form": "form",
        "/compare": "compare",
        "/trace": "trace",
        "/help": "help",
    }
    kind = mapping.get(cmd, "unknown")
    return ParsedCommand(kind=kind, arg=arg, raw=stripped)


def parse_render_mode(value: str) -> RenderMode | None:
    """Parses a mode name string into `RenderMode`, or returns None."""
    try:
        return RenderMode(value.strip().lower())
    except ValueError:
        return None


def parse_budget_ms(value: str) -> tuple[bool, float | None]:
    """Parses `/budget <ms|off>` into `(valid, budget_ms)`."""
    low = value.strip().lower()
    if low in ("", "off", "none", "clear"):
        return True, None
    try:
        parsed = float(low)
    except ValueError:
        return False, None
    if parsed <= 0.0:
        return False, None
    return True, parsed


def format_help(
    *,
    mode: RenderMode,
    backend_kind: str,
    model_id: str,
    budget_ms: float | None,
    tool_aliases: tuple[str, ...],
    form_aliases: tuple[str, ...],
) -> str:
    """Formats the `/help` status and command reference card text."""
    budget_label = f"{budget_ms:g} ms" if budget_ms is not None else "off"
    tools_str = " | ".join(tool_aliases)
    forms_str = " | ".join(form_aliases)
    return "\n".join([
        "### A2UI Decision Playground",
        f"- Active mode: `{mode.value}`",
        f"- Decision backend: `{backend_kind}` (`{model_id}`)",
        f"- Latency budget: `{budget_label}`",
        "",
        "**Commands**",
        "- `/mode cascade | binder | rpc | express | direct`",
        "- `/backend mock | gemini | jev | step0`",
        (
            "- `/budget <ms> | off` (for example `/budget 300` to test tight-budget"
            " gating)"
        ),
        (
            f"- `/tool {tools_str}` (run a domain tool directly via"
            " `ToolPointerBinder`, 0 LLM calls)"
        ),
        (
            f"- `/form {forms_str}` (render an A2UI v1.0 form backed by submit-time RPC"
            " predicates)"
        ),
        "- `/compare` (compare `cascade`, `express`, and `direct` on the next prompt)",
        "- `/trace` (summarize the last decision batch)",
        "- `/help` (show this message)",
    ])
