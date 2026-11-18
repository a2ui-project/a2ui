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
from dataclasses import dataclass, field
from typing import Any

from a2ui.core.schema import AgentToRendererMessage
from a2ui.parser.messages import to_message_dicts

from .models import ActionSpec, LayoutBrief, coerce_decision_payload

# Wire field names, with the snake_case aliases also accepted on input.
_FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "intent": ("intent",),
    "payload": ("payload", "data"),
    "surface_id": ("surfaceId", "surface_id"),
    "fallback_dsl": ("fallbackDsl", "fallback_dsl"),
    "layout": ("layout",),
    "mutable_paths": ("mutablePaths", "mutable_paths"),
    "title": ("title",),
    "summary": ("summary",),
    "actions": ("actions",),
    "exclude": ("exclude",),
    "replace": ("replace",),
    "region": ("region",),
    "labels": ("labels",),
}


def _first_present(source: Mapping[str, Any], names: Sequence[str]) -> Any:
    """Returns the value of the first key from `names` present in `source`, or None."""
    for name in names:
        if name in source:
            return source[name]
    return None


def _parse_layout_items(raw: Any) -> tuple[str, ...]:
    """Shape-checks an optional ``layout`` field into its raw brief items.

    Role validation happens later, in the synthesizer, against the grammar it
    was configured with; the block only carries the strings.
    """
    if raw is None:
        return ()
    if isinstance(raw, LayoutBrief):
        return tuple(raw.to_items())
    if (
        not isinstance(raw, Sequence)
        or isinstance(raw, (str, bytes, bytearray))
        or not all(isinstance(item, str) for item in raw)
    ):
        raise TypeError(
            "Decision block field 'layout' must be a list of 'role:key,key' strings."
        )
    return tuple(item for item in raw if item.strip())


def _parse_mutable_paths(raw: Any) -> tuple[str, ...]:
    """Normalizes an optional ``mutablePaths`` sequence into ``/``-prefixed pointers."""
    if raw is None:
        return ()
    if (
        not isinstance(raw, Sequence)
        or isinstance(raw, (str, bytes, bytearray))
        or not all(isinstance(item, str) for item in raw)
    ):
        raise TypeError(
            "Decision block field 'mutablePaths' must be a list of JSON pointer"
            " strings."
        )
    paths: list[str] = []
    for item in raw:
        stripped = item.strip()
        if not stripped:
            continue
        paths.append(stripped if stripped.startswith("/") else f"/{stripped}")
    return tuple(paths)


def _parse_exclude(raw: Any) -> tuple[str, ...]:
    """Validates an optional ``exclude`` sequence of ``/``-prefixed JSON pointers."""
    if raw is None:
        return ()
    if (
        not isinstance(raw, Sequence)
        or isinstance(raw, (str, bytes, bytearray))
        or not all(isinstance(item, str) for item in raw)
    ):
        raise TypeError(
            "Decision block field 'exclude' must be a list of JSON pointer strings."
        )
    paths: list[str] = []
    for item in raw:
        stripped = item.strip()
        if not stripped.startswith("/") or stripped == "/":
            raise ValueError(
                "Decision block field 'exclude' entries must be JSON Pointers"
                f" starting with '/', got {item!r}."
            )
        paths.append(stripped)
    return tuple(paths)


def _parse_one_action(action_id: Any, value: Any) -> ActionSpec:
    """Validates and parses one ``(action_id, value)`` entry of the ``actions`` map."""
    if not isinstance(action_id, str):
        raise TypeError(
            "Decision block field 'actions' requires string action ids,"
            f" got {type(action_id).__name__}."
        )
    if isinstance(value, Mapping) and value.get("key") is not None:
        raw_key = value["key"]
        if not isinstance(raw_key, str) or not raw_key.strip():
            raise ValueError(f"Action {action_id!r}: key must be a non-empty string.")
    return ActionSpec.from_block_value(action_id, value)


def _parse_actions(raw: Any) -> tuple[ActionSpec, ...]:
    """Reads the ``actions`` map (action id to label or options) in order."""
    if raw is None:
        return ()
    if not isinstance(raw, Mapping):
        raise TypeError(
            "Decision block field 'actions' must be an object mapping action ids"
            " to labels or option objects."
        )
    return tuple(_parse_one_action(k, v) for k, v in raw.items())


def _parse_replace(raw: Any) -> bool:
    """Validates an optional boolean ``replace`` flag, defaulting to False."""
    if raw is None:
        return False
    if not isinstance(raw, bool):
        raise TypeError("Decision block field 'replace' must be a boolean.")
    return raw


def _parse_region(raw: Any) -> str | None:
    """Validates an optional ``region`` block role identifier."""
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise TypeError(
            f"Decision block field 'region' must be a string, got {type(raw).__name__}."
        )
    stripped = raw.strip()
    if not stripped:
        raise ValueError("Decision block field 'region' must be a non-empty string.")
    return stripped


def _parse_one_label(raw_key: Any, raw_value: Any) -> tuple[str, str]:
    """Validates one ``(pointer, label)`` entry of the ``labels`` map."""
    if not isinstance(raw_key, str):
        raise TypeError(
            "Decision block field 'labels' requires string JSON Pointer keys,"
            f" got {type(raw_key).__name__}."
        )
    pointer = raw_key.strip()
    if not pointer.startswith("/") or pointer == "/":
        raise ValueError(
            "Decision block field 'labels' keys must be JSON Pointers"
            f" starting with '/', got {raw_key!r}."
        )
    if not isinstance(raw_value, str):
        raise TypeError(
            f"Decision block field 'labels' value for {pointer!r} must be a"
            f" string, got {type(raw_value).__name__}."
        )
    label = raw_value.strip()
    if not label:
        raise ValueError(
            f"Decision block field 'labels' value for {pointer!r} must be a"
            " non-empty string."
        )
    return pointer, label


def _parse_labels(raw: Any) -> dict[str, str]:
    """Validates an optional ``labels`` mapping from JSON Pointer to display label."""
    if raw is None:
        return {}
    if not isinstance(raw, Mapping):
        raise TypeError(
            "Decision block field 'labels' must be an object mapping JSON"
            " Pointers to label strings."
        )
    return dict(_parse_one_label(k, v) for k, v in raw.items())


@dataclass(frozen=True)
class DecisionBlock:
    """One decision request: what to show and the data to show it with.

    Attributes:
        intent: Natural-language description of the interface to render.
        payload: The data to bind, as an object or array (a JSON string is
            decoded by `from_mapping`).
        surface_id: Target surface, or None for the synthesizer default.
        fallback_dsl: A2UI Express rendered when the model abstains, if any.
        layout: Raw ``role:key,key`` brief items pinning roles to payload
            pointers; empty when the block gave none. The synthesizer parses
            and validates them against its grammar.
        mutable_paths: JSON Pointers in `payload` that the user may edit.
        title: Optional authored surface title.
        summary: Optional authored surface summary.
        actions: The actions the surface offers, in the order the block
            listed them.
        exclude: JSON Pointers in `payload` the surface must not show.
        replace: When True, the surface is deleted and created again instead
            of updated in place.
        region: Id of one planned block to re-plan on an existing surface,
            or None to update the whole surface.
        labels: Display labels keyed by JSON Pointer, overriding the
            humanized keys.
    """

    intent: str
    payload: Mapping[str, Any] | Sequence[Any]
    surface_id: str | None = None
    fallback_dsl: str | None = None
    layout: tuple[str, ...] = ()
    mutable_paths: tuple[str, ...] = ()
    title: str | None = None
    summary: str | None = None
    actions: tuple[ActionSpec, ...] = ()
    exclude: tuple[str, ...] = ()
    replace: bool = False
    region: str | None = None
    labels: Mapping[str, str] = field(default_factory=dict, hash=False)

    def __post_init__(self) -> None:
        if self.replace and self.region is not None:
            raise ValueError(
                "DecisionBlock cannot combine replace=True with a region update"
            )
        object.__setattr__(self, "labels", dict(self.labels))

    @classmethod
    def from_mapping(cls, source: Mapping[str, Any]) -> DecisionBlock:
        """Reads a block from a parsed JSON object.

        Accepts the camelCase wire names (`surfaceId`, `fallbackDsl`,
        `layout`, `mutablePaths`, `title`, `summary`, `actions`, `exclude`,
        `replace`, `region`, `labels`) and their snake_case aliases.

        Raises:
            ValueError: If `intent` is missing or blank, `payload` is a
                string that is not valid JSON, or an action, `exclude`,
                `region`, or `labels` entry is malformed.
            TypeError: If `payload` is missing or is neither an object nor an
                array, or an optional field has the wrong type.
        """
        if not isinstance(source, Mapping):
            raise TypeError(
                "Decision block must be a JSON object (Mapping),"
                f" got {type(source).__name__}."
            )
        intent = _first_present(source, _FIELD_ALIASES["intent"])
        if not isinstance(intent, str) or not intent.strip():
            raise ValueError("Decision block requires a non-empty string 'intent'.")
        raw_payload = _first_present(source, _FIELD_ALIASES["payload"])
        if raw_payload is None:
            raise TypeError("Decision block requires a 'payload' object or array.")
        payload = coerce_decision_payload(raw_payload)

        def _optional_str(key: str) -> str | None:
            """Reads and trims an optional string field aliased under `key`."""
            value = _first_present(source, _FIELD_ALIASES[key])
            if value is None:
                return None
            if not isinstance(value, str):
                raise TypeError(
                    f"Decision block field '{_FIELD_ALIASES[key][0]}' must be a"
                    f" string, got {type(value).__name__}."
                )
            stripped = value.strip()
            return stripped or None

        layout = _parse_layout_items(_first_present(source, _FIELD_ALIASES["layout"]))
        mutable_paths = _parse_mutable_paths(
            _first_present(source, _FIELD_ALIASES["mutable_paths"])
        )
        return cls(
            intent=intent.strip(),
            payload=payload,
            surface_id=_optional_str("surface_id"),
            fallback_dsl=_optional_str("fallback_dsl"),
            layout=layout,
            mutable_paths=mutable_paths,
            title=_optional_str("title"),
            summary=_optional_str("summary"),
            actions=_parse_actions(_first_present(source, _FIELD_ALIASES["actions"])),
            exclude=_parse_exclude(_first_present(source, _FIELD_ALIASES["exclude"])),
            replace=_parse_replace(_first_present(source, _FIELD_ALIASES["replace"])),
            region=_parse_region(_first_present(source, _FIELD_ALIASES["region"])),
            labels=_parse_labels(_first_present(source, _FIELD_ALIASES["labels"])),
        )

    def to_json(self) -> dict[str, Any]:
        """Serializes the block with the camelCase wire names, omitting None."""
        out: dict[str, Any] = {"intent": self.intent, "payload": self.payload}
        if self.surface_id is not None:
            out["surfaceId"] = self.surface_id
        if self.fallback_dsl is not None:
            out["fallbackDsl"] = self.fallback_dsl
        if self.layout:
            out["layout"] = list(self.layout)
        if self.mutable_paths:
            out["mutablePaths"] = list(self.mutable_paths)
        if self.title is not None:
            out["title"] = self.title
        if self.summary is not None:
            out["summary"] = self.summary
        if self.actions:
            out["actions"] = {a.id: _action_to_json(a) for a in self.actions}
        if self.exclude:
            out["exclude"] = list(self.exclude)
        if self.replace:
            out["replace"] = True
        if self.region is not None:
            out["region"] = self.region
        if self.labels:
            out["labels"] = dict(self.labels)
        return out

    def to_synthesis_kwargs(
        self, *, default_surface_id: str | None = None
    ) -> dict[str, Any]:
        """Builds keyword arguments for `DecisionSynthesizer.synthesize`.

        Keys: `actions`, `exclude`, `mutable_paths`, `fallback_dsl`, `layout`,
        `title`, `summary`, `labels`, `region`, and `surface_id` when one is
        known. `replace` is not a synthesis argument: the caller turns it into
        the `SurfaceOperation` it passes as `operation`.
        """
        kwargs: dict[str, Any] = {
            "actions": self.actions,
            "exclude": self.exclude,
            "mutable_paths": self.mutable_paths,
            "fallback_dsl": self.fallback_dsl,
            "layout": self.layout or None,
            "title": self.title,
            "summary": self.summary,
            "labels": dict(self.labels) if self.labels else None,
            "region": self.region,
        }
        surface_id = self.surface_id or default_surface_id
        if surface_id is not None:
            kwargs["surface_id"] = surface_id
        return kwargs


def _action_to_json(action: ActionSpec) -> str | dict[str, Any]:
    """Serializes an action as its label, or an options object when it has more."""
    options: dict[str, Any] = {}
    if action.scope is not None:
        options["scope"] = action.scope
    if action.key is not None:
        options["key"] = action.key
    if action.context:
        options["context"] = dict(action.context)
    if action.style is not None:
        options["style"] = str(action.style)
    if not options:
        return action.label
    return {"label": action.label, **options}


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
    for key, field_name in (
        ("updateDataModel", "value"),
        ("dataModelUpdate", "contents"),
    ):
        body = msg.get(key)
        if isinstance(body, Mapping):
            value = body.get(field_name)
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
