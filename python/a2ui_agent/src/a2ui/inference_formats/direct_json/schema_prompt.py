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

"""The schema prompt text that the Direct JSON format shows the model."""

from collections.abc import Sequence
import json

from a2ui.core import A2uiCatalogError, CatalogApi
from a2ui.core.common import to_protocol_version
from a2ui.schema import constants
from a2ui.schema.utils import load_agent_to_renderer_schema, load_common_types_schema
from a2ui.utils import prune_common_types_schema, prune_messages_schema


def schema_to_prompt(
    catalogs: Sequence[CatalogApi],
    allowed_messages: Sequence[str] | None = None,
) -> str:
    """Returns the prompt text that describes catalogs to the model.

    The text holds more than the catalogs. It also includes the protocol
    schemas the model needs to write messages for them: the agent-to-renderer
    schema and the common types that the catalogs or that schema reference,
    both as published for the catalogs' protocol version. They sit between
    `---BEGIN A2UI JSON SCHEMA---` and `---END A2UI JSON SCHEMA---` lines, in
    the order agent-to-renderer schema, common types schema, then one catalog
    schema section per catalog. The protocol schemas appear once however many
    catalogs there are.

    Args:
      catalogs: The catalogs to describe, which share a protocol version, in
        the order the prompt lists them.
      allowed_messages: The messages to keep in the agent-to-renderer schema,
        as `prune_messages_schema` reads them. `None` keeps every message, and
        an empty list keeps none.

    Returns:
      The prompt text.

    Raises:
      A2uiCatalogError: If no catalog is given, the catalogs target different
        protocol versions, or their protocol version isn't one this SDK
        defines.
    """
    if not catalogs:
        raise A2uiCatalogError("The schema prompt needs at least one catalog.")
    versions = {to_protocol_version(c.protocol_version) for c in catalogs}
    if len(versions) > 1:
        raise A2uiCatalogError(
            "The schema prompt's catalogs target different protocol versions:"
            f" {sorted(v.value for v in versions)}."
        )

    version = catalogs[0].protocol_version
    a2r_schema = load_agent_to_renderer_schema(version)
    if allowed_messages is not None:
        a2r_schema = prune_messages_schema(a2r_schema, version, allowed_messages)

    catalog_schemas = [c.catalog_schema for c in catalogs]
    common_types_schema = prune_common_types_schema(
        load_common_types_schema(version), *catalog_schemas, a2r_schema
    )

    all_schemas = [constants.A2UI_SCHEMA_BLOCK_START]

    agent_renderer_str = (
        json.dumps(a2r_schema, separators=(",", ":")) if a2r_schema else "{}"
    )
    all_schemas.append(f"### Agent to Renderer Schema:\n{agent_renderer_str}")

    if common_types_schema.get("$defs"):
        common_str = json.dumps(common_types_schema, separators=(",", ":"))
        all_schemas.append(f"### Common Types Schema:\n{common_str}")

    for catalog_schema in catalog_schemas:
        catalog_str = json.dumps(catalog_schema, separators=(",", ":"))
        all_schemas.append(f"### Catalog Schema:\n{catalog_str}")

    all_schemas.append(constants.A2UI_SCHEMA_BLOCK_END)

    return "\n\n".join(all_schemas)
