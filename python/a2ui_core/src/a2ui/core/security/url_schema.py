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

"""Marks catalog properties as URLs with the `x-a2ui-url-context` keyword."""

from __future__ import annotations

from typing import Any, Final

from .url_security_policy import UrlContextAnnotation, is_url_context_annotation

URL_CONTEXT_KEYWORD: Final[str] = "x-a2ui-url-context"
"""The catalog JSON Schema keyword that marks a property as a URL."""


def url_property(context: UrlContextAnnotation) -> dict[str, str]:
    """Returns the schema keywords that mark a catalog property as a URL.

    The resolver passes every resolved value of a marked property through the
    surface's URL security policy, so the component receives the allowed (or
    rewritten) URL, or None when the policy blocks it. `"none"` states that a
    property whose name looks like a URL holds something else.

    Example:
        On a Pydantic component model, pass it as `json_schema_extra`::

            class ProductCardComponent(ComponentCommon):
                component: Literal["ProductCard"] = "ProductCard"
                image_url: DynamicString = Field(
                    alias="imageUrl", json_schema_extra=url_property("media")
                )

        In a JSON Schema written by hand, merge it into the property::

            {"$ref": "common_types.json#/$defs/DynamicString",
             **url_property("navigation")}

    Args:
        context: How the renderer uses the URL: `"media"`, `"navigation"`,
            `"iframe"`, or `"none"`.

    Returns:
        `{"x-a2ui-url-context": context}`.

    Raises:
        ValueError: If `context` is not one of the values above.
    """
    if not is_url_context_annotation(context):
        raise ValueError(
            f"Unknown URL context {context!r}: use 'media', 'navigation',"
            " 'iframe', or 'none'."
        )
    return {URL_CONTEXT_KEYWORD: context}


def url_context_of(schema: Any) -> UrlContextAnnotation | None:
    """Returns the URL context a property schema declares, if any.

    Args:
        schema: A property's JSON Schema.

    Returns:
        The value of its `x-a2ui-url-context` keyword, or None if it has none
        or the value is not a URL context annotation.
    """
    if not isinstance(schema, dict):
        return None
    value = schema.get(URL_CONTEXT_KEYWORD)
    return value if is_url_context_annotation(value) else None
