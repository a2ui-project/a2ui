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

"""Pydantic validation error formatting utilities.

Provides functions to format Pydantic validation issues into human-readable diagnostic
messages and structured A2UI error details, congruent with A2UI's cross-language standards.
"""

from __future__ import annotations

from collections.abc import Mapping
import re
from typing import Any
from pydantic import ValidationError
from ..exceptions import A2uiErrorDetail


def _clean_loc_part(x: str) -> str:
    """Extracts base message class names from Pydantic validator wrapper strings."""
    if x.startswith("function-after[") or x.startswith("function-before["):
        match = re.search(r"([A-Za-z0-9_]+Message)\]", x)
        if match:
            return match.group(1)
    return x


def _format_type_name(val: Any) -> str:
    """Formats a Python value into canonical schema type vocabulary."""
    if val is None:
        return "null"
    if isinstance(val, bool):
        return "boolean"
    if isinstance(val, (int, float)):
        return "number"
    if isinstance(val, str):
        return "string"
    if isinstance(val, dict):
        return "object"
    if isinstance(val, (list, tuple, set)):
        return "array"
    return type(val).__name__


_PYDANTIC_TYPE_MAP: dict[str, str] = {
    "string_type": "string",
    "int_type": "integer",
    "int_parsing": "integer",
    "float_type": "number",
    "float_parsing": "number",
    "bool_type": "boolean",
    "bool_parsing": "boolean",
    "dict_type": "object",
    "list_type": "array",
}


def _get_expected_type(err_type: str, msg: str) -> str:
    """Extracts a canonical expected type name from Pydantic error type and message."""
    if err_type in _PYDANTIC_TYPE_MAP:
        return _PYDANTIC_TYPE_MAP[err_type]
    match = re.search(r"Input should be a valid ([a-zA-Z0-9_ ]+)", msg)
    if match:
        raw_target = match.group(1).split(",")[0].strip()
        type_aliases = {
            "string": "string",
            "integer": "integer",
            "int": "integer",
            "boolean": "boolean",
            "dictionary": "object",
            "list": "array",
        }
        return type_aliases.get(raw_target, raw_target)
    cleaned = err_type.replace("_type", "").replace("_parsing", "").strip()
    return cleaned or "valid value"


def map_pydantic_error_code(err_type: str) -> str:
    """Maps a Pydantic error type to a canonical A2UI error code.

    Args:
        err_type: Pydantic error type string (e.g. 'missing', 'extra_forbidden').

    Returns:
        Canonical A2UI error code ('missing_field', 'extra_field', 'type_mismatch', or 'invalid_value').
    """
    if err_type == "missing":
        return "missing_field"
    if err_type == "extra_forbidden":
        return "extra_field"
    if (
        err_type.endswith("_type")
        or err_type.endswith("_parsing")
        or "type" in err_type
    ):
        return "type_mismatch"
    return "invalid_value"


def format_pydantic_message(
    err: Mapping[str, Any],
    path_str: str = "",
    match_jsonschema_missing: bool = False,
) -> str:
    """Formats a diagnostic error message string for a single Pydantic error.

    Ensures the message contains informative, congruent diagnostic details matching
    cross-language conventions.

    Args:
        err: Pydantic error dictionary from ValidationError.errors().
        path_str: Property path string associated with the error.
        match_jsonschema_missing: If True, uses JSON Schema-style missing field message.

    Returns:
        Human-readable diagnostic error message.
    """
    err_type = err.get("type", "")
    ctx = err.get("ctx") or {}

    if err_type == "extra_forbidden":
        extra_key = ctx.get("extra")
        if not extra_key and err.get("loc"):
            extra_key = str(err["loc"][-1])
        key_str = f": '{extra_key}'" if extra_key else ""
        return (
            "Additional properties are not allowed: unrecognized key(s) in"
            f" object{key_str} (extra inputs are not permitted)"
        )

    if err_type == "missing":
        if match_jsonschema_missing:
            return (
                f"'{path_str}' is a required property"
                if path_str
                else "Missing required field"
            )
        return str(err.get("msg", "Field required"))

    if err_type == "literal_error":
        expected = ctx.get("expected")
        received = err.get("input")
        if expected is not None:
            return f"Invalid enum value. Expected {expected}, received '{received}'"
        return str(err.get("msg", "Invalid value"))

    if (
        err_type.endswith("_type")
        or err_type.endswith("_parsing")
        or "type" in err_type
    ):
        raw_msg = str(err.get("msg", "Type mismatch"))
        expected = _get_expected_type(err_type, raw_msg)
        pydantic_hint = raw_msg[0].lower() + raw_msg[1:] if raw_msg else ""
        hint_str = f" ({pydantic_hint})" if pydantic_hint else ""
        if "input" in err:
            received = _format_type_name(err["input"])
            return f"Expected {expected}, received {received}{hint_str}"
        return f"Expected {expected}{hint_str}"

    return str(err.get("msg", "Validation failed"))


def format_pydantic_issue(err: Mapping[str, Any], path: str | None = None) -> str:
    """Formats a single Pydantic issue into a human-readable diagnostic message.

    Extracts issue details into a diagnostic string containing the target path and
    violation details, mirroring TypeScript's formatZodIssue.

    Args:
        err: Pydantic error dictionary from ValidationError.errors().
        path: Optional pre-computed path string. If omitted, constructed from err['loc'].

    Returns:
        Human-readable formatted error message with path prefix.
    """
    if path is None:
        loc = err.get("loc", ())
        clean_parts = [_clean_loc_part(str(x)) for x in loc]
        path = ".".join(clean_parts) or "root"

    msg = format_pydantic_message(err, path)
    return f"{path}: {msg}"


def format_validation_error(
    error: ValidationError,
    messages: list[dict[str, Any]] | None = None,
    valid_actions: set[str] | None = None,
    path_prefix: str = "",
    allow_unknown_extra: bool = False,
    match_jsonschema_missing_path: bool = False,
    strip_messages_prefix: bool = False,
) -> list[A2uiErrorDetail]:
    """Formats a Pydantic ValidationError into structured A2uiErrorDetail instances.

    Filters out irrelevant union branches when validating message envelopes with multiple
    discriminated union branches.

    Args:
        error: Pydantic ValidationError to format.
        messages: Optional list of raw message payloads being validated (used for union pruning).
        valid_actions: Optional set of valid action names supported by the adapter.
        path_prefix: Optional prefix to prepend to error paths.
        allow_unknown_extra: If True, extra_field errors are ignored.
        match_jsonschema_missing_path: If True, sets path to empty string for missing root fields
            to maintain parity with JSON Schema component validation behavior.
        strip_messages_prefix: If True, strips leading 'messages.<index>' from error paths.

    Returns:
        List of structured A2uiErrorDetail objects.
    """
    details: list[A2uiErrorDetail] = []
    branch_to_action: dict[str, str] = {}
    action_to_branch: dict[str, str] = {}
    action_to_branches: dict[str, set[str]] = {}
    if valid_actions:
        for action in valid_actions:
            branch = action[0].upper() + action[1:] + "Message"
            short_branch = action[0].upper() + action[1:]
            branch_to_action[branch] = action
            action_to_branch[action] = branch
            branch_to_action[short_branch] = action
            action_to_branches[action] = {branch, short_branch}

    all_branch_names = set(branch_to_action.keys())

    for err in error.errors():
        loc = err.get("loc", ())
        loc_parts = [_clean_loc_part(str(x)) for x in loc]
        if (
            messages is not None
            and all_branch_names
            and len(loc) >= 3
            and loc[0] == "messages"
            and isinstance(loc[1], int)
        ):
            msg_idx = loc[1]
            if msg_idx < len(messages) and isinstance(messages[msg_idx], dict):
                m = messages[msg_idx]
                present_actions = [k for k in valid_actions or () if k in m]
                if present_actions:
                    branch = loc_parts[2]
                    if branch in all_branch_names:
                        expected_branches = {
                            action_to_branch[act] for act in present_actions
                        }
                        expected_branches = set().union(*(
                            action_to_branches.get(act, set())
                            for act in present_actions
                        ))
                        if branch not in expected_branches:
                            continue

        clean_loc_parts = [x for x in loc_parts if x not in all_branch_names]
        if strip_messages_prefix:
            if (
                len(clean_loc_parts) >= 2
                and clean_loc_parts[0] == "messages"
                and clean_loc_parts[1].isdigit()
            ):
                clean_loc_parts = clean_loc_parts[2:]
        path_str = ".".join(clean_loc_parts)
        err_type = err.get("type", "")
        code = map_pydantic_error_code(err_type)

        if allow_unknown_extra and code == "extra_field":
            continue

        msg = format_pydantic_message(
            err,
            path_str,
            match_jsonschema_missing=match_jsonschema_missing_path,
        )

        if match_jsonschema_missing_path and code == "missing_field":
            path_str = ""

        if path_prefix:
            full_path = f"{path_prefix}.{path_str}" if path_str else path_prefix
        else:
            full_path = path_str

        details.append(A2uiErrorDetail(path=full_path, code=code, message=msg))

    return details


def format_validation_error_summary(
    error: ValidationError,
    messages: list[dict[str, Any]] | None = None,
    valid_actions: set[str] | None = None,
    path_prefix: str = "",
    separator: str = "; ",
    strip_messages_prefix: bool = False,
) -> str:
    """Formats a ValidationError into a joined summary diagnostic string.

    Args:
        error: Pydantic ValidationError to format.
        messages: Optional list of raw message payloads being validated.
        valid_actions: Optional set of valid action names supported by the adapter.
        path_prefix: Optional prefix to prepend to error paths.
        separator: Separator string between error diagnostics. Defaults to '; '.
        strip_messages_prefix: If True, strips leading 'messages.<index>' from error paths.

    Returns:
        Formatted summary string (e.g. 'path1: msg1; path2: msg2').
    """
    details = format_validation_error(
        error,
        messages=messages,
        valid_actions=valid_actions,
        path_prefix=path_prefix,
        strip_messages_prefix=strip_messages_prefix,
    )
    return separator.join(f"{d.path}: {d.message}" for d in details)
