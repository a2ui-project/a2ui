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

"""Pruning for the protocol schemas that a prompt shows the model.

Catalogs are pruned with the transformers in `a2ui.catalog_transformers`. The
agent-to-renderer and common types schemas belong to the protocol rather than to
a catalog, so they are pruned with the functions here.
"""

from collections import deque
from collections.abc import Iterable, Mapping, Sequence
import copy
from typing import Any

from a2ui.core.common import to_protocol_version
from a2ui.core.schema import ProtocolVersion

_DEFS_REF_PREFIX = "#/$defs/"
_PROPERTIES_REF_PREFIX = "#/properties/"


def _collect_refs(node: Any) -> set[str]:
    """Returns every `$ref` value in a JSON value."""
    refs: set[str] = set()
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "$ref" and isinstance(value, str):
                refs.add(value)
            else:
                refs.update(_collect_refs(value))
    elif isinstance(node, list):
        for item in node:
            refs.update(_collect_refs(item))
    return refs


def _reachable_defs(
    defs: Mapping[str, Any],
    roots: Iterable[str],
    ref_prefix: str = _DEFS_REF_PREFIX,
) -> dict[str, Any]:
    """Returns the definitions reachable from `roots`.

    Args:
        defs: The definitions, by name.
        roots: The names to start from. Names `defs` doesn't hold are ignored.
        ref_prefix: The prefix of the refs that point into `defs`.

    Returns:
        The reachable definitions, in their original order.
    """
    reachable: set[str] = set()
    queue = deque(roots)
    while queue:
        name = queue.popleft()
        if name in defs and name not in reachable:
            reachable.add(name)
            for ref in _collect_refs(defs[name]):
                if ref.startswith(ref_prefix):
                    queue.append(ref.removeprefix(ref_prefix))
    return {name: value for name, value in defs.items() if name in reachable}


def prune_messages_schema(
    a2r_schema: Mapping[str, Any],
    protocol_version: str,
    allowed_messages: Sequence[str],
) -> dict[str, Any]:
    """Returns a copy of an agent-to-renderer schema that admits only some messages.

    The allowlist is read literally. An empty allowlist admits no message, and a
    name the schema doesn't define is ignored. To keep every message, don't
    prune.

    Args:
        a2r_schema: The agent-to-renderer schema. It is not modified.
        protocol_version: The protocol version of the schema, for example
            `"0.9"` or `"v1.0"`.
        allowed_messages: The messages to keep. For v0.8 these are keys of the
            schema's `properties`, for example `beginRendering`. For later
            versions they are names in its `$defs`, for example
            `CreateSurfaceMessage`.

    Returns:
        The pruned copy. Definitions that only the removed messages refer to
        are removed as well.

    Raises:
        TypeError: If `allowed_messages` is a single string.
        ValueError: If `protocol_version` isn't a protocol version.
    """
    if isinstance(allowed_messages, str):
        raise TypeError("allowed_messages must be a sequence of names, not a string.")
    allowed = frozenset(allowed_messages)
    pruned = copy.deepcopy(dict(a2r_schema))

    if to_protocol_version(protocol_version) is ProtocolVersion.V0_8:
        properties = pruned.get("properties")
        if isinstance(properties, dict):
            pruned["properties"] = _reachable_defs(
                properties, allowed, _PROPERTIES_REF_PREFIX
            )
        return pruned

    one_of = pruned.get("oneOf")
    if isinstance(one_of, list):
        pruned["oneOf"] = [
            item
            for item in one_of
            if isinstance(item, dict)
            and isinstance(item.get("$ref"), str)
            and item["$ref"].startswith(_DEFS_REF_PREFIX)
            and item["$ref"].removeprefix(_DEFS_REF_PREFIX) in allowed
        ]
    defs = pruned.get("$defs")
    if isinstance(defs, dict):
        pruned["$defs"] = _reachable_defs(defs, allowed)
    return pruned


def prune_common_types_schema(
    common_types_schema: Mapping[str, Any],
    *referencing_schemas: Mapping[str, Any],
) -> dict[str, Any]:
    """Returns a copy of the common types schema with only the definitions in use.

    A definition is in use if one of `referencing_schemas` refers to it, as
    `common_types.json#/$defs/<name>` or `#/$defs/<name>`, or if a definition
    in use refers to it.

    Args:
        common_types_schema: The common types schema. It is not modified.
        *referencing_schemas: The schemas whose refs decide what is kept, for
            example the catalog schemas and the agent-to-renderer schema that a
            prompt shows.

    Returns:
        The pruned copy, or an empty dict if `common_types_schema` is empty.
    """
    if not common_types_schema:
        return {}
    pruned = copy.deepcopy(dict(common_types_schema))
    defs = pruned.get("$defs")
    if not isinstance(defs, dict):
        return pruned

    roots: set[str] = set()
    for schema in referencing_schemas:
        for ref in _collect_refs(schema):
            if "common_types.json#/$defs/" in ref or ref.startswith(_DEFS_REF_PREFIX):
                roots.add(ref.split(_DEFS_REF_PREFIX)[-1])
    pruned["$defs"] = _reachable_defs(defs, roots)
    return pruned
