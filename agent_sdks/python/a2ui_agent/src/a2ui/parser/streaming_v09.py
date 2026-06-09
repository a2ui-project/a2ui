# Copyright 2026 Google LLC
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

import re
import json
from typing import Any, List, Dict, Optional, Set

from .streaming import A2uiStreamParser
from .response_part import ResponsePart
from .constants import *
from ..schema.constants import VERSION_0_9, SURFACE_ID_KEY, CATALOG_COMPONENTS_KEY


class A2uiStreamParserV09(A2uiStreamParser):
  """Streaming parser implementation for A2UI v0.9 specification."""

  def __init__(self, catalog=None):
    super().__init__(catalog=catalog)
    # v0.9 default root is "root"
    self._default_root_id = DEFAULT_ROOT_ID

  @property
  def _placeholder_component(self) -> Dict[str, Any]:
    """Returns a v0.9 flat style placeholder component specification."""
    return {
        'component': 'Row',
        'children': [],
    }

  @property
  def _data_model_msg_type(self) -> str:
    """Returns the message type identifier for data model updates."""
    return MSG_TYPE_UPDATE_DATA_MODEL

  def is_protocol_msg(self, obj: Dict[str, Any]) -> bool:
    """Checks if the object is a recognized v0.9 message."""
    return any(
        k in obj
        for k in (
            MSG_TYPE_CREATE_SURFACE,
            MSG_TYPE_UPDATE_COMPONENTS,
            MSG_TYPE_UPDATE_DATA_MODEL,
        )
    )

  def _sniff_metadata(self):
    """Sniffs for v0.9 metadata in the json_buffer."""

    def get_latest_value(key: str) -> Optional[str]:
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

    if f'"{MSG_TYPE_CREATE_SURFACE}":' in self._json_buffer:
      self.add_msg_type(MSG_TYPE_CREATE_SURFACE)
    if f'"{MSG_TYPE_UPDATE_COMPONENTS}":' in self._json_buffer:
      self.add_msg_type(MSG_TYPE_UPDATE_COMPONENTS)
    if f'"{MSG_TYPE_UPDATE_DATA_MODEL}":' in self._json_buffer:
      self.add_msg_type(MSG_TYPE_UPDATE_DATA_MODEL)

  def _handle_complete_object(
      self,
      obj: Dict[str, Any],
      sid: Optional[str],
      messages: List[ResponsePart],
  ) -> bool:
    """Handles v0.9 specific complete objects."""
    if not isinstance(obj, dict):
      return False

    if self._validator:
      self._validator.validate(obj, root_id=sid, strict_integrity=False)

    # Update state based on the message content
    surface_id = obj.get(SURFACE_ID_KEY, self.surface_id)
    if MSG_TYPE_UPDATE_COMPONENTS in obj:
      val = obj[MSG_TYPE_UPDATE_COMPONENTS]
      if isinstance(val, dict):
        surface_id = val.get(SURFACE_ID_KEY) or surface_id
    elif MSG_TYPE_CREATE_SURFACE in obj:
      val = obj[MSG_TYPE_CREATE_SURFACE]
      if isinstance(val, dict):
        surface_id = val.get(SURFACE_ID_KEY) or surface_id

    self.surface_id = surface_id
    sid = self.surface_id or 'unknown'

    # v0.9 Specific Handling
    if MSG_TYPE_CREATE_SURFACE in obj:
      val = obj[MSG_TYPE_CREATE_SURFACE]
      if isinstance(val, dict):
        self.root_id = val.get('root', self.root_id or DEFAULT_ROOT_ID)
      self._buffered_start_message = obj

      # Yield createSurface immediately when it completes
      if sid not in self._yielded_start_messages:
        self._yield_messages([obj], messages)
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
      self._yield_messages([obj], messages)
      return True

    if MSG_TYPE_UPDATE_DATA_MODEL in obj:

      self.add_msg_type(MSG_TYPE_UPDATE_DATA_MODEL)
      self.update_data_model(obj[MSG_TYPE_UPDATE_DATA_MODEL], messages)
      self._yield_messages([obj], messages)
      return True

    return False

  def _construct_sniffed_data_model_message(
      self, active_msg_type: str, delta_msg_payload: Dict[str, Any]
  ) -> Dict[str, Any]:
    """Returns the message to yield for a partial data model update for v0.9."""
    return {'version': 'v0.9', active_msg_type: delta_msg_payload}

  def _sniff_partial_data_model(self, messages: List[ResponsePart]) -> None:
    """Sniffs for partial data model updates in v0.9 (value property)."""
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
        obj = json.loads(fixed_fragment)
      except json.JSONDecodeError:
        # Fallback: iteratively strip from the last comma
        trimmed = raw_fragment
        while ',' in trimmed:
          trimmed = trimmed.rsplit(',', 1)[0]
          try:
            fixed_trimmed = self._fix_json(trimmed)
            if fixed_trimmed:
              obj = json.loads(fixed_trimmed)
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
              sid = dm_obj.get(SURFACE_ID_KEY) or self._surface_id or 'default'
              delta_msg_payload = {
                  SURFACE_ID_KEY: sid,
                  'value': delta,
              }
              delta_msg = self._construct_sniffed_data_model_message(
                  msg_type, delta_msg_payload
              )
              self._yield_messages([delta_msg], messages, strict_integrity=False)
              # Do NOT update _yielded_data_model here, let update_data_model do it when complete
              # Wait! If we don't update it, will we over-yield it in the next chunk?
              # Yes, we might. So we should update it or track it!
              # The base class updates it (line 644 approx). So we should update it too!
              self._yielded_data_model.update(delta)

  def _construct_partial_message(
      self, processed_components: List[Dict[str, Any]], active_msg_type: str
  ) -> Dict[str, Any]:
    """Constructs a partial message for v0.9 (updateComponents)."""
    payload = {
        CATALOG_COMPONENTS_KEY: processed_components,
    }
    if self.surface_id:
      payload[SURFACE_ID_KEY] = self.surface_id
    return {'version': 'v0.9', MSG_TYPE_UPDATE_COMPONENTS: payload}

  @property
  def _yielded_surfaces_set(self) -> Set[str]:
    """Provides access to version-specific yielded surfaces set."""
    if not hasattr(self, '_yielded_create_surfaces'):
      self._yielded_create_surfaces: Set[str] = set()
    return self._yielded_create_surfaces

  def _get_active_msg_type_for_components(self) -> Optional[str]:
    """Determines which msg_type to use when wrapping component updates."""
    if self._active_msg_type:
      return self._active_msg_type
    for mt in self._msg_types:
      if mt in (MSG_TYPE_UPDATE_COMPONENTS, MSG_TYPE_CREATE_SURFACE):
        self._active_msg_type = mt
        return mt
    return self._msg_types[0] if self._msg_types else None

  def _deduplicate_data_model(self, m: Dict[str, Any], strict_integrity: bool) -> bool:
    if MSG_TYPE_UPDATE_DATA_MODEL in m:
      udm = m[MSG_TYPE_UPDATE_DATA_MODEL]
      if isinstance(udm, dict):
        is_new = False
        for k, v in udm.items():
          if k not in (SURFACE_ID_KEY, 'root') and self._yielded_data_model.get(k) != v:
            is_new = True
            break
        if not is_new and strict_integrity:
          return False
        # Update yielded model
        for k, v in udm.items():
          if k not in (SURFACE_ID_KEY, 'root'):
            self._yielded_data_model[k] = v
    return True
