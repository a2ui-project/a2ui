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

"""Tests for stage 1: prompt assembly, pasted JSON, and block extraction."""

from __future__ import annotations

import json

from a2ui.inference_formats.decision import ArchetypeGrammar
from stage1 import (
    STAGE1_PREAMBLE,
    UI_ACTION_PREFIX,
    extract_block,
    extract_pasted_json,
    stage1_instruction,
    stage1_user_text,
)

_BLOCK = {
    "intent": "Show the resort overview",
    "payload": {"name": "Casa Verde", "rating": 4.6},
}


def _wrap(body: str) -> str:
    return f"<a2ui>{body}</a2ui>"


def test_extract_block_reads_a_well_formed_block() -> None:
    block = extract_block("Sure!\n" + _wrap(json.dumps(_BLOCK)) + "\nDone.")
    assert block is not None
    assert block.intent == "Show the resort overview"
    assert block.payload == _BLOCK["payload"]
    assert block.layout == ()


def test_extract_block_accepts_a_list_wrapper_tolerant_json_and_tags_in_strings() -> (
    None
):
    listed = extract_block(
        _wrap(json.dumps([_BLOCK, {"intent": "second", "payload": {}}]))
    )
    assert listed is not None and listed.intent == "Show the resort overview"
    trailing_comma = extract_block(
        _wrap('{"intent": "Show it", "payload": {"a": 1,},}')
    )
    assert trailing_comma is not None and trailing_comma.payload == {"a": 1}
    with_tag_in_string = extract_block(
        _wrap('{"intent": "Say </a2ui> literally", "payload": {"x": "<a2ui>"}}')
    )
    assert with_tag_in_string is not None
    assert with_tag_in_string.payload == {"x": "<a2ui>"}


def test_extract_block_returns_none_for_prose_or_invalid_blocks() -> None:
    assert extract_block("I would show a card with the resort name.") is None
    assert extract_block(_wrap("not json at all")) is None
    assert extract_block(_wrap(json.dumps({"payload": {"a": 1}}))) is None
    assert extract_block(_wrap(json.dumps(["just", "strings"]))) is None


def test_extract_pasted_json_finds_objects_and_arrays_and_ignores_prose_braces() -> (
    None
):
    assert extract_pasted_json('Show this: {"a": 1, "b": [1, 2]}') == {
        "a": 1,
        "b": [1, 2],
    }
    assert extract_pasted_json("List: [1, 2, 3] please") == [1, 2, 3]
    assert extract_pasted_json("Use {curly} braces {like this}") is None
    assert extract_pasted_json('first {"a": 1} then {"b": 2}') == {"a": 1}
    assert extract_pasted_json("no json here") is None


def test_stage1_user_text_pins_pasted_json_only_when_present() -> None:
    plain = stage1_user_text("Give me an address entry form")
    assert plain == "Give me an address entry form"
    pinned = stage1_user_text('Render {"name": "Casa Verde"}')
    assert pinned.startswith('Render {"name": "Casa Verde"}')
    assert "Use this JSON verbatim as the payload" in pinned
    assert '"name": "Casa Verde"' in pinned
    action = f'{UI_ACTION_PREFIX} action `submit` with context {{"x": 1}}.'
    assert stage1_user_text(action) == action


def test_stage1_instruction_lists_every_brief_role() -> None:
    grammar = ArchetypeGrammar.default()
    instruction = stage1_instruction(grammar)
    assert instruction.startswith(STAGE1_PREAMBLE)
    for role in grammar.brief_roles():
        assert f"`{role}`" in instruction
    assert "<a2ui>" in instruction
