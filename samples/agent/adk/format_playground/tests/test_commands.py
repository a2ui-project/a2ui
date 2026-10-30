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

"""Tests for slash commands and A2A part classification."""

from __future__ import annotations

from a2a.types import DataPart, Part, TextPart
import pytest

from agent_executor import build_query, classify_data_part
from commands import Command, apply_command, help_text, parse_command
from modes import PlaygroundSettings, RenderMode


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("/mode express", Command("mode", "express")),
        ("  /MODE Direct ", Command("mode", "direct")),
        ("/mode tool", Command("mode", "tool")),
        ("/mode", Command("mode", None)),
        ("/backend jev", Command("backend", "jev")),
        ("/backend gev", Command("backend", "gev")),
        ("/backend", Command("backend", None)),
        ("/compare", Command("compare")),
        ("/trace", Command("trace")),
        ("/help", Command("help")),
        ("/rate decision", Command("rate", "decision")),
        (
            "/rate decision looks great",
            Command("rate", "decision", "looks great"),
        ),
        ("/ratings", Command("ratings")),
        ("/remix", Command("remix")),
        ("/remix 42", Command("remix", "42")),
        ("/nope now", Command("help", "unknown:/nope now")),
        ("/", Command("help", "unknown:/")),
        ("plain text", None),
        ("show me / a slash", None),
    ],
)
def test_parse_command(text: str, expected: Command | None) -> None:
    assert parse_command(text) == expected


def test_apply_command_transitions() -> None:
    settings = PlaygroundSettings()
    changed, reply = apply_command(Command("mode", "express"), settings)
    assert changed.mode is RenderMode.EXPRESS and reply == "Mode set to `express`."

    same, reply = apply_command(Command("mode", "sparkles"), settings)
    assert same == settings
    assert reply is not None and "decision, express, direct" in reply
    same, reply = apply_command(Command("mode", None), settings)
    assert same == settings and reply is not None and reply.startswith("Unknown mode")

    comparing, reply = apply_command(Command("compare"), settings)
    assert comparing.compare is True and reply is not None and "all three" in reply

    for name in ("trace", "help"):
        unchanged, reply = apply_command(Command(name), settings)  # type: ignore[arg-type]
        assert unchanged == settings and reply is None


def test_help_text_names_every_mode_backend_and_model() -> None:
    lines = help_text(PlaygroundSettings(mode=RenderMode.DIRECT), "mock", "gemini-x")
    joined = "\n".join(lines)
    for mode in RenderMode:
        assert mode.value in joined
    assert "`direct`" in joined and "`mock`" in joined and "`gemini-x`" in joined
    assert "/compare" in joined and "/trace" in joined


def test_classify_data_part_shapes() -> None:
    assert classify_data_part({"useStreaming": False}) == ("streaming", False)
    for ver in ("v0.9", "v0.9.1", "1.0"):
        act = {"version": ver, "action": {"name": "submit", "context": {"a": 1}}}
        assert classify_data_part(act) == ("action", act["action"])
    user = {"userAction": {"name": "submit", "surfaceId": "turn-1", "context": {}}}
    assert classify_data_part(user) == ("action", user["userAction"])
    pasted = {"name": "Casa Verde", "rating": 4.6}
    assert classify_data_part(pasted) == ("payload", pasted)
    assert classify_data_part([1, 2, 3]) == ("payload", [1, 2, 3])


def test_build_query_prefers_actions_then_payloads_then_text() -> None:
    text = Part(root=TextPart(text="Show this"))
    action = Part(
        root=DataPart(data={"userAction": {"name": "submit", "context": {"x": 1}}})
    )
    pasted = Part(root=DataPart(data={"name": "Casa Verde"}))
    streaming = Part(root=DataPart(data={"useStreaming": True}))

    assert build_query([text]) == "Show this"
    assert build_query([streaming, text]) == "Show this"
    action_q = build_query([text, action])
    assert action_q.startswith("User interacted with the UI: action `submit`")
    assert '{"x": 1}' in action_q
    payload_q = build_query([text, pasted])
    assert payload_q.startswith("Show this\n\nUse this JSON verbatim as the payload:")
    assert '"name": "Casa Verde"' in payload_q
    assert build_query([pasted]).startswith("Use this JSON verbatim")
    assert build_query([]) == ""
