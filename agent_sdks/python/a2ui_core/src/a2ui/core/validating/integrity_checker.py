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

from typing import Any, Dict, List, Optional, Set, Tuple, Union, Iterator
import re


NUMERIC_PATTERN = re.compile(r"^(?:0|[1-9][0-9]*)$")
MAX_GLOBAL_DEPTH = 50
MAX_FUNC_CALL_DEPTH = 5
RELAXED_PATH_PATTERN = re.compile(
    r"^(?:(?:\/(?:[^~\/]|~[01])*)*|(?:[^~\/]|~[01])+(?:\/(?:[^~\/]|~[01])*)*)$"
)


def get_component_references(
    component: Dict[str, Any],
    ref_fields_map: Dict[str, Tuple[Set[str], Set[str]]],
    single_ref_fields: Set[str],
    list_ref_fields: Set[str],
) -> Iterator[Tuple[str, str]]:
    comp_val = component.get("component")
    if isinstance(comp_val, str):
        yield from _get_refs_recursively(
            comp_val, component, ref_fields_map, single_ref_fields, list_ref_fields
        )
    elif isinstance(comp_val, dict) and comp_val:
        comp_type = next(iter(comp_val.keys()))
        props = comp_val[comp_type]
        yield from _get_refs_recursively(
            comp_type, props, ref_fields_map, single_ref_fields, list_ref_fields
        )


def _get_refs_recursively(
    comp_type: str,
    props: Dict[str, Any],
    ref_fields_map: Dict[str, Tuple[Set[str], Set[str]]],
    single_ref_fields: Set[str],
    list_ref_fields: Set[str],
) -> Iterator[Tuple[str, str]]:
    if not comp_type or not isinstance(props, dict):
        return

    single_refs, list_refs = ref_fields_map.get(comp_type, (set(), set()))

    for key, value in props.items():
        is_ref = False
        if key in single_refs or key in single_ref_fields:
            if isinstance(value, str):
                yield value, key
                is_ref = True
            elif isinstance(value, dict) and "componentId" in value:
                yield value["componentId"], f"{key}.componentId"
                is_ref = True
        elif key in list_refs or key in list_ref_fields:
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, str):
                        yield item, key
                        is_ref = True
            elif isinstance(value, dict):
                if "explicitList" in value:
                    for item in value["explicitList"]:
                        if isinstance(item, str):
                            yield item, f"{key}.explicitList"
                            is_ref = True
                elif "template" in value:
                    template = value["template"]
                    if isinstance(template, dict) and "componentId" in template:
                        yield template["componentId"], f"{key}.template.componentId"
                        is_ref = True
                elif "componentId" in value:
                    yield value["componentId"], f"{key}.componentId"
                    is_ref = True

        # Special handling for nested tab arrays
        if isinstance(value, list) and key not in list_refs:
            for idx, item in enumerate(value):
                if isinstance(item, dict):
                    child_id = item.get("child")
                    if child_id and isinstance(child_id, str):
                        yield child_id, f"{key}[{idx}].child"


def validate_component_integrity(
    root_id: Optional[str],
    components: List[Dict[str, Any]],
    ref_fields_map: Dict[str, Tuple[Set[str], Set[str]]],
    single_ref_fields: Set[str],
    list_ref_fields: Set[str],
    skip_ref_check: bool = False,
) -> None:
    ids: Set[str] = set()

    # 1. Collect IDs and check for duplicates
    for comp in components:
        comp_id = comp.get("id")
        if comp_id is None:
            continue
        if comp_id in ids:
            raise ValueError(f"Duplicate component ID: {comp_id}")
        ids.add(comp_id)

    # In an incremental update, components may reference IDs already on the client.
    if skip_ref_check:
        return

    # 2. Check for root component
    if root_id is not None and root_id not in ids:
        raise ValueError(f"Missing root component: No component has id='{root_id}'")

    # 3. Check for dangling references using helper
    for comp in components:
        comp_id = comp.get("id", "Unknown")
        for ref_id, field_name in get_component_references(
            comp, ref_fields_map, single_ref_fields, list_ref_fields
        ):
            if ref_id not in ids:
                raise ValueError(
                    f"Component '{comp_id}' references non-existent component '{ref_id}'"
                    f" in field '{field_name}'"
                )


def validate_recursion_and_paths(data: Any) -> None:
    def traverse(item: Any, global_depth: int, func_depth: int):
        if global_depth > MAX_GLOBAL_DEPTH:
            raise ValueError(
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
                    raise ValueError(f"Invalid path syntax: '{path}'")

            is_func_v08 = "functionCall" in item and isinstance(
                item["functionCall"], dict
            )
            is_func_v09 = "call" in item and "args" in item

            if is_func_v08:
                if func_depth >= MAX_FUNC_CALL_DEPTH:
                    raise ValueError(
                        f"Recursion limit exceeded: functionCall depth > {MAX_FUNC_CALL_DEPTH}"
                    )
                traverse(item["functionCall"], global_depth + 1, func_depth + 1)
            elif is_func_v09:
                if func_depth >= MAX_FUNC_CALL_DEPTH:
                    raise ValueError(
                        f"Recursion limit exceeded: functionCall depth > {MAX_FUNC_CALL_DEPTH}"
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
