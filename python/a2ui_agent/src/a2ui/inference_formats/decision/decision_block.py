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

"""The decision block: the JSON object an LLM emits for the decision format.

Shared by the prompt generator, the parser, and the render tool so all three
read and write the same field names.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from a2ui.core.schema import AgentToRendererMessage
from a2ui.parser.messages import to_message_dicts

from .models import coerce_decision_payload

# Wire field names, with the snake_case spellings also accepted on input.
_FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "intent": ("intent",),
    "payload": ("payload", "data"),
    "surface_id": ("surfaceId", "surface_id"),
    "template_id": ("template", "templateId", "template_id"),
    "fallback_dsl": ("fallbackDsl", "fallback_dsl"),
}


def _first_present(source: Mapping[str, Any], names: Sequence[str]) -> Any:
    for name in names:
        if name in source:
            return source[name]
    return None


@dataclass(frozen=True)
class DecisionBlock:
    """One decision request: what to show and the data to show it with.

    Attributes:
        intent: Natural-language description of the interface to render.
        payload: The data to bind, as an object or array (a JSON string is
            decoded by `from_mapping`).
        surface_id: Target surface, or None for the synthesizer default.
        template_id: A registered template to render directly, if any.
        fallback_dsl: A2UI Express rendered when the model abstains, if any.
    """

    intent: str
    payload: Mapping[str, Any] | Sequence[Any]
    surface_id: str | None = None
    template_id: str | None = None
    fallback_dsl: str | None = None

    @classmethod
    def from_mapping(cls, source: Mapping[str, Any]) -> DecisionBlock:
        """Reads a block from a parsed JSON object.

        Accepts the camelCase wire names (`surfaceId`, `template`,
        `fallbackDsl`) and their snake_case spellings.

        Raises:
            ValueError: If `intent` is missing or blank, or `payload` is a
                string that is not valid JSON.
            TypeError: If `payload` is missing or is neither an object nor an
                array.
        """
        intent = _first_present(source, _FIELD_ALIASES["intent"])
        if not isinstance(intent, str) or not intent.strip():
            raise ValueError("Decision block requires a non-empty string 'intent'.")
        raw_payload = _first_present(source, _FIELD_ALIASES["payload"])
        if raw_payload is None:
            raise TypeError("Decision block requires a 'payload' object or array.")
        payload = coerce_decision_payload(raw_payload)

        def _optional_str(key: str) -> str | None:
            value = _first_present(source, _FIELD_ALIASES[key])
            if value is None:
                return None
            if not isinstance(value, str):
                raise TypeError(
                    f"Decision block field '{_FIELD_ALIASES[key][0]}' must be a"
                    f" string, got {type(value).__name__}."
                )
            return value or None

        return cls(
            intent=intent.strip(),
            payload=payload,
            surface_id=_optional_str("surface_id"),
            template_id=_optional_str("template_id"),
            fallback_dsl=_optional_str("fallback_dsl"),
        )

    def to_json(self) -> dict[str, Any]:
        """Serializes the block with the camelCase wire names, omitting None."""
        out: dict[str, Any] = {"intent": self.intent, "payload": self.payload}
        if self.surface_id is not None:
            out["surfaceId"] = self.surface_id
        if self.template_id is not None:
            out["template"] = self.template_id
        if self.fallback_dsl is not None:
            out["fallbackDsl"] = self.fallback_dsl
        return out


def _surface_id_in(msg: Mapping[str, Any]) -> str | None:
    """Returns the first `surfaceId` any envelope body in the message names."""
    for body in msg.values():
        if isinstance(body, Mapping) and isinstance(body.get("surfaceId"), str):
            return str(body["surfaceId"])
    return None


def _data_model_in(msg: Mapping[str, Any]) -> Mapping[str, Any] | Sequence[Any] | None:
    """Returns the data model a message writes, if it writes one.

    Reads `updateDataModel.value`, v0.8 `dataModelUpdate.contents`, and a
    v1.0 `createSurface.dataModel`.
    """
    for key, field in (("updateDataModel", "value"), ("dataModelUpdate", "contents")):
        body = msg.get(key)
        if isinstance(body, Mapping):
            value = body.get(field)
            return value if isinstance(value, (Mapping, list, tuple)) else None
    create = msg.get("createSurface")
    if isinstance(create, Mapping):
        data_model = create.get("dataModel")
        if isinstance(data_model, Mapping):
            return data_model
    return None


def decision_block_from_messages(
    messages: Sequence[AgentToRendererMessage],
    *,
    default_intent: str | None = None,
) -> DecisionBlock:
    """Reconstructs a decision block from rendered messages.

    The round-trip is lossy: rendered messages carry no intent, so a synthetic
    `Render <surface>` intent (or `default_intent` when supplied) is used. The
    payload is the first data model any message writes and the surface id
    comes from the first message that names one.
    """
    surface_id: str | None = None
    payload: Mapping[str, Any] | Sequence[Any] | None = None
    for msg in to_message_dicts(messages):
        if surface_id is None:
            surface_id = _surface_id_in(msg)
        if payload is None:
            payload = _data_model_in(msg)
    intent = (
        default_intent
        if default_intent is not None
        else f"Render {surface_id or 'surface'}"
    )
    return DecisionBlock(
        intent=intent,
        payload=payload if payload is not None else {},
        surface_id=surface_id,
    )


__all__ = ["DecisionBlock", "decision_block_from_messages"]
