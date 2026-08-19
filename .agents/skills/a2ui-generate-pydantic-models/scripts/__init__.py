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

"""A2UI Pydantic Codegen Package."""

from .catalog_generators import (
    generate_basic_catalog_components,
    generate_basic_catalog_functions,
    generate_basic_catalog_index,
    generate_basic_catalog_styles,
)
from .engine import PydanticCodegen
from .schema_generators import (
    generate_agent_capabilities,
    generate_agent_to_renderer,
    generate_catalog_definition,
    generate_common_types,
    generate_renderer_capabilities,
    generate_renderer_to_agent,
    generate_schema_init,
)
from .utils import (
    FILE_HEADER,
    ensure_v_prefix,
    extract_exported_symbols,
    find_common_refs,
    get_base_common_symbols,
    get_schema_dependencies,
    is_modern_terminology,
    to_pascal_case,
    to_snake_case,
    topological_sort_defs,
    version_to_underscore,
)

__all__ = [
    "PydanticCodegen",
    "generate_common_types",
    "generate_agent_to_renderer",
    "generate_renderer_to_agent",
    "generate_renderer_capabilities",
    "generate_agent_capabilities",
    "generate_catalog_definition",
    "generate_schema_init",
    "generate_basic_catalog_components",
    "generate_basic_catalog_functions",
    "generate_basic_catalog_styles",
    "generate_basic_catalog_index",
    "ensure_v_prefix",
    "version_to_underscore",
    "is_modern_terminology",
    "to_snake_case",
    "to_pascal_case",
    "extract_exported_symbols",
    "get_base_common_symbols",
    "get_schema_dependencies",
    "topological_sort_defs",
    "find_common_refs",
    "FILE_HEADER",
]
