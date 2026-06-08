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

import copy
import json
import logging
import re
from typing import Any, List, Dict, Optional, Set, TYPE_CHECKING

from .constants import *
from ..schema.constants import (
    VERSION_0_9,
    VERSION_0_8,
    A2UI_OPEN_TAG,
    A2UI_CLOSE_TAG,
    SURFACE_ID_KEY,
    CATALOG_COMPONENTS_KEY,
)
from ..schema.validator import (
    analyze_topology,
    extract_component_ref_fields,
    extract_component_required_fields,
)
from .response_part import ResponsePart


if TYPE_CHECKING:
  from ..schema.catalog import A2uiCatalog

logger = logging.getLogger(__name__)


# Keys whose string values can be safely auto-closed (healed) if fragmented in the stream.
# Structural or atomic keys (e.g., id, surfaceId, path) are NOT cuttable to prevent
# incorrect parsing or data binding.
CUTTABLE_KEYS = {
    "literalString",
    "valueString",
    "label",
    "hint",
    "caption",
    "altText",
    "text",
}


class A2uiStreamParser:
  """Parses a stream of text for A2UI JSON messages with fine-grained component yielding.

  This class acts as a factory that returns a version-specific parser instance
  (V08 or V09) depending on the catalog version.
  """

  def __new__(cls, catalog: "A2uiCatalog" = None, *args, **kwargs):
    if cls is A2uiStreamParser:
      version = getattr(catalog, "version", None) if catalog else None
      if version == VERSION_0_9:
        from .streaming_v09 import A2uiStreamParserV09

        return A2uiStreamParserV09(catalog=catalog, *args, **kwargs)
      else:
        from .streaming_v08 import A2uiStreamParserV08

        return A2uiStreamParserV08(catalog=catalog, *args, **kwargs)
    return super().__new__(cls)

  def __init__(self, catalog: "A2uiCatalog" = None):
    self._version = getattr(catalog, "version", None) if catalog else None
    self._ref_fields_map = extract_component_ref_fields(catalog) if catalog else {}
    self._required_fields_map = (
        extract_component_required_fields(catalog) if catalog else {}
    )
    from ..schema.validator import A2uiValidator

    self._validator = A2uiValidator(catalog) if catalog else None

    self._found_delimiter = False
    self._buffer = ""
    self._json_buffer = ""
    self._brace_stack: List[Tuple[str, int]] = []
    self._brace_count = 0
    self._in_top_level_list = False
    self._in_string = False
    self._string_escaped = False

    self._seen_components: Dict[str, Dict[str, Any]] = {}

    # Track data model for path resolution
    self._yielded_data_model: Dict[str, Any] = {}
    self._deleted_surfaces: Set[str] = set()

    # Set of unique component IDs yielded per surface to prevent duplicate yielding
    # surfaceId -> set of cids
    self._yielded_ids: Dict[str, Set[str]] = {}
    # (surfaceId, cid) -> hash of content for change detection
    self._yielded_contents: Dict[Any, str] = {}

    self._root_ids: Dict[str, str] = {}  # The root component IDs mapped per surface
    self._default_root_id: Optional[str] = None  # Base default root ID for the protocol
    self._unbound_root_id: Optional[str] = (
        None  # Temporary holding variable for when root arrives before surfaceId
    )
    self._surface_id: Optional[str] = None  # The active surface ID tracking the context
    self._msg_types: List[str] = []  # Running list of message types seen in the block

    # A set of surface ids for which we have already yielded a start message
    # Tracks if beginRendering or createSurface was emitted
    self._yielded_start_messages: Set[str] = set()

    # The current active message type for component grouping
    self._active_msg_type: Optional[str] = None

    # State for buffering updates until surface is ready
    self._pending_messages: Dict[str, List[Dict[str, Any]]] = (
        {}
    )  # surfaceId -> list of msgs delayed until start message arrives
    self._buffered_start_message: Optional[Dict[str, Any]] = (
        None  # The start message to yield before any components
    )
    self._topology_dirty = False  # Set to true if components are added out of order
    self._in_top_level_list = False
    self._found_valid_json_in_block = False

  @property
  def _placeholder_component(self) -> Dict[str, Any]:
    """Returns the version-specific placeholder component.

    This is used when a component references a child component that hasn't yet
    streamed in. The placeholder component is added to the components list and
    the reference is updated to point to the placeholder component.
    """
    raise NotImplementedError("Subclasses must implement _placeholder_component")

  @property
  def surface_id(self) -> Optional[str]:
    return self._surface_id

  @surface_id.setter
  def surface_id(self, value: Optional[str]):
    self._surface_id = value
    if value is not None and self._unbound_root_id is not None:
      self._root_ids[value] = self._unbound_root_id
      self._unbound_root_id = None

  @property
  def root_id(self) -> Optional[str]:
    if self._surface_id:
      return self._root_ids.get(self._surface_id, self._default_root_id)
    # Return unbound root ID if explicitly sniffed, otherwise use protocol default
    return (
        self._unbound_root_id
        if self._unbound_root_id is not None
        else self._default_root_id
    )

  @root_id.setter
  def root_id(self, value: Optional[str]):
    if self._surface_id:
      if value is not None:
        self._root_ids[self._surface_id] = value
      else:
        self._root_ids.pop(self._surface_id, None)
    else:
      self._unbound_root_id = value

  @property
  def msg_types(self) -> List[str]:
    return self._msg_types

  def add_msg_type(self, msg_type: str):
    if msg_type not in self._msg_types:
      self._msg_types.append(msg_type)
    if msg_type in (
        MSG_TYPE_SURFACE_UPDATE,
        MSG_TYPE_UPDATE_COMPONENTS,
        MSG_TYPE_CREATE_SURFACE,
    ):
      self._active_msg_type = msg_type

  @property
  def _yielded_surfaces_set(self) -> Set[str]:
    """Provides access to version-specific yielded surfaces set."""
    raise NotImplementedError("Subclasses must implement _yielded_surfaces_set")

  def is_protocol_msg(self, obj: Dict[str, Any]) -> bool:
    """Checks if the object is a recognized A2UI message for this version."""
    raise NotImplementedError("Subclasses must implement is_protocol_msg")

  @property
  def _data_model_msg_type(self) -> str:
    """Returns the message type identifier for data model updates."""
    raise NotImplementedError("Subclasses must implement _data_model_msg_type")

  def _get_active_msg_type_for_components(self) -> Optional[str]:
    """Determines which msg_type to use when wrapping component updates."""
    raise NotImplementedError(
        "Subclasses must implement _get_active_msg_type_for_components"
    )

  def _deduplicate_data_model(self, m: Dict[str, Any], strict_integrity: bool) -> bool:
    """Returns True if message should be yielded, False if skipped."""
    return True

  def _yield_messages(
      self,
      messages_to_yield: List[Dict[str, Any]],
      messages: List[ResponsePart],
      strict_integrity: bool = True,
  ):
    """Validates and appends messages to the final output list."""
    for m in messages_to_yield:
      if not self._deduplicate_data_model(m, strict_integrity):
        continue

      # Each surface update message must specify a surfaceId and satisfy catalog validation.
      if self._validator:
        try:
          self._validator.validate(
              m, root_id=self.root_id, strict_integrity=strict_integrity
          )
        except ValueError as e:
          if strict_integrity:
            raise e
          else:
            logger.debug(f"Validation failed for partial/sniffed message: {e}")
            continue

      # Consolidated appending logic
      if messages and messages[-1].a2ui_json is None:
        messages[-1].a2ui_json = [m]
      elif messages and isinstance(messages[-1].a2ui_json, list):
        messages[-1].a2ui_json.append(m)
      else:
        messages.append(ResponsePart(a2ui_json=[m]))

  def _delete_surface(self, sid: str) -> None:
    """Clears all state related to a specific surface."""
    self._pending_messages.pop(sid, None)
    self._yielded_ids.pop(sid, None)

    # Clear contents for this surface
    self._yielded_contents = {
        k: v for k, v in self._yielded_contents.items() if k[0] != sid
    }
    self._yielded_surfaces_set.discard(sid)
    self._yielded_start_messages.discard(sid)

    self._deleted_surfaces.add(sid)

  def process_chunk(self, chunk: str) -> List[ResponsePart]:
    """Processes a chunk of text and returns any complete A2UI messages found.

    This is the primary entry point for the streaming parser. It handles the
    initial "tag hunt" and then delegates JSON fragment processing to
    `_process_json_chunk`. It supports multiple A2UI blocks in a single stream.

    Args:
        chunk: The chunk of raw text (e.g., from an LLM stream) to process.

    Returns:
        A list of parsed A2UI message dictionaries.
    """
    messages = []
    self._buffer += chunk

    while True:
      if not self._found_delimiter:
        # Looking for <a2ui-json>
        if A2UI_OPEN_TAG in self._buffer:
          parts = self._buffer.split(A2UI_OPEN_TAG, 1)
          if parts[0]:
            messages.append(ResponsePart(text=parts[0]))
          self._found_delimiter = True
          self._buffer = parts[1]
          # Continue to process the content after the open tag
        else:
          # Yield conversational text while avoiding split tags
          keep_len = 0
          for i in range(len(A2UI_OPEN_TAG) - 1, 0, -1):
            if self._buffer.endswith(A2UI_OPEN_TAG[:i]):
              keep_len = i
              break

          if len(self._buffer) > keep_len:
            safe_to_yield = len(self._buffer) - keep_len
            text_to_yield = self._buffer[:safe_to_yield]
            messages.append(ResponsePart(text=text_to_yield))
            self._buffer = self._buffer[safe_to_yield:]
          break

      if self._found_delimiter:
        # Looking for </a2ui-json>
        if A2UI_CLOSE_TAG in self._buffer:
          parts = self._buffer.split(A2UI_CLOSE_TAG, 1)
          json_fragment = parts[0]
          self._process_json_chunk(json_fragment, messages)
          if not self._found_valid_json_in_block:
            raise ValueError(
                "Failed to parse JSON: No valid JSON object found in A2UI block."
            )

          # End of block: reset JSON state but keep seen_components
          self._found_delimiter = False
          self._reset_json_state()

          self._buffer = parts[1]
          # Continue loop to look for next A2UI_OPEN_TAG in remaining buffer
        else:
          # Find if the buffer ends with a prefix of A2UI_CLOSE_TAG
          # To avoid split-tag issues, we only delay processing if it looks like a close tag is starting
          keep_len = 0
          for i in range(1, len(A2UI_CLOSE_TAG)):
            if self._buffer.endswith(A2UI_CLOSE_TAG[:i]):
              keep_len = i

          if keep_len < len(self._buffer):
            to_process = self._buffer[: len(self._buffer) - keep_len]
            self._buffer = self._buffer[len(self._buffer) - keep_len :]
            self._process_json_chunk(to_process, messages)
          break

    # Deduplicate surfaceUpdate messages to avoid over-yielding in a single chunk
    for part in messages:
      if not part.a2ui_json:
        continue

      deduped_msgs = []
      seen_su = set()
      # Iterate backwards to keep only the last (most complete) surfaceUpdate for each surface
      for m in reversed(part.a2ui_json):
        is_su = False
        sid = None
        if isinstance(m, dict) and MSG_TYPE_SURFACE_UPDATE in m:
          is_su = True
          sid = m[MSG_TYPE_SURFACE_UPDATE].get(SURFACE_ID_KEY)

        if is_su and sid:
          if sid not in seen_su:
            deduped_msgs.append(m)
            seen_su.add(sid)
        else:
          deduped_msgs.append(m)

      deduped_msgs.reverse()
      part.a2ui_json = deduped_msgs

    if messages:
      logger.debug(
          f"DEBUG: process_chunk returning {len(messages)} messages: {messages}"
      )
    return messages

  def _reset_json_state(self):
    """Resets the JSON-specific parsing state (e.g., at the end of a block)."""
    self._json_buffer = ""
    self._brace_stack = []
    self._brace_count = 0
    self._in_top_level_list = False
    self._in_string = False
    self._string_escaped = False
    self._msg_types = []
    self._found_valid_json_in_block = False
    # Note: we do NOT reset _active_msg_type or _yielded_contents here

    # so re-yielding works between blocks

  def _fix_json(self, fragment: str) -> str:
    """Attempts to fix a partial JSON fragment by adding missing closing delimiters."""
    fixed = fragment.rstrip()
    if not fixed:
      return ""

    stack = []
    in_string = False
    escaped = False
    last_quote_idx = -1

    # Single pass to track strings and braces
    for i, char in enumerate(fixed):
      if escaped:
        escaped = False
        continue
      if char == "\\":
        escaped = True
        continue
      if char == '"':
        in_string = not in_string
        if in_string:
          last_quote_idx = i
      elif not in_string:
        if char in ("{", "["):
          stack.append(char)
        elif char in ("}", "]"):
          if stack:
            stack.pop()

    # 1. Close open strings (healing)
    if in_string:
      # We only auto-close strings for safe keys (CUTTABLE_KEYS)
      prefix = fixed[:last_quote_idx].rstrip()
      if prefix.endswith(":"):
        key_match = re.findall(r'"([^"]+)"\s*:\s*$', prefix)
        if key_match:
          key = key_match[0]
          if key not in CUTTABLE_KEYS:
            return ""

          # Special case: don't cut URL bindings, as partial URLs break images/links
          if key == "valueString":
            string_val = fixed[last_quote_idx + 1 :]
            if (
                string_val.startswith("http://")
                or string_val.startswith("https://")
                or string_val.startswith("data:")
                or string_val.startswith("/")
            ):
              return ""

            # Check if this value belongs to a URL-like key in the data model
            # Look backwards in the prefix (max 200 chars) for the "key" assignment
            prev_key_matches = re.findall(r'"key"\s*:\s*"([^"]+)"', prefix[-200:])
            if prev_key_matches:
              data_key = prev_key_matches[-1].lower()
              if any(k in data_key for k in ("url", "link", "src", "href", "image")):
                return ""
      fixed += '"'

    # 2. Clean up trailing comma
    fixed = fixed.rstrip()
    if fixed.endswith(","):
      fixed = fixed[:-1].rstrip()

    # 3. Close braces and brackets
    while stack:
      opening = stack.pop()
      fixed += "}" if opening == "{" else "]"

    return fixed

  def _process_json_chunk(self, chunk: str, messages: List[ResponsePart]):
    for char in chunk:
      char_handled = False
      if not self._in_top_level_list:
        if char == "[":
          if self._brace_count == 0:
            self._in_top_level_list = True
          self._brace_stack.append(("[", len(self._json_buffer)))
          self._json_buffer += "["
          self._brace_count += 1
          char_handled = True
        else:
          continue

      # Track string state to avoid miscounting braces inside strings
      if not char_handled and self._in_string:
        if self._string_escaped:
          self._string_escaped = False
          if self._brace_count > 0:
            self._json_buffer += char
        elif char == "\\":
          self._string_escaped = True
          if self._brace_count > 0:
            self._json_buffer += char
        elif char == '"':
          self._in_string = False
          if self._brace_count > 0:
            self._json_buffer += char
        else:
          if self._brace_count > 0:
            self._json_buffer += char
        char_handled = True

      if not char_handled:
        if char == '"':
          self._in_string = True
          self._string_escaped = False
          if self._brace_count > 0:
            self._json_buffer += char
        elif char == "{":
          if self._brace_count == 0:
            self._msg_types = []
          # Store (type, index) on stack
          self._brace_stack.append(("{", len(self._json_buffer)))
          self._json_buffer += "{"
          self._brace_count += 1
        elif char == "}":
          # Trigger object recognition
          # In v0.8 streaming, we might be nested inside surfaceUpdate/components list
          # So we check if it looks like a component even if brace_count > 1
          if self._brace_stack:  # Ensure there's an opening brace to pop
            # Pop the typed entry
            b_type, start_idx = self._brace_stack.pop()
            # If we popped a bracket while looking for a brace, we have a mismatch
            # but we'll be resilient and just continue
            self._json_buffer += "}"
            self._brace_count -= 1

            if self._brace_count >= 0:  # Allow processing even if not top-level object
              # The `i` here is the index within the current `chunk`.
              # We need to get the full buffer from `start_idx` in `_json_buffer`
              # up to the current point where `char` (which is '}') was added.
              # The `_json_buffer` already has `char` appended.
              obj_buffer = self._json_buffer[start_idx:]
              if obj_buffer.startswith("{") and obj_buffer.endswith("}"):
                try:
                  obj = json.loads(obj_buffer)
                  if isinstance(obj, dict):
                    self._found_valid_json_in_block = True
                    logger.debug(
                        f"[Parsed Dict] Keys: {list(obj.keys())}, protocol check"
                        " follows..."
                    )

                    is_protocol = self._in_top_level_list and self.is_protocol_msg(obj)
                    is_comp = obj.get("id") and obj.get("component")
                    # Process objects at top-level OR items in top-level list
                    # When in a list, we are top-level if the ONLY thing on the stack is the list opener
                    is_top_level = (len(self._brace_stack) == 0) or (
                        self._in_top_level_list
                        and len(self._brace_stack) == 1
                        and self._brace_stack[0][0] == "["
                    )
                    if is_comp:
                      self._handle_partial_component(obj, messages)
                    elif is_top_level or is_protocol:
                      if not self._handle_complete_object(
                          obj, self.surface_id, messages
                      ):
                        # Not a recognized message type. Validate to catch schema errors.
                        self._yield_messages([obj], messages)

                    if self._brace_count == 0 or (
                        self._in_top_level_list and len(self._brace_stack) == 1
                    ):
                      # Aggressively clear processed objects from the buffer to prevent slowdown.
                      if len(self._brace_stack) == 1 and self._brace_stack[0][0] == "[":
                        # Keep '[' and remove the object after it
                        self._json_buffer = (
                            self._json_buffer[:start_idx]
                            + self._json_buffer[start_idx + len(obj_buffer) :]
                        )
                      else:
                        self._json_buffer = self._json_buffer[len(obj_buffer) :]
                        if self._brace_stack:
                          shift = len(obj_buffer)
                          self._brace_stack = [
                              (b_t, i - shift) for b_t, i in self._brace_stack
                          ]

                except json.JSONDecodeError as e:
                  logger.debug(f"Object recognition failed: {e}")

        elif char == "[":
          self._brace_stack.append(("[", len(self._json_buffer)))
          self._json_buffer += "["
          self._brace_count += 1
        elif char == "]":
          if self._brace_stack and self._brace_stack[-1][0] == "[":
            # Pop the typed entry
            b_type, start_idx = self._brace_stack.pop()
            self._json_buffer += "]"
            self._brace_count -= 1
            if self._brace_count == 0:
              self._in_top_level_list = False
        else:
          if self._brace_count > 0:
            self._json_buffer += char

      # Sniff for metadata reactively on key delimiters to catch identifiers early
      if self._brace_count > 0 and char in ('"', ":", ",", "}", "]"):
        self._sniff_metadata()

    # Sniff for partial components at the end of the chunk
    if self._brace_count >= 1 and self._json_buffer:
      self._sniff_partial_component(messages)
      self._sniff_partial_data_model(messages)

    if self._topology_dirty:
      self.yield_reachable(messages, check_root=False, raise_on_orphans=False)
      self._topology_dirty = False

  def _construct_sniffed_data_model_message(
      self, active_msg_type: str, delta_msg_payload: Dict[str, Any]
  ) -> Dict[str, Any]:
    """Returns the message to yield for a partial data model update."""
    return {active_msg_type: delta_msg_payload}

  def _sniff_partial_data_model(self, messages: List[ResponsePart]) -> None:
    msg_type = self._data_model_msg_type
    if f'"{msg_type}"' not in self._json_buffer:
      return
    # Look through the brace stack for objects that might contain data model updates
    for b_type, start_idx in reversed(self._brace_stack):
      if b_type != "{":
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
        # This handles cases where _fix_json produces invalid JSON
        # from an incomplete trailing element (e.g. `{"key"}` from `{"ke`)
        trimmed = raw_fragment
        while "," in trimmed:
          trimmed = trimmed.rsplit(",", 1)[0]
          try:
            fixed_trimmed = self._fix_json(trimmed)
            if fixed_trimmed:
              obj = json.loads(fixed_trimmed)
              break
          except json.JSONDecodeError:
            continue

      if obj and isinstance(obj, dict):
        active_msg_type = None
        msg_type = self._data_model_msg_type
        if msg_type in obj:
          active_msg_type = msg_type

        if active_msg_type:
          dm_obj = obj[active_msg_type]
          if isinstance(dm_obj, dict) and "contents" in dm_obj:

            raw_contents = dm_obj["contents"]
            contents_dict = self._parse_contents_to_dict(raw_contents)

            if contents_dict:
              delta = {}
              for k, v in contents_dict.items():
                if self._yielded_data_model.get(k) != v:
                  delta[k] = v

              if delta:
                sid = dm_obj.get(SURFACE_ID_KEY) or self._surface_id or "default"
                # Deduplicate delta_contents by only keeping the LATEST entry for each dirty key
                if isinstance(raw_contents, list):
                  delta_contents = []
                  seen_keys = set()
                  for entry in reversed(raw_contents):
                    if not isinstance(entry, dict):
                      continue
                    k = entry.get("key")
                    # Only include entries that have a valid parsed key (cumulative)
                    if k and k in contents_dict and k not in seen_keys:
                      delta_contents.insert(0, entry)
                      seen_keys.add(k)
                  delta_contents = self._prune_incomplete_datamodel_entries(
                      delta_contents
                  )
                else:
                  delta_contents = delta

                delta_msg_payload = {
                    SURFACE_ID_KEY: sid,
                    "contents": delta_contents,
                }
                if "path" in dm_obj:
                  delta_msg_payload["path"] = dm_obj["path"]

                delta_msg = self._construct_sniffed_data_model_message(
                    active_msg_type, delta_msg_payload
                )
                self._yield_messages([delta_msg], messages, strict_integrity=False)

                self._yielded_data_model.update(contents_dict)
                # Update internal model for path resolution
                self.update_data_model(dm_obj, messages)

  def _sniff_partial_component(self, messages: List[ResponsePart]):
    """Attempts to parse a partial component from the current buffer."""
    # We only care about components if we are inside a "components" array
    if f'"{CATALOG_COMPONENTS_KEY}"' not in self._json_buffer:
      return
    # Try parsing from inner to outer to find the smallest complete component
    for b_type, start_idx in reversed(self._brace_stack):
      if b_type != "{":
        continue
      raw_fragment = self._json_buffer[start_idx:]
      if not raw_fragment:
        continue

      fixed_fragment = self._fix_json(raw_fragment)
      try:
        obj = json.loads(fixed_fragment)
        if isinstance(obj, dict) and obj.get("id") and obj.get("component"):
          if isinstance(obj["component"], str):
            # Flat style (v0.9+): component type is a string
            self._handle_partial_component(obj, messages)
          elif isinstance(obj["component"], dict) and len(obj["component"]) > 0:
            # Structured style (v0.8): Ignore components that are effectively empty (no type keys)
            self._handle_partial_component(obj, messages)

      except Exception:
        continue

  def _sniff_metadata(self) -> None:
    """Sniffs for surfaceId, root, and msg_types in the current json_buffer."""
    raise NotImplementedError("Subclasses must implement _sniff_metadata")

  def _prune_incomplete_datamodel_entries(self, entries: Any) -> Any:
    """Recursively removes data model entries that only contain 'key' and no valid values."""
    if not isinstance(entries, list):
      return entries

    pruned = []
    for entry in entries:
      if not isinstance(entry, dict):
        pruned.append(entry)
        continue

      has_val = False
      for vkey in ("value", "valueString", "valueNumber", "valueBoolean"):
        if vkey in entry:
          has_val = True
          break

      if "valueMap" in entry:
        pruned_map = self._prune_incomplete_datamodel_entries(entry["valueMap"])
        # valueMap is considered valid even if empty, meaning map was explicitly empty
        if isinstance(pruned_map, list):
          if not pruned_map and len(entry["valueMap"]) > 0:
            # If it was non-empty and became empty, it only had incomplete elements. Discard map.
            del entry["valueMap"]
          else:
            entry["valueMap"] = pruned_map
            has_val = True

      if has_val and "key" in entry:
        pruned.append(entry)

    return pruned

  def _handle_partial_component(
      self, comp: Dict[str, Any], messages: List[ResponsePart]
  ):
    """Handles a component discovered before its parent message is finished.

    When the parser sees a full JSON object that looks like a component
    (contains `id` and `component` keys) within a larger message, it caches
    the component and attempts to yield it immediately if it's reachable.

    Args:
        comp: The parsed component dictionary.
        messages: The list to append any renderable partial messages to.
    """
    comp_id = comp.get("id")
    if not comp_id:
      return

    # Skip caching this component if it has empty dictionaries for complex properties.
    # Elements like `children`, `text`, `url`, etc., violate A2UI schema if empty
    # and will crash the client. We want the parent to yield a loading placeholder instead.
    def _has_empty_dict(obj: Any) -> bool:
      if isinstance(obj, dict):
        if not obj:
          return True
        return any(_has_empty_dict(v) for v in obj.values())
      elif isinstance(obj, list):
        return any(_has_empty_dict(v) for v in obj)
      return False

    component_def = comp.get("component")
    if isinstance(component_def, str):
      # v0.9 flat style: check the whole component object for empty dicts
      if _has_empty_dict(comp):
        return
    elif _has_empty_dict(component_def):
      # v0.8 nested style: check properties inside component
      return

    if isinstance(component_def, dict) and hasattr(self, "_required_fields_map"):
      comp_type = next(iter(component_def.keys())) if component_def else None
      if comp_type:
        props = component_def.get(comp_type, {})
        if isinstance(props, dict):
          required_fields = self._required_fields_map.get(comp_type, set())
          for req in required_fields:
            if req not in props:
              return

    self._seen_components[comp_id] = comp
    self._topology_dirty = True

  def _parse_contents_to_dict(self, raw_contents: Any) -> Dict[str, Any]:
    """Recursively parses a list of A2UI contents into a flat dictionary."""
    if isinstance(raw_contents, dict):
      return raw_contents
    if not isinstance(raw_contents, list):
      return {}

    res = {}
    for entry in raw_contents:
      if not isinstance(entry, dict):
        continue
      key = entry.get("key")
      val = None
      for vkey in ["value", "valueString", "valueNumber", "valueBoolean"]:
        if vkey in entry:
          val = entry[vkey]
          break

      if val is None and "valueMap" in entry:
        val = self._parse_contents_to_dict(entry["valueMap"])

      if key and val is not None:
        res[key] = val
    return res

  def update_data_model(
      self, update: Dict[str, Any], messages: List[ResponsePart]
  ) -> None:
    """Updates the internal data model and marks affected components as dirty."""
    # Data model update can be v0.8 flat or v0.9+ contents list
    raw_contents = update.get("contents")
    if raw_contents is not None:
      contents = self._parse_contents_to_dict(raw_contents)
    else:
      # Fallback for old v0.8 flat structure or other layouts
      contents = {
          k: v
          for k, v in update.items()
          if k not in (SURFACE_ID_KEY, "root", "contents")
      }

  def _handle_complete_object(
      self,
      obj: Dict[str, Any],
      sid: Optional[str],
      messages: List[ResponsePart],
  ) -> bool:
    """Handles an object that has been fully parsed. To be implemented by subclasses."""
    raise NotImplementedError("Subclasses must implement _handle_complete_object")

  def yield_reachable(
      self,
      messages: List[Dict[str, Any]],
      check_root: bool = False,
      raise_on_orphans: bool = False,
  ):
    """Yields a partial message containing all reachable and seen components.

    This is the core of the streaming logic. Instead of waiting for a UI message
    which could contain dozens of components, we yield "partial" updates as soon
    as we have enough components to build a renderable sub-tree from the root.

    Args:
        messages: The list to which partial messages will be appended.
        check_root: If True, raises an error if the root component isn't seen yet.
        raise_on_orphans: If True, uses strict topology analysis to catch loops.
    """
    active_msg_type = self._get_active_msg_type_for_components()
    if not self.root_id or not active_msg_type:
      return

    # Buffer components until we have a beginRendering or createSurface for a known surface.
    if not self.surface_id:
      return

    sid = self.surface_id
    if sid not in self._yielded_surfaces_set and not self._buffered_start_message:
      return

    try:
      # Analyze topology of current seen components
      components_to_analyze = list(self._seen_components.values())

      if check_root and self.root_id not in self._seen_components:
        raise ValueError(
            f"No root component (id='{self.root_id}') found in {active_msg_type}"
        )

      reachable_ids = analyze_topology(
          self.root_id,
          components_to_analyze,
          self._ref_fields_map,
          raise_on_orphans=raise_on_orphans,
      )

      # We only yield components we actually have in our "seen" cache
      available_reachable = reachable_ids & set(self._seen_components.keys())

      if check_root and not available_reachable:
        raise ValueError(
            f"No root component (id='{self.root_id}') found in {active_msg_type}"
        )

      # 1. Process placeholders and partial children
      processed_components = []
      extra_components = []
      surface_id = self.surface_id or "unknown"
      yielded_for_surface = self._yielded_ids.get(surface_id, set())

      for rid in sorted(list(available_reachable)):
        comp = copy.deepcopy(self._seen_components[rid])
        # Apply path placeholders and prune unseen children in a single pass
        re_yielding = rid in yielded_for_surface
        self._process_component_topology(
            comp, extra_components, inline_resolved=re_yielding
        )
        processed_components.append(comp)

      # Add generated placeholders to the yield
      processed_components.extend(extra_components)

      # 2. Check if we have NEW or UPDATED reachable components to yield for THIS surface
      surface_id = self.surface_id
      if not surface_id or surface_id in self._deleted_surfaces:
        return

      should_yield = False
      if available_reachable - yielded_for_surface:
        should_yield = True
      else:
        # Check if any yielded component's content has changed for this surface
        for comp in processed_components:
          cid = comp["id"]
          content_str = json.dumps(comp, sort_keys=True)
          state_key = (surface_id, cid)
          if self._yielded_contents.get(state_key) != content_str:
            should_yield = True
            break

      if should_yield:
        current_sid = self.surface_id or "unknown"
        if (
            self._buffered_start_message
            and current_sid not in self._yielded_start_messages
        ):
          self._yield_messages(
              [self._buffered_start_message], messages, strict_integrity=True
          )
          self._yielded_start_messages.add(current_sid)
          self._yielded_surfaces_set.add(current_sid)

        # Construct a partial message of the correct type
        partial_msg = self._construct_partial_message(
            processed_components, active_msg_type
        )

        # Use strict_integrity=False for partial fragments yielded during streaming
        self._yield_messages([partial_msg], messages, strict_integrity=False)
        self._yielded_ids.setdefault(surface_id, set()).update(available_reachable)

        # Update content/placeholder tracking
        for comp in processed_components:
          cid = comp["id"]
          self._yielded_contents[(surface_id, cid)] = json.dumps(comp, sort_keys=True)

    except ValueError as e:
      if "Circular reference detected" in str(e):
        raise e
      # Other topology errors (like orphans) are ignored during streaming
      # as dependencies might still be on the wire.
      msg = str(e)
      if (
          raise_on_orphans
          or "Circular" in msg
          or "Self-reference" in msg
          or "recursion" in msg.lower()
          or check_root
      ):
        logger.debug(f"yield_reachable error (strict={check_root}): {msg}")
        raise e

  def _get_placeholder_id(self, child_id: str) -> str:
    """Returns the ID to use for a missing child placeholder."""
    return f"loading_{child_id}"

  def _process_component_topology(
      self,
      comp: Dict[str, Any],
      extra_components: List[Dict[str, Any]],
      inline_resolved: bool = False,
  ):
    """Recursively processes path placeholders and child pruning in one pass."""
    comp_id = comp.get("id", "unknown")

    # Deduce the component type for better placeholder typing
    comp_type = (
        next(iter(comp.get("component", {}).keys()))
        if comp.get("component") and isinstance(comp.get("component"), dict)
        else ""
    )

    def traverse(obj, parent_key=None):
      if isinstance(obj, dict):
        # 1. Handle Path Placeholders (from _apply_placeholders)
        if (
            "path" in obj
            and isinstance(obj["path"], str)
            and obj["path"].startswith("/")
        ):
          path = obj["path"]
          key = path.lstrip("/")
          if self._version != VERSION_0_9:
            if "componentId" not in obj:
              obj.clear()
            obj.update({"path": "/" + key})
        elif self._version != VERSION_0_9:
          # If not in data model, still ensure path has leading slash if it's a bindable object (v0.8 only)
          current_path = obj.get("path")
          if current_path is not None:
            if not isinstance(current_path, str) or not current_path.startswith("/"):
              obj["path"] = "/" + str(current_path)

        # 2. Handle Child Pruning (from _prune_unseen_children)
        for field in (
            "children",
            "explicitList",
            "child",
            "contentChild",
            "entryPointChild",
            "componentId",
        ):
          if field in obj:
            if isinstance(obj[field], list):
              valid_children = []
              for child_id in obj[field]:
                if child_id in self._seen_components:
                  valid_children.append(child_id)
                else:
                  # Individual placeholder for missing child
                  placeholder_id = self._get_placeholder_id(child_id)
                  valid_children.append(placeholder_id)
                  placeholder_comp = {
                      "id": placeholder_id,
                      **self._placeholder_component,
                  }
                  # Avoid duplicates in extra_components
                  if not any(ec["id"] == placeholder_id for ec in extra_components):
                    extra_components.append(placeholder_comp)

              if not valid_children and field in ("children", "explicitList"):
                # If list is empty, check if it was partial in the buffer
                # (meaning it's a sequence that started but hasn't yielded items yet)
                term = f'"{field}"'
                if term in self._json_buffer:
                  # Simple check: is there a [ after the field name in the buffer?
                  after_field = self._json_buffer.split(term)[-1]
                  if "[" in after_field and "]" not in after_field.split("[")[0]:
                    placeholder_id = f"loading_children_{comp_id}"
                    valid_children.append(placeholder_id)
                    placeholder_comp = {
                        "id": placeholder_id,
                        **self._placeholder_component,
                    }
                    if not any(ec["id"] == placeholder_id for ec in extra_components):
                      extra_components.append(placeholder_comp)
              obj[field] = valid_children
            elif isinstance(obj[field], str):
              child_id = obj[field]
              if child_id not in self._seen_components:
                placeholder_id = self._get_placeholder_id(child_id)
                obj[field] = placeholder_id
                placeholder_comp = {
                    "id": placeholder_id,
                    **self._placeholder_component,
                }
                if not any(ec["id"] == placeholder_id for ec in extra_components):
                  extra_components.append(placeholder_comp)

        # Continue traversal on values
        for k, v in list(obj.items()):
          traverse(v, parent_key=k)
      elif isinstance(obj, list):
        for item in obj:
          traverse(item, parent_key)

    # Start recursion from the component content
    if isinstance(comp.get("component"), dict):
      traverse(comp.get("component", {}))
    else:
      # Flat style properties are siblings to 'component' type key
      traverse(comp)
