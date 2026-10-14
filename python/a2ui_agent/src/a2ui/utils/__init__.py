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

"""Helpers shared by the inference formats and agent integrations."""

from .catalog_resolver import resolve_catalogs
from .examples import load_examples, resolve_examples_path
from .schema_pruning import prune_common_types_schema, prune_messages_schema
from .schemas import load_agent_to_renderer_schema, load_common_types_schema
from .validation import validate_payload
from .versions import to_version_number

__all__ = [
    "load_agent_to_renderer_schema",
    "load_common_types_schema",
    "load_examples",
    "prune_common_types_schema",
    "prune_messages_schema",
    "resolve_catalogs",
    "resolve_examples_path",
    "to_version_number",
    "validate_payload",
]
