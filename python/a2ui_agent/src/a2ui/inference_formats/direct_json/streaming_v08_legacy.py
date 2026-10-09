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
import re
from typing import Any

from a2ui.core import CatalogApi, RELAXED_VALIDATION
from a2ui.inference_formats.direct_json.streaming import DirectJsonStreamParser
from a2ui.parser import ResponsePart
from a2ui.parser.constants import (
    DEFAULT_ROOT_ID,
    MSG_TYPE_BEGIN_RENDERING,
    MSG_TYPE_DATA_MODEL_UPDATE,
    MSG_TYPE_DELETE_SURFACE,
    MSG_TYPE_SURFACE_UPDATE,
)
from a2ui.schema import CATALOG_COMPONENTS_KEY
from a2ui.schema.constants import DEFAULT_PROGRESSIVE_KEYS, SURFACE_ID_KEY


class DirectJsonStreamParserV08Legacy(DirectJsonStreamParser):
    """Streaming parser implementation for the legacy A2UI v0.8 specification."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        *,
        progressive_keys: frozenset[str] = DEFAULT_PROGRESSIVE_KEYS,
    ):
        """Initializes the v0.8 streaming parser.

        `DirectJsonStreamParser(catalogs)` builds this parser for v0.8 and then
        runs its `__init__` with the same arguments, so it takes the same
        sequence as the other parsers.

        Args:
            catalogs: The catalogs that components are parsed and validated
                against.
            progressive_keys: Keys whose string values can be safely auto-closed
                (healed) when cut in the stream. An empty set turns healing off.

        Raises:
            A2uiCatalogError: If no catalog is given, or the catalogs target
                different protocol versions.
        """
        super().__init__(
            catalogs=catalogs,
            progressive_keys=progressive_keys,
        )
        self._yielded_begin_rendering_surfaces: set[str] = set()

    @property
    def _placeholder_component(self) -> dict[str, Any]:
        """Returns the placeholder component."""
        return {
            'component': {
                'Row': {
                    'children': {'explicitList': []},
                }
            }
        }

    @property
    def _yielded_surfaces_set(self) -> set[str]:
        """Provides access to version-specific yielded surfaces set."""
        return self._yielded_begin_rendering_surfaces

    @property
    def _data_model_msg_type(self) -> str:
        """Returns the message type identifier for data model updates."""
        return MSG_TYPE_DATA_MODEL_UPDATE

    def _sniff_metadata(self) -> None:
        """Sniffs for v0.8 metadata in the json_buffer."""

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

        if f'"{MSG_TYPE_BEGIN_RENDERING}":' in self._json_buffer:
            self.add_msg_type(MSG_TYPE_BEGIN_RENDERING)
        if f'"{MSG_TYPE_SURFACE_UPDATE}":' in self._json_buffer:
            self.add_msg_type(MSG_TYPE_SURFACE_UPDATE)
        if f'"{MSG_TYPE_DATA_MODEL_UPDATE}":' in self._json_buffer:
            self.add_msg_type(MSG_TYPE_DATA_MODEL_UPDATE)
        if f'"{MSG_TYPE_DELETE_SURFACE}":' in self._json_buffer:
            self.add_msg_type(MSG_TYPE_DELETE_SURFACE)

    def _handle_complete_object(
        self,
        obj: dict[str, Any],
        sid: str | None,
        messages: list[ResponsePart],
    ) -> bool:
        """Handles v0.8 specific complete objects."""
        if not isinstance(obj, dict):
            return False

        self._validate_message(obj)

        # Update state based on the message content
        surface_id = obj.get(SURFACE_ID_KEY, self.surface_id)
        if MSG_TYPE_SURFACE_UPDATE in obj:
            val = obj[MSG_TYPE_SURFACE_UPDATE]
            if isinstance(val, dict):
                surface_id = val.get(SURFACE_ID_KEY) or surface_id
        elif MSG_TYPE_BEGIN_RENDERING in obj:
            val = obj[MSG_TYPE_BEGIN_RENDERING]
            if isinstance(val, dict):
                surface_id = val.get(SURFACE_ID_KEY) or surface_id
        elif MSG_TYPE_DATA_MODEL_UPDATE in obj:
            val = obj[MSG_TYPE_DATA_MODEL_UPDATE]
            if isinstance(val, dict):
                surface_id = val.get(SURFACE_ID_KEY) or surface_id
        elif MSG_TYPE_DELETE_SURFACE in obj:
            val = obj[MSG_TYPE_DELETE_SURFACE]
            if isinstance(val, str):
                surface_id = val
            elif isinstance(val, dict):
                surface_id = val.get(SURFACE_ID_KEY) or surface_id

        self.surface_id = surface_id
        sid = self.surface_id or 'unknown'

        if MSG_TYPE_DELETE_SURFACE in obj:
            if (
                sid not in self._yielded_surfaces_set
                and not self._buffered_start_message
            ):
                self._pending_messages.setdefault(sid, []).append(obj)
                return True
            self.add_msg_type(MSG_TYPE_DELETE_SURFACE)
            self._yield_messages([obj], messages, config=RELAXED_VALIDATION)
            self._delete_surface(sid)
            return True
        else:
            # v0.8 has no createSurface, so any other message for a deleted
            # surface starts it over.
            self._deleted_surfaces.discard(sid)

        if sid in self._deleted_surfaces:
            return True

        if (
            MSG_TYPE_SURFACE_UPDATE in obj
            and sid not in self._yielded_surfaces_set
            and not self._buffered_start_message
        ):
            if sid not in self._pending_messages:
                self._pending_messages[sid] = []
            self._pending_messages[sid].append(obj)
            return True

        if MSG_TYPE_BEGIN_RENDERING in obj:
            br_val = obj[MSG_TYPE_BEGIN_RENDERING]
            if isinstance(br_val, dict):
                self._record_surface_catalog(sid, br_val)
                self.root_id = br_val.get('root', self.root_id or DEFAULT_ROOT_ID)

            # Yield beginRendering immediately when it completes
            if sid not in self._yielded_start_messages:
                self._yield_messages([obj], messages, config=RELAXED_VALIDATION)
                self._yielded_start_messages.add(sid)
                self._yielded_surfaces_set.add(sid)
            self._buffered_start_message = None

            if sid in self._pending_messages:
                pending_list = self._pending_messages.pop(sid)
                for pending_msg in pending_list:
                    if MSG_TYPE_DELETE_SURFACE in pending_msg:
                        continue
                    self._handle_complete_object(pending_msg, sid, messages)

            self.yield_reachable(messages)
            return True

        if MSG_TYPE_SURFACE_UPDATE in obj:
            self.add_msg_type(MSG_TYPE_SURFACE_UPDATE)
            components = obj[MSG_TYPE_SURFACE_UPDATE].get('components', [])
            for comp in components:
                if isinstance(comp, dict) and 'id' in comp:
                    self._seen_components[comp['id']] = comp
            self.yield_reachable(messages, check_root=True, raise_on_orphans=False)
            return True

        if MSG_TYPE_DATA_MODEL_UPDATE in obj:
            self.add_msg_type(MSG_TYPE_DATA_MODEL_UPDATE)
            self.update_data_model(obj[MSG_TYPE_DATA_MODEL_UPDATE], messages)
            self._yield_messages([obj], messages, config=RELAXED_VALIDATION)
            self.yield_reachable(messages, check_root=False, raise_on_orphans=False)
            return True

        # If unknown, let base class yield it or yield it here
        self._yield_messages([obj], messages, config=RELAXED_VALIDATION)
        return True

    def _construct_partial_message(
        self, processed_components: list[dict[str, Any]], active_msg_type: str
    ) -> dict[str, Any]:
        """Constructs a partial message for v0.8 (always surfaceUpdate)."""
        payload = {
            SURFACE_ID_KEY: self.surface_id,
            CATALOG_COMPONENTS_KEY: processed_components,
        }
        return {MSG_TYPE_SURFACE_UPDATE: payload}

    def _get_active_msg_type_for_components(self) -> str | None:
        """Determines which msg_type to use when wrapping component updates."""
        if self._active_msg_type:
            return self._active_msg_type
        for mt in self._msg_types:
            if mt in (MSG_TYPE_SURFACE_UPDATE, MSG_TYPE_BEGIN_RENDERING):
                self._active_msg_type = mt
                return mt
        return self._msg_types[0] if self._msg_types else None

    def _deduplicate_data_model(self, m: dict[str, Any]) -> bool:
        if MSG_TYPE_DATA_MODEL_UPDATE in m:
            dm = m[MSG_TYPE_DATA_MODEL_UPDATE]
            raw_contents = dm.get('contents', {})
            contents_dict = {}
            if isinstance(raw_contents, list):
                for entry in raw_contents:
                    if isinstance(entry, dict) and 'key' in entry:
                        key = entry['key']
                        val = (
                            entry.get('valueString')
                            or entry.get('valueNumber')
                            or entry.get('valueBoolean')
                            or entry.get('valueMap')
                        )
                        if key and val is not None:
                            contents_dict[key] = val
            elif isinstance(raw_contents, dict):
                contents_dict = raw_contents

            if contents_dict:
                is_new = False
                for k, v in contents_dict.items():
                    if self._yielded_data_model.get(k) != v:
                        is_new = True
                        break
                if not is_new:
                    return False
                self._yielded_data_model.update(contents_dict)
        return True
