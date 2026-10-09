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

from __future__ import annotations

from collections.abc import Sequence
import json
import re
from typing import Any

from a2ui.core import CatalogApi, RELAXED_VALIDATION
from a2ui.core.common import is_at_least_version, to_protocol_version
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats.direct_json.streaming import DirectJsonStreamParser
from a2ui.parser import ResponsePart
from a2ui.parser.constants import (
    DEFAULT_ROOT_ID,
    MSG_TYPE_AGENT_FUNCTION_RESPONSE,
    MSG_TYPE_CALL_RENDERER_FUNCTION,
    MSG_TYPE_CREATE_SURFACE,
    MSG_TYPE_DELETE_SURFACE,
    MSG_TYPE_UPDATE_COMPONENTS,
    MSG_TYPE_UPDATE_DATA_MODEL,
)
from a2ui.schema import CATALOG_COMPONENTS_KEY
from a2ui.schema.constants import DEFAULT_PROGRESSIVE_KEYS, SURFACE_ID_KEY


class DirectJsonStreamParserModern(DirectJsonStreamParser):
    """Streaming parser implementation for A2UI v0.9 and later specifications."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        *,
        progressive_keys: frozenset[str] = DEFAULT_PROGRESSIVE_KEYS,
    ):
        super().__init__(
            catalogs=catalogs,
            progressive_keys=progressive_keys,
        )
        # Default root is "root"
        self._default_root_id = DEFAULT_ROOT_ID
        self._seen_version: str | None = None

    @property
    def _passthrough_msg_types(self) -> tuple[str, ...]:
        """Message types beyond surface and data updates that pass through."""
        if is_at_least_version(
            to_protocol_version(self._version), ProtocolVersion.V1_0
        ):
            return (
                MSG_TYPE_CALL_RENDERER_FUNCTION,
                MSG_TYPE_AGENT_FUNCTION_RESPONSE,
            )
        return ()

    @property
    def _buffers_incomplete_components(self) -> bool:
        """Whether a component is held back until its JSON object closes.

        From v1.0, a component may name its own `catalogId`, and the key can
        arrive after the type and properties. A component yielded before it
        closes would be resolved against its surface's catalog, which can be
        the wrong one.
        """
        return is_at_least_version(
            to_protocol_version(self._version), ProtocolVersion.V1_0
        )

    @property
    def _message_version(self) -> str:
        """The `version` string that synthesized messages carry."""
        return self._seen_version or f'v{self._version}'

    @property
    def _placeholder_component(self) -> dict[str, Any]:
        """Returns a flat style placeholder component specification."""
        return {
            'component': 'Row',
            'children': [],
        }

    @property
    def _data_model_msg_type(self) -> str:
        """Returns the message type identifier for data model updates."""
        return MSG_TYPE_UPDATE_DATA_MODEL

    def _open_create_surface_top_level(self) -> str | None:
        """Returns the top-level text of an unclosed `createSurface` body, if any."""
        marker = f'"{MSG_TYPE_CREATE_SURFACE}"'
        cs_idx = self._json_buffer.rfind(marker)
        if cs_idx == -1:
            return None
        rest = self._json_buffer[cs_idx + len(marker) :]
        colon_match = re.match(r'\s*:\s*\{', rest)
        if not colon_match:
            return None

        top_level: list[str] = []
        depth = 1
        in_string = False
        escaped = False
        for ch in rest[colon_match.end() :]:
            if escaped:
                if depth == 1:
                    top_level.append(ch)
                escaped = False
                continue
            if ch == '\\' and in_string:
                if depth == 1:
                    top_level.append(ch)
                escaped = True
                continue
            if ch == '"':
                in_string = not in_string
                if depth == 1:
                    top_level.append(ch)
                continue
            if not in_string:
                if ch in ('{', '['):
                    depth += 1
                    continue
                if ch in ('}', ']'):
                    depth -= 1
                    if depth == 0:
                        return None
                    continue
            if depth == 1:
                top_level.append(ch)
        return ''.join(top_level)

    def _sniff_metadata(self) -> None:
        """Sniffs for metadata in the json_buffer."""

        def get_latest_value(key: str) -> str | None:
            idx = len(self._json_buffer)
            while True:
                idx = self._json_buffer.rfind(f'"{key}"', 0, idx)
                if idx == -1:
                    return None
                match = re.match(rf'"{key}"\s*:\s*"([^"]+)"', self._json_buffer[idx:])
                if match:
                    return match.group(1)

        self.surface_id = get_latest_value('surfaceId')

        parsed_root = get_latest_value('root')
        if parsed_root is not None:
            self.root_id = parsed_root

        cs_top_level = self._open_create_surface_top_level()
        if cs_top_level is not None:
            surface_match = re.search(r'"surfaceId"\s*:\s*"([^"]+)"', cs_top_level)
            catalog_match = re.search(r'"catalogId"\s*:\s*"([^"]+)"', cs_top_level)
            if surface_match:
                if catalog_match:
                    self._surface_catalog_ids[surface_match.group(1)] = (
                        catalog_match.group(1)
                    )
                else:
                    self._surface_catalog_ids.pop(surface_match.group(1), None)

        for msg_type in (
            MSG_TYPE_CREATE_SURFACE,
            MSG_TYPE_UPDATE_COMPONENTS,
            MSG_TYPE_UPDATE_DATA_MODEL,
            *self._passthrough_msg_types,
        ):
            if f'"{msg_type}":' in self._json_buffer:
                self.add_msg_type(msg_type)

    def _handle_complete_object(
        self,
        obj: dict[str, Any],
        sid: str | None,
        messages: list[ResponsePart],
    ) -> bool:
        """Handles complete protocol message objects for v0.9 and later."""
        if not isinstance(obj, dict):
            return False

        self._validate_message(obj)
        if isinstance(obj.get('version'), str):
            self._seen_version = obj['version']

        # Update state based on the message content
        surface_id = obj.get(SURFACE_ID_KEY, self.surface_id)
        for msg_type in (
            MSG_TYPE_CREATE_SURFACE,
            MSG_TYPE_UPDATE_COMPONENTS,
            MSG_TYPE_UPDATE_DATA_MODEL,
            MSG_TYPE_DELETE_SURFACE,
        ):
            if msg_type in obj:
                val = obj[msg_type]
                if isinstance(val, dict):
                    surface_id = val.get(SURFACE_ID_KEY) or surface_id
                break

        self.surface_id = surface_id
        sid = self.surface_id or 'unknown'

        if MSG_TYPE_CREATE_SURFACE in obj:
            self._deleted_surfaces.discard(sid)
            val = obj[MSG_TYPE_CREATE_SURFACE]
            if isinstance(val, dict):
                self._record_surface_catalog(sid, val)
                self.root_id = val.get('root', self.root_id or DEFAULT_ROOT_ID)
                self._record_inline_components(sid, val.get('components'))

            # Yield createSurface immediately when it completes
            if sid not in self._yielded_start_messages:
                self._yield_messages([obj], messages, config=RELAXED_VALIDATION)
                self._yielded_start_messages.add(sid)
                self._yielded_surfaces_set.add(sid)
            self._buffered_start_message = None

            if sid in self._pending_messages:
                # Clear pending messages when createSurface arrives, we want a fresh start!
                self._pending_messages.pop(sid)

            self.yield_reachable(messages)
            return True

        if MSG_TYPE_UPDATE_COMPONENTS in obj:
            self.add_msg_type(MSG_TYPE_UPDATE_COMPONENTS)
            self.root_id = obj[MSG_TYPE_UPDATE_COMPONENTS].get(
                'root', self.root_id or DEFAULT_ROOT_ID
            )
            components = obj[MSG_TYPE_UPDATE_COMPONENTS].get('components', [])
            for comp in components:
                if isinstance(comp, dict) and 'id' in comp:
                    self._seen_components[comp['id']] = comp
            self.yield_reachable(messages, check_root=True, raise_on_orphans=False)
            return True

        if MSG_TYPE_DELETE_SURFACE in obj:
            if sid not in self._yielded_start_messages:
                self._pending_messages.setdefault(sid, []).append(obj)
                return True
            self.add_msg_type(MSG_TYPE_DELETE_SURFACE)
            self._yield_messages([obj], messages, config=RELAXED_VALIDATION)
            self._delete_surface(sid)
            return True

        if MSG_TYPE_UPDATE_DATA_MODEL in obj:

            self.add_msg_type(MSG_TYPE_UPDATE_DATA_MODEL)
            self.update_data_model(obj[MSG_TYPE_UPDATE_DATA_MODEL], messages)
            self._yield_messages([obj], messages, config=RELAXED_VALIDATION)
            return True

        for msg_type in self._passthrough_msg_types:
            if msg_type in obj:
                self.add_msg_type(msg_type)
                self._yield_messages([obj], messages, config=RELAXED_VALIDATION)
                return True

        return False

    def _construct_sniffed_data_model_message(
        self, active_msg_type: str, delta_msg_payload: dict[str, Any]
    ) -> dict[str, Any]:
        """Returns the message to yield for a partial data model update."""
        return {'version': self._message_version, active_msg_type: delta_msg_payload}

    def _sniff_partial_data_model(self, messages: list[ResponsePart]) -> None:
        """Sniffs for partial data model updates (value property)."""
        msg_type = MSG_TYPE_UPDATE_DATA_MODEL
        if f'"{msg_type}"' not in self._json_buffer:
            return

        for b_type, start_idx in reversed(self._brace_stack):
            if b_type != '{':
                continue
            raw_fragment = self._json_buffer[start_idx:]
            if not raw_fragment:
                continue

            fixed_fragment = self._fix_json(raw_fragment)
            obj = None
            try:
                obj = json.loads(fixed_fragment, strict=False)
            except json.JSONDecodeError:
                # Fallback: iteratively strip from the last comma
                trimmed = raw_fragment
                while ',' in trimmed:
                    trimmed = trimmed.rsplit(',', 1)[0]
                    try:
                        fixed_trimmed = self._fix_json(trimmed)
                        if fixed_trimmed:
                            obj = json.loads(fixed_trimmed, strict=False)
                            break
                    except json.JSONDecodeError:
                        continue

            if obj and isinstance(obj, dict) and msg_type in obj:

                dm_obj = obj[msg_type]
                if isinstance(dm_obj, dict) and 'value' in dm_obj:
                    value_map = dm_obj['value']
                    if isinstance(value_map, dict):
                        # Find delta against yielded data model
                        delta = {}
                        for k, v in value_map.items():
                            if self._yielded_data_model.get(k) != v:
                                delta[k] = v

                        if delta:
                            sid = (
                                dm_obj.get(SURFACE_ID_KEY)
                                or self._surface_id
                                or 'default'
                            )
                            delta_msg_payload = {
                                SURFACE_ID_KEY: sid,
                                'value': delta,
                            }
                            delta_msg = self._construct_sniffed_data_model_message(
                                msg_type, delta_msg_payload
                            )
                            self._yield_messages(
                                [delta_msg], messages, config=RELAXED_VALIDATION
                            )
                            self._yielded_data_model.update(delta)

    def _record_inline_components(self, sid: str, components: Any) -> None:
        """Records inline components from createSurface as already yielded."""
        if not isinstance(components, list):
            return
        seen_components = self._components_by_surface.setdefault(sid, {})
        for comp in components:
            if isinstance(comp, dict) and 'id' in comp:
                cid = comp['id']
                seen_components[cid] = comp
                self._yielded_ids.setdefault(sid, set()).add(cid)
                self._yielded_contents[(sid, cid)] = json.dumps(comp, sort_keys=True)

    def _construct_partial_message(
        self, processed_components: list[dict[str, Any]], active_msg_type: str
    ) -> dict[str, Any]:
        """Constructs a partial message for v0.9 and later (updateComponents)."""
        payload: dict[str, Any] = {
            CATALOG_COMPONENTS_KEY: processed_components,
        }
        if self.surface_id:
            payload[SURFACE_ID_KEY] = self.surface_id
        return {
            'version': self._message_version,
            MSG_TYPE_UPDATE_COMPONENTS: payload,
        }

    @property
    def _yielded_surfaces_set(self) -> set[str]:
        """Provides access to version-specific yielded surfaces set."""
        if not hasattr(self, '_yielded_create_surfaces'):
            self._yielded_create_surfaces: set[str] = set()
        return self._yielded_create_surfaces

    def _get_active_msg_type_for_components(self) -> str | None:
        """Determines which msg_type to use when wrapping component updates."""
        if self._active_msg_type:
            return self._active_msg_type
        for mt in self._msg_types:
            if mt in (MSG_TYPE_UPDATE_COMPONENTS, MSG_TYPE_CREATE_SURFACE):
                self._active_msg_type = mt
                return mt
        return self._msg_types[0] if self._msg_types else None

    def _deduplicate_data_model(self, m: dict[str, Any]) -> bool:
        if MSG_TYPE_UPDATE_DATA_MODEL in m:
            udm = m[MSG_TYPE_UPDATE_DATA_MODEL]
            if isinstance(udm, dict):
                is_new = False
                for k, v in udm.items():
                    if (
                        k not in (SURFACE_ID_KEY, 'root')
                        and self._yielded_data_model.get(k) != v
                    ):
                        is_new = True
                        break
                if not is_new:
                    return False
                # Update yielded model
                for k, v in udm.items():
                    if k not in (SURFACE_ID_KEY, 'root'):
                        self._yielded_data_model[k] = v
        return True
