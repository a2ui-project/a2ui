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

"""System functions the runtime supplies to every catalog.

The protocol reserves the `@` namespace for functions the renderer provides, so
a system function is available to any catalog whose protocol version defines it,
including catalogs that never declare it.

A system function is defined once, here, in terms of the version-neutral types
in `a2ui.core.schema.common_types`. It carries the protocol version that
introduced it and remains available in every version after that, so a new
protocol version inherits the whole set without registering anything. A version
that wants these functions in its catalog references them, as
`basic_catalog/v1_0/function_impls.py` does.
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import Field

from ..common.semver import is_at_least_version
from ..schema.common_types import DynamicNumber, StrictBaseModel
from .functions import (
    FunctionApi,
    FunctionImplementation,
    create_function_implementation,
)

INDEX_FUNCTION_NAME = "@index"


# Arguments of the `@index` system function. Pydantic serializes a docstring
# into the catalog schema as a `description`, and the specification gives this
# object none, so the explanation stays out here.
class IndexArgs(StrictBaseModel):

    offset: Optional[DynamicNumber] = Field(
        None,
        description=(
            "Optional. An offset to add to the 0-based index (e.g., 1 for 1-based"
            " indexing). Defaults to 0."
        ),
    )


class IndexApi(FunctionApi):
    """Computes the iteration index of the item being rendered.

    Evaluates the 0-based iteration index with an optional numeric offset.
    """

    name = INDEX_FUNCTION_NAME
    schema = IndexArgs
    return_type = "number"
    allowed_callers = "rendererOnly"


def _index_execute(
    args: dict[str, Any],
    context: Any = None,
    abort_signal: Any | None = None,
) -> int:
    offset = args.get("offset")
    offset_val = int(offset) if offset is not None else 0
    idx: int | None = None
    if context is not None:
        if hasattr(context, "index") and getattr(context, "index") is not None:
            idx = int(getattr(context, "index"))
        elif (
            isinstance(context, dict)
            and "index" in context
            and context["index"] is not None
        ):
            idx = int(context["index"])

    if idx is None:
        if context is not None:
            from ..exceptions import A2uiValidationError

            raise A2uiValidationError(
                "@index function can only be evaluated inside a collection template"
                " iteration scope."
            )
        idx = 0

    return idx + offset_val


IndexImplementation = create_function_implementation(IndexApi, _index_execute)

SYSTEM_FUNCTIONS: list[FunctionImplementation] = [IndexImplementation]

# The protocol version that introduced each system function. A function stays
# available in version >= the version it was introduced in.
INTRODUCED_IN: dict[str, str] = {
    INDEX_FUNCTION_NAME: "1.0",
}


def system_functions_for(version: Any) -> dict[str, FunctionImplementation]:
    """Returns the system functions available to a protocol version, by name."""
    return {
        implementation.name: implementation
        for implementation in SYSTEM_FUNCTIONS
        if is_at_least_version(version, INTRODUCED_IN[implementation.name])
    }


__all__ = [
    "INDEX_FUNCTION_NAME",
    "INTRODUCED_IN",
    "SYSTEM_FUNCTIONS",
    "IndexApi",
    "IndexArgs",
    "IndexImplementation",
    "system_functions_for",
]
