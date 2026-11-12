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

"""Wire keys of the component envelope mixin properties.

The `ComponentCommon` and `Checkable` mixins add `catalogId`, `metadata`,
`accessibility` and `checks` to every flat component object. From v1.0 these
keys carry an `@` prefix on the wire (`@catalogId`, `@metadata`,
`@accessibility`, `@checks`) so they never collide with properties a catalog
defines. Before v1.0 `accessibility` and `checks` are bare, and components
carry no `catalogId` or `metadata`. `id` and `component` stay bare in every
version.

Writers emit the key for the protocol version. Readers of v1.0 components also
accept the bare keys that payloads used before the cutover, unless the
component declares a custom property of that bare name.

This module is not public API.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping
from typing import Any, Final

ENVELOPE_MIXIN_NAMES: Final[tuple[str, ...]] = (
    "catalogId",
    "metadata",
    "accessibility",
    "checks",
)
"""The bare names of the component envelope mixin properties."""

AT_ENVELOPE_MIXIN_KEYS: Final[frozenset[str]] = frozenset(
    f"@{name}" for name in ENVELOPE_MIXIN_NAMES
)
"""The `@`-prefixed v1.0 wire keys of the component envelope mixin properties."""


def envelope_key(name: str, at_least_v10: bool) -> str:
    """Returns the wire key a writer uses for an envelope mixin property.

    Args:
        name: The bare mixin name, such as `checks`.
        at_least_v10: Whether the component targets A2UI v1.0 or later.

    Returns:
        `@<name>` from v1.0, otherwise `name`.
    """
    return f"@{name}" if at_least_v10 else name


def envelope_read_key(
    component: Mapping[str, Any],
    name: str,
    *,
    at_least_v10: bool,
    custom_properties: Collection[str] = (),
) -> str | None:
    """Returns the key that holds an envelope mixin property on a component.

    From v1.0 the `@`-prefixed key wins. The bare key is the legacy fallback
    unless `custom_properties` names it, in which case it is an ordinary
    catalog property.

    Args:
        component: The flat component object.
        name: The bare mixin name, such as `checks`.
        at_least_v10: Whether the component targets A2UI v1.0 or later.
        custom_properties: Bare names the component's schema declares as its
            own properties rather than as the standard mixin.

    Returns:
        The key present on `component`, or None when neither key is present.
    """
    if at_least_v10:
        at_key = f"@{name}"
        if at_key in component:
            return at_key
        if name in custom_properties:
            return None
    return name if name in component else None


def get_envelope_value(
    component: Mapping[str, Any],
    name: str,
    *,
    at_least_v10: bool,
    custom_properties: Collection[str] = (),
) -> Any:
    """Reads an envelope mixin property from a component.

    See `envelope_read_key` for which key is read.

    Returns:
        The value, or None when the component does not set it.
    """
    key = envelope_read_key(
        component,
        name,
        at_least_v10=at_least_v10,
        custom_properties=custom_properties,
    )
    return component.get(key) if key is not None else None


def is_envelope_key(
    key: str,
    *,
    at_least_v10: bool,
    custom_properties: Collection[str] = (),
) -> bool:
    """Returns whether a component key holds an envelope mixin property.

    Args:
        key: A key of a flat component object.
        at_least_v10: Whether the component targets A2UI v1.0 or later.
        custom_properties: Bare names the component's schema declares as its
            own properties rather than as the standard mixin.
    """
    if key in AT_ENVELOPE_MIXIN_KEYS:
        return at_least_v10
    return key in ENVELOPE_MIXIN_NAMES and key not in custom_properties


__all__ = [
    "AT_ENVELOPE_MIXIN_KEYS",
    "ENVELOPE_MIXIN_NAMES",
    "envelope_key",
    "envelope_read_key",
    "get_envelope_value",
    "is_envelope_key",
]
