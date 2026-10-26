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

"""Stage 1 of the playground: turn a chat request into one decision block.

The model is asked for exactly one `<a2ui>{"intent", "payload", "layout"}</a2ui>`
block using the same contract the decision inference format publishes. Reading
the block back reuses the SDK's own lexer and tolerant JSON parser so the
playground accepts exactly what `DecisionParser` would accept.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
import json
import logging
from typing import Any

from a2ui.constants import A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG
from a2ui.inference_formats.decision import (
    ArchetypeGrammar,
    DecisionBlock,
    decision_rules,
)
from a2ui.parser import BlockLexer, RawA2uiPart, parse_and_fix

logger = logging.getLogger(__name__)

TOOL_MODE_INSTRUCTION = """# Format playground: Tool Mode

You are an assistant with access to backend data and configuration tools.
When the person asks for information or an action that a tool provides, invoke that tool.
Never describe or emit user interface code yourself: the decision layout model will render the tool result into a user interface.
When no tool fits the request, reply with a single concise sentence explaining that no tool is available.
"""

STAGE1_PREAMBLE = """# Format playground

You are the first stage of a UI playground. The person describes an interface
they want to see; you describe what to show and provide the data. A local
decision model (or a second model call) turns your description into the
actual components, so you never write components yourself.

Rules:

- Reply with exactly one decision block and nothing else: no prose before or
  after it.
- Invent realistic, specific data: real-looking names, prices, dates, and
  3 to 6 items for any list. Keep payload keys camelCase and values JSON
  primitives, objects, and arrays.
- For forms, inputs, or settings, put the field values themselves under each
  field key (for example `"email": "alex.smith@example.com"`, `"password": ""`,
  `"rememberMe": false`), put button labels in an `"actions"` array (for
  example `"actions": ["Sign In"]`), and list the editable pointers in
  `"mutablePaths"` (for example `["/email", "/password", "/rememberMe"]`). Do
  not emit `*Label`, `*Placeholder`, or `*ButtonText` keys.
- When the message supplies JSON, use it verbatim as `payload` and write only
  the `intent`.
- When the message reports a UI action (a button press, a form submission),
  reply with a block that reflects the result: a confirmation, the updated
  record, or the next step.
- Set `layout` only when the person names a layout role explicitly; otherwise
  leave it out.
- The `intent` is one sentence naming what the data is and how the person
  should see or interact with it."""

_JSON_OPENERS = ("{", "[")

UI_ACTION_PREFIX = "User interacted with the UI:"
"""Prefix the executor puts on UI action reports; such text is never JSON-pinned."""


def stage1_instruction(grammar: ArchetypeGrammar) -> str:
    """The stage-1 system instruction: the preamble plus the decision block contract."""
    return f"{STAGE1_PREAMBLE}\n\n{decision_rules(grammar)}"


def extract_pasted_json(query: str) -> Mapping[str, Any] | Sequence[Any] | None:
    """Returns the first JSON object or array embedded in `query`, or None.

    Scans from each `{` or `[` with `JSONDecoder.raw_decode`, so braces inside
    prose that are not JSON are ignored.
    """
    decoder = json.JSONDecoder()
    for index, char in enumerate(query):
        if char not in _JSON_OPENERS:
            continue
        try:
            value, _ = decoder.raw_decode(query, index)
        except json.JSONDecodeError:
            continue
        if isinstance(value, (Mapping, list)):
            return value
    return None


def stage1_user_text(query: str) -> str:
    """The stage-1 user message, with pasted JSON pinned as the payload.

    UI action reports carry their context as JSON, which must not be mistaken
    for a payload, so text starting with `UI_ACTION_PREFIX` is passed through.
    """
    if query.startswith(UI_ACTION_PREFIX):
        return query
    pasted = extract_pasted_json(query)
    if pasted is None:
        return query
    encoded = json.dumps(pasted, indent=2)
    return f"{query}\n\nUse this JSON verbatim as the payload:\n```json\n{encoded}\n```"


def extract_block(text: str) -> DecisionBlock | None:
    """Reads the first decision block out of a stage-1 reply.

    Returns None when the reply has no block, the block is not JSON the SDK's
    tolerant parser can fix, or `DecisionBlock.from_mapping` rejects it.
    """
    lexer = BlockLexer(
        open_tag=A2UI_INFERENCE_OPEN_TAG,
        close_tag=A2UI_INFERENCE_CLOSE_TAG,
        string_delimiters={'"'},
    )
    blocks = lexer.tokenize(text)
    raw_parts = [b.part for b in blocks if isinstance(b.part, RawA2uiPart)]
    if not raw_parts:
        return None
    try:
        parsed: Any = parse_and_fix(raw_parts[0].a2ui_raw)
    except Exception as exc:  # parse_and_fix raises several JSON error types
        logger.warning("Stage 1 block is not valid JSON: %s", exc)
        return None
    item = parsed[0] if isinstance(parsed, list) and parsed else parsed
    if not isinstance(item, Mapping):
        logger.warning("Stage 1 block is not a JSON object: %r", type(item).__name__)
        return None
    try:
        return DecisionBlock.from_mapping(item)
    except (TypeError, ValueError) as exc:
        logger.warning("Stage 1 block rejected: %s", exc)
        return None
