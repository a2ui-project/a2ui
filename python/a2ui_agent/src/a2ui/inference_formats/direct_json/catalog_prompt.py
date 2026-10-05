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

"""The catalog prompt text that the Direct JSON format shows the model."""

from collections.abc import Mapping, Sequence
import json
from typing import Any

from a2ui.core import CatalogApi
from a2ui.schema import constants
from a2ui.schema.utils import load_agent_to_renderer_schema, load_common_types_schema
from a2ui.utils import prune_common_types_schema, prune_messages_schema


def catalog_to_prompt(
    catalog: CatalogApi,
    *,
    s2c_schema: Mapping[str, Any] | None = None,
    common_types_schema: Mapping[str, Any] | None = None,
    allowed_messages: Sequence[str] | None = None,
) -> str:
    """Returns the prompt text that describes a catalog to the model.

    The text holds more than the catalog. It also includes the protocol
    schemas the model needs to write messages for it: the server-to-client
    schema and the common types that the catalog or that schema reference.
    The three sit between `---BEGIN A2UI JSON SCHEMA---` and
    `---END A2UI JSON SCHEMA---` lines, in the order server-to-client schema,
    common types schema, catalog schema.

    Args:
      catalog: The catalog to describe.
      s2c_schema: The server-to-client schema. Defaults to the schema for the
        catalog's protocol version.
      common_types_schema: The common types schema. Defaults to the schema for
        the catalog's protocol version. Only the types that the catalog or the
        server-to-client schema reference are included.
      allowed_messages: The messages to keep in the server-to-client schema,
        as `prune_messages_schema` reads them. `None` keeps every message, and
        an empty list keeps none.

    Returns:
      The prompt text.

    Raises:
      A2uiCatalogError: If a default schema is needed and the catalog's
        protocol version isn't one this SDK defines.
    """
    version = catalog.protocol_version
    effective_s2c = (
        dict(s2c_schema)
        if s2c_schema is not None
        else load_agent_to_renderer_schema(version)
    )
    if allowed_messages is not None:
        effective_s2c = prune_messages_schema(effective_s2c, version, allowed_messages)

    effective_common_types = (
        dict(common_types_schema)
        if common_types_schema is not None
        else load_common_types_schema(version)
    )
    catalog_schema = catalog.catalog_schema
    effective_common_types = prune_common_types_schema(
        effective_common_types, catalog_schema, effective_s2c
    )

    all_schemas = [constants.A2UI_SCHEMA_BLOCK_START]

    server_client_str = (
        json.dumps(effective_s2c, separators=(",", ":")) if effective_s2c else "{}"
    )
    all_schemas.append(f"### Server To Client Schema:\n{server_client_str}")

    if effective_common_types.get("$defs"):
        common_str = json.dumps(effective_common_types, separators=(",", ":"))
        all_schemas.append(f"### Common Types Schema:\n{common_str}")

    catalog_str = json.dumps(catalog_schema, separators=(",", ":"))
    all_schemas.append(f"### Catalog Schema:\n{catalog_str}")

    all_schemas.append(constants.A2UI_SCHEMA_BLOCK_END)

    return "\n\n".join(all_schemas)
