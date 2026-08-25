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

import re
from typing import TYPE_CHECKING, Any, Dict, Optional, Set

from ..state.component_model import ComponentModel
from ..exceptions import (
    A2uiErrorDetail,
    A2uiIntegrityError,
    A2uiRecursionError,
    A2uiValidationError,
)

if TYPE_CHECKING:
    from .catalog_schema_validator import ValidationConfig

ROOT_ID = "root"
MAX_GLOBAL_DEPTH = 50
MAX_FUNC_CALL_DEPTH = 5
RELAXED_PATH_PATTERN = re.compile(
    r"^(?:(?:\/(?:[^~\/]|~[01])*)*|(?:[^~\/]|~[01])+(?:\/(?:[^~\/]|~[01])*)*)$"
)


def validate_component_integrity(
    components: Dict[str, ComponentModel],
    root_id: str = ROOT_ID,
    config: Optional[ValidationConfig] = None,
) -> None:
    allow_dangling_references = config.allow_dangling_references if config else False
    allow_missing_root = config.allow_missing_root if config else False

    ids: Set[str] = set(components.keys())

    if allow_dangling_references:
        return

    if not allow_missing_root and root_id not in ids:
        raise A2uiIntegrityError(
            f"Missing root component: No component has id='{root_id}'"
        )

    for comp_id, comp in components.items():
        if comp_id is None or not isinstance(comp_id, str):
            raise A2uiIntegrityError("Component must have a valid string 'id'")
        for ref_id, field_name in comp.get_child_references(known_component_ids=ids):
            if ref_id not in ids:
                raise A2uiIntegrityError(
                    f"Dangling reference: Component '{comp_id}' references non-existent"
                    f" component '{ref_id}' in field '{field_name}'"
                )


def validate_recursion_and_paths(data: Any) -> None:
    def traverse(item: Any, global_depth: int, func_depth: int) -> None:
        if global_depth > MAX_GLOBAL_DEPTH:
            raise A2uiRecursionError(
                f"Global recursion limit exceeded: Depth > {MAX_GLOBAL_DEPTH}"
            )

        if isinstance(item, list):
            for x in item:
                traverse(x, global_depth + 1, func_depth)
            return

        if isinstance(item, dict):
            if "path" in item and isinstance(item["path"], str):
                path = item["path"]
                if not re.fullmatch(RELAXED_PATH_PATTERN, path):
                    raise A2uiValidationError(
                        f"Invalid path syntax: '{path}'",
                        details=[
                            A2uiErrorDetail(
                                path="path",
                                code="invalid_pointer",
                                message=f"Invalid path syntax: '{path}'",
                            )
                        ],
                    )

            is_func_v08 = "functionCall" in item and isinstance(
                item["functionCall"], dict
            )
            is_func_v09 = "call" in item and "args" in item

            if is_func_v08:
                if func_depth >= MAX_FUNC_CALL_DEPTH:
                    raise A2uiRecursionError(
                        "Recursion limit exceeded: functionCall depth >"
                        f" {MAX_FUNC_CALL_DEPTH}"
                    )
                traverse(item["functionCall"], global_depth + 1, func_depth + 1)
            elif is_func_v09:
                if func_depth >= MAX_FUNC_CALL_DEPTH:
                    raise A2uiRecursionError(
                        "Recursion limit exceeded: functionCall depth >"
                        f" {MAX_FUNC_CALL_DEPTH}"
                    )
                for k, v in item.items():
                    if k == "args":
                        traverse(v, global_depth + 1, func_depth + 1)
                    else:
                        traverse(v, global_depth + 1, func_depth)
            else:
                for v in item.values():
                    traverse(v, global_depth + 1, func_depth)

    traverse(data, 0, 0)
