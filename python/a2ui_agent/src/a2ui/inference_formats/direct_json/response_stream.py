# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.


"""Reading a streamed Direct JSON response chunk by chunk."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
import dataclasses
import json
import re
from typing import Any
from typing import TYPE_CHECKING

from a2ui.core import A2uiError
from a2ui.core import A2uiIntegrityError
from a2ui.core import A2uiParseError
from a2ui.core.common import is_at_least_version
from a2ui.core.schema import AgentToRendererMessage
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats._shared import to_message_dicts
from a2ui.inference_formats._shared import to_message_models
from a2ui.parser import A2uiPart
from a2ui.parser import ResponsePart
from a2ui.parser import ResponseStream
from a2ui.parser import TextPart
from a2ui.utils import RendererState

from .blocks import BlockScanner
from .blocks import CLOSE_TAG
from .blocks import CLOSE_TAG_RE
from .blocks import OPEN_TAG
from .blocks import OPEN_TAG_RE
from .blocks import OPEN_TAG_START_RE
from .blocks import payload_start
from .blocks import possible_tag_start
from .blocks import trailing_fence_start
from .json_reader import PartialReadCache
from .json_reader import read_partial_message_items

if TYPE_CHECKING:
    from .parser import DirectJsonParser

# The messages a renderer applies again as they grow, so a stream emits them
# before their object closes, with the field each one grows by. Any other
# message is held until its object closes, and the messages after it wait
# with it.
_GROWING_FIELDS = {
    "updateComponents": "components",
    "surfaceUpdate": "components",
    "updateDataModel": "value",
    "dataModelUpdate": "contents",
}
# What may surround the payload of a closed block: whitespace, and a Markdown
# fence, as `clean` strips them.
_LEADING_FENCE_RE = re.compile(r"\s*(?:```[a-zA-Z-]*\s*|`+\s*)?")
_TRAILING_FENCE_RE = re.compile(r"\s*(?:```[a-zA-Z-]*|`+)?\s*")


@dataclasses.dataclass
class _Growing:
    """The message of the open block that is still growing, as far as it is checked.

    Attributes:
      key: The message's envelope key, such as `updateComponents`.
      field: The field of the body the message grows by.
      rest: The JSON of the envelope without that field, which must not
        change for the message to be checked for what it gains.
      model: The message as last emitted.
      count: For a message that grows by its components, how many of them
        the state holds.
      last_json: The JSON of the last of those, which may still grow before
        v1.0, where a component is healed as it arrives.
      ids: The ids of the components the state holds.
      last_id: The id of the last of those.
      value: For a message that grows by its value, the value last emitted.
    """

    key: str
    field: str
    rest: str
    model: AgentToRendererMessage
    count: int = 0
    last_json: str | None = None
    ids: set[str] = dataclasses.field(default_factory=set)
    last_id: str | None = None
    value: Any = None


class DirectJsonResponseStream(ResponseStream):
    """Reads one streamed Direct JSON response.

    A message is emitted, and applied to the state, as soon as it reads and
    the state accepts it. Only `updateComponents` and `updateDataModel` (v0.8's
    `surfaceUpdate` and `dataModelUpdate`) are emitted while they grow, and
    again each time a chunk changes them. Any other message is held until its
    object closes, and the messages after it wait with it. When a block
    closes, the messages it holds are applied in full and every surface they
    touched is checked in full.

    Each chunk is read once. The scan for the close tag and the read of the
    open block go on from where the previous chunk left them, a message that
    has closed is not read or checked again, and a message that grows is
    checked for what it gains: an `updateComponents` for the components it
    adds, and an `updateDataModel` is applied again once it closes.

    The stream ends when `close` returns or when `feed` or `close` raises: the
    response cannot be read further once part of it is rejected. The messages
    already emitted stay in the state, since the renderer holds them, and the
    components they added are marked checked (`RendererState.mark_checked`),
    so a later turn on the surface is not required to make them reachable.
    """

    def __init__(
        self,
        parser: DirectJsonParser,
        *,
        wrapped: bool,
        state: RendererState,
    ) -> None:
        self._parser = parser
        self._wrapped = wrapped
        self._state = state
        self._v10 = is_at_least_version(
            parser.catalogs[0].protocol_version, ProtocolVersion.V1_0
        )
        self._whole_item_keys = frozenset({"components"}) if self._v10 else frozenset()
        self._closed = False
        # Text outside blocks.
        self._held = ""
        self._held_backticks = ""
        self._strip_close_backticks = False
        self._run_started = False
        self._held_space = ""
        # The open block.
        self._in_block = not wrapped
        self._block = ""
        self._reset_block()

    def _reset_block(self) -> None:
        self._block = ""
        self._scanner = BlockScanner(0)
        # What the reads of the open block keep from one chunk to the next,
        # for a payload that starts at `_read_start`.
        self._read_cache = PartialReadCache()
        self._read_start: int | None = None
        # How many of the block's messages have closed and been applied.
        self._done = 0
        self._growing: _Growing | None = None
        # Whether a message that has closed was rejected. It is rejected the
        # same way on every later chunk, so nothing after it is emitted
        # before the block closes.
        self._stalled = False
        self._touched: dict[str, None] = {}

    @property
    def state(self) -> RendererState:
        return self._state

    def feed(self, chunk: str) -> list[ResponsePart]:
        if self._closed:
            raise ValueError("The response stream is closed.")
        # The surfaces of what was emitted before this chunk. Finishing a
        # block in this chunk clears `_touched`, but the rollback below
        # restores that block's earlier-emitted messages unchecked.
        emitted = list(self._touched)
        try:
            # A chunk may apply messages and then fail, for example in a second
            # block, before its parts are returned. The transaction undoes
            # them, so the state holds only what was emitted.
            with self._state.transaction():
                return self._feed(chunk)
        except BaseException:
            self._fail(emitted)
            raise

    def close(self) -> list[ResponsePart]:
        if self._closed:
            return []
        self._closed = True
        parts: list[ResponsePart] = []
        try:
            if not self._wrapped:
                self._finish_block(parts, len(self._block))
                return parts
            if self._in_block:
                raise A2uiParseError(
                    f"The response ended inside an {OPEN_TAG} block, before its"
                    f" {CLOSE_TAG} tag."
                )
        except BaseException:
            self._fail(self._touched)
            raise
        if self._held_backticks:
            self._emit_text(parts, self._held_backticks)
            self._held_backticks = ""
        if self._held:
            self._emit_text(parts, self._held)
            self._held = ""
        return parts

    def _fail(self, surface_ids: Iterable[str]) -> None:
        """Ends the stream after a failure, keeping what it emitted.

        The renderer holds the messages already emitted, and so does the
        state. No message removes a component, so the components they added
        are marked checked: a later turn is not required to make them
        reachable.

        Args:
          surface_ids: The surfaces of the messages the stream emitted that
            the state still holds.
        """
        self._closed = True
        self._state.mark_checked(surface_ids)

    def _feed(self, chunk: str) -> list[ResponsePart]:
        parts: list[ResponsePart] = []
        if not self._wrapped:
            self._block += chunk
            self._emit_ready(parts, len(self._block))
            return parts

        input_str = self._held + chunk
        self._held = ""
        if self._strip_close_backticks:
            if input_str.startswith("`"):
                input_str = input_str.lstrip("`")
            if input_str:
                self._strip_close_backticks = False

        if not self._in_block and self._held_backticks:
            if input_str:
                is_open_tag = bool(
                    OPEN_TAG_RE.match(input_str)
                    or OPEN_TAG_START_RE.match(input_str)
                    or (
                        input_str.startswith("<")
                        and "<a2ui-json".startswith(input_str.lower())
                    )
                )
                if is_open_tag:
                    self._held_backticks = ""
                else:
                    input_str = self._held_backticks + input_str
                    self._held_backticks = ""

        while input_str:
            if self._in_block:
                self._block += input_str
                input_str = ""
                close_start, readable_end = self._scanner.scan(self._block)
                if close_start is None:
                    self._emit_ready(parts, readable_end)
                    break
                close_match = CLOSE_TAG_RE.match(self._block, close_start)
                assert close_match is not None
                input_str = self._block[close_match.end() :]
                if input_str.startswith("`"):
                    input_str = input_str.lstrip("`")
                elif not input_str:
                    self._strip_close_backticks = True
                self._finish_block(parts, close_start)
                continue

            open_match = OPEN_TAG_RE.search(input_str)
            if open_match:
                text_before = input_str[: open_match.start()]
                if text_before.endswith("`"):
                    text_before = text_before.rstrip("`")
                self._emit_text(parts, text_before)
                self._run_started = False
                self._held_space = ""
                self._held_backticks = ""
                self._in_block = True
                input_str = input_str[open_match.end() :]
                continue

            hold = possible_tag_start(input_str)
            if hold < len(input_str):
                while hold > 0 and input_str[hold - 1] == "`":
                    hold -= 1
            text_to_emit = input_str[:hold]
            self._held = input_str[hold:]
            input_str = ""
            if not self._held:
                m = re.search(r"`+\Z", text_to_emit)
                if m:
                    self._held_backticks = m.group(0)
                    text_to_emit = text_to_emit[: m.start()]
            self._emit_text(parts, text_to_emit)

        return parts

    def _emit_text(self, parts: list[ResponsePart], text: str) -> None:
        body = (text if self._run_started else text.lstrip()).rstrip()
        if not body:
            if self._run_started:
                self._held_space += text
            return
        start = 0 if self._run_started else text.find(body)
        parts.append(TextPart(text=f"{self._held_space}{body}"))
        self._held_space = text[start + len(body) :]
        self._run_started = True

    def _read(self, end: int) -> list[tuple[Any, bool]] | None:
        """Reads the open block up to `end`, going on from the previous read.

        Returns:
          The block's messages, each with whether it has closed, or None while
          nothing but the start of a Markdown fence has arrived.
        """
        start = payload_start(self._block, end)
        if start is None:
            return None
        # The block only grows, so what earlier reads found holds while the
        # payload starts at the same place.
        if start != self._read_start:
            self._read_start = start
            self._read_cache = PartialReadCache()
        return read_partial_message_items(
            self._block,
            self._parser.progressive_keys,
            self._whole_item_keys,
            cache=self._read_cache,
            start=start,
            end=trailing_fence_start(self._block, start, end),
        )

    def _emit_ready(self, parts: list[ResponsePart], end: int) -> None:
        """Emits the messages of the open block that read and are new or changed."""
        envelopes = self._read(end)
        if not envelopes:
            return
        ready: list[AgentToRendererMessage] = []
        for index in range(self._done, len(envelopes)):
            if self._stalled:
                break
            envelope, closed = envelopes[index]
            if not isinstance(envelope, dict):
                break
            if not closed and not _may_grow(envelope):
                # Held until its object closes, or until it has something to
                # apply.
                break
            try:
                model = self._check(envelope, closed=closed)
            except A2uiError:
                if self._v10 and _has_closed_components(envelope):
                    # No later chunk can change it.
                    raise
                # Not ready. The block raises when it closes if it still is.
                self._stalled = closed
                break
            except Exception:
                break
            if model is not None:
                ready.append(model)
            if not closed:
                # Only the last message read so far can be open.
                break
            self._done = index + 1
            self._growing = None
        if ready:
            parts.append(A2uiPart(a2ui=ready))

    def _finish_block(self, parts: list[ResponsePart], end: int) -> None:
        """Applies the rest of a closed block and checks the surfaces it touched.

        The messages that closed while the block arrived were checked then,
        and the rest are checked here. The trees of the surfaces the block
        touched are checked last.

        The messages not emitted yet are emitted only if the checks pass, so
        a failed block leaves the state holding what was emitted.
        """
        messages = self._final_messages(end)
        ready: list[AgentToRendererMessage] = []
        with self._state.transaction():
            for envelope in messages[self._done :]:
                model = self._check(envelope, closed=True)
                if model is not None:
                    ready.append(model)
                self._growing = None
            self._state.check_topology(self._touched)
        if ready:
            parts.append(A2uiPart(a2ui=ready))
        self._in_block = not self._wrapped
        self._reset_block()

    def _final_messages(self, end: int) -> list[Any]:
        """The messages of the closed block that ends at `end`.

        The read goes on from where the reads of the open block stopped. A
        block that does not read as complete JSON is compiled whole, so that
        it raises as `compile` does.
        """
        block = self._block
        start = payload_start(block, end)
        if start is not None:
            stop = trailing_fence_start(block, start, end)
            if _LEADING_FENCE_RE.fullmatch(block, 0, start) and (
                _TRAILING_FENCE_RE.fullmatch(block, stop, end)
            ):
                envelopes = self._read(end)
                if (
                    envelopes
                    and self._read_cache.complete
                    and all(closed for _, closed in envelopes)
                ):
                    return [envelope for envelope, _ in envelopes]
        return to_message_dicts(self._parser.compile(block[:end]))

    def _check(self, envelope: Any, *, closed: bool) -> AgentToRendererMessage | None:
        """Applies the next message of the block, or what it gained.

        Args:
          envelope: The message as it reads now.
          closed: Whether its object has closed.

        Returns:
          The message to emit, or None if the renderer already holds it as it
          now stands.
        """
        growing = self._growing
        if growing is not None:
            rest = _rest_json(envelope, growing.key, growing.field)
            if rest == growing.rest:
                if growing.field == "components":
                    return self._check_added(growing, envelope)
                return self._check_grown(growing, envelope, closed=closed)
        self._apply(envelope)
        model = to_message_models([envelope])[0]
        self._growing = None
        key = _growing_key(envelope)
        if not closed and key is not None:
            field = _GROWING_FIELDS[key]
            body = envelope[key]
            rest = _rest_json(envelope, key, field)
            if rest is not None:
                growing = _Growing(key=key, field=field, rest=rest, model=model)
                if field == "components":
                    components = body[field]
                    growing.count = len(components)
                    if components:
                        growing.last_json = _json(components[-1])
                        growing.last_id = _component_id(components[-1])
                    growing.ids = {
                        i for i in map(_component_id, components) if i is not None
                    }
                else:
                    growing.value = body[field]
                self._growing = growing
        return model

    def _check_added(
        self, growing: _Growing, envelope: dict[str, Any]
    ) -> AgentToRendererMessage | None:
        """Applies the components a growing message gained since the last chunk.

        The components the state holds have closed, except the last one before
        v1.0, which is applied again if it has grown. Applying the added
        components over the ones applied before leaves the surface as applying
        the whole message would.
        """
        body = envelope[growing.key]
        components = body["components"]
        kept = min(growing.count, len(components))
        earlier = growing.ids
        if kept and _json(components[kept - 1]) != growing.last_json:
            kept -= 1
            earlier = earlier - {growing.last_id} if growing.last_id else earlier
        if kept == len(components):
            return None
        added = components[kept:]
        for component in added:
            component_id = _component_id(component)
            if component_id is not None and component_id in earlier:
                raise A2uiIntegrityError(
                    f"Duplicate component ID '{component_id}' in update payload."
                )
        delta = {**envelope, growing.key: {**body, "components": added}}
        self._apply(delta)
        delta_model = to_message_models([delta])[0]
        attr = _body_attr(delta_model, growing.key)
        held = getattr(growing.model, attr).components[:kept]
        delta_body = getattr(delta_model, attr)
        model = delta_model.model_copy(
            update={
                attr: delta_body.model_copy(
                    update={"components": [*held, *delta_body.components]}
                )
            }
        )
        growing.model = model
        growing.count = len(components)
        growing.last_json = _json(components[-1])
        growing.last_id = _component_id(components[-1])
        growing.ids = earlier | {i for i in map(_component_id, added) if i is not None}
        return model

    def _check_grown(
        self, growing: _Growing, envelope: dict[str, Any], *, closed: bool
    ) -> AgentToRendererMessage | None:
        """Emits a growing data model update again if its value changed.

        A data model value is not checked against a catalog, so nothing is
        checked while it grows. The message is applied again once it closes.
        """
        value = envelope[growing.key][growing.field]
        if closed:
            self._apply(envelope)
        if _same_json(value, growing.value):
            return None
        if growing.field == "value":
            attr = _body_attr(growing.model, growing.key)
            model = growing.model.model_copy(
                update={
                    attr: (
                        getattr(growing.model, attr).model_copy(update={"value": value})
                    )
                }
            )
        else:
            # v0.8 contents are typed entries, so they are read again whole.
            model = to_message_models([envelope])[0]
        growing.model = model
        growing.value = value
        return model

    def _apply(self, envelope: Any) -> None:
        touched = self._state.apply([envelope])
        self._touched.update(dict.fromkeys(touched))


def _growing_key(envelope: Mapping[str, Any]) -> str | None:
    """The key of a message a renderer applies again as it grows, or None."""
    for key in _GROWING_FIELDS:
        if key in envelope:
            return key
    return None


def _may_grow(envelope: Mapping[str, Any]) -> bool:
    """Whether a message still arriving may be applied and emitted already.

    It must be one a renderer applies again as it grows, and hold the field
    it grows by, with at least one component for a message that grows by its
    components.
    """
    key = _growing_key(envelope)
    if key is None:
        return False
    body = envelope[key]
    field = _GROWING_FIELDS[key]
    if not isinstance(body, Mapping) or field not in body:
        return False
    return field != "components" or bool(body[field])


def _rest_json(envelope: Any, key: str, field: str) -> str | None:
    """The JSON of a message without the field it grows by, or None."""
    if not isinstance(envelope, dict):
        return None
    body = envelope.get(key)
    if not isinstance(body, dict) or field not in body:
        return None
    if field == "components" and not isinstance(body[field], list):
        return None
    return _json({**envelope, key: {k: v for k, v in body.items() if k != field}})


def _json(value: Any) -> str:
    return json.dumps(value, sort_keys=True)


def _component_id(component: Any) -> str | None:
    if isinstance(component, Mapping):
        component_id = component.get("id")
        if isinstance(component_id, str):
            return component_id
    return None


def _body_attr(model: AgentToRendererMessage, key: str) -> str:
    """The name of the model field that holds a message's body."""
    for name, field in type(model).model_fields.items():
        if field.alias == key or name == key:
            return name
    raise KeyError(key)


def _same_json(a: Any, b: Any) -> bool:
    """Whether two JSON values are equal.

    A list or map that is the same object in both, as the reads of a stream
    return one that has closed, is not read.
    """
    if a is b:
        return True
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(map(_same_json, a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return len(a) == len(b) and all(
            k in b and _same_json(v, b[k]) for k, v in a.items()
        )
    return type(a) is type(b) and a == b


def _has_closed_components(envelope: Any) -> bool:
    """Whether a v1.0 `updateComponents` read so far has closed components.

    From v1.0 a component is read only once its object closes, and the
    version and surface id only once they are whole, so what such a message
    holds already is what it will hold.
    """
    if not isinstance(envelope, dict):
        return False
    body = envelope.get("updateComponents")
    return (
        isinstance(envelope.get("version"), str)
        and isinstance(body, dict)
        and isinstance(body.get("surfaceId"), str)
        and bool(body.get("components"))
    )
