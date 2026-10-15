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

A system function is defined once, here, in terms of the types of the protocol
version that introduced it (`a2ui.core.schema.v1_0.common_types` for `@index`),
and remains available in every version after that, so a new protocol version
inherits the whole set without registering anything. A version that wants these
functions in its catalog references them, as
`basic_catalog/v1_0/function_impls.py` does.
"""

from __future__ import annotations

from typing import Any

from pydantic import Field

from ..common.semver import is_at_least_version
from ..exceptions import A2uiValidationError
from ..schema import ProtocolVersion
from ..schema.common_types import StrictBaseModel
from ..schema.v1_0.common_types import DynamicNumber
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

    offset: DynamicNumber | None = Field(
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
    try:
        offset_val = int(offset) if offset is not None else 0
    except (TypeError, ValueError) as exc:
        raise A2uiValidationError(
            f"@index requires a numeric offset, got {offset!r}."
        ) from exc
    raw_index: Any = None
    if context is not None:
        # A sequence context has an `index` method, not an iteration index.
        attr_index = getattr(context, "index", None)
        if attr_index is not None and not callable(attr_index):
            raw_index = attr_index
        elif isinstance(context, dict):
            raw_index = context.get("index")

    if raw_index is None:
        if context is not None:
            raise A2uiValidationError(
                "@index function can only be evaluated inside a collection template"
                " iteration scope."
            )
        return offset_val

    try:
        idx = int(raw_index)
    except (TypeError, ValueError) as exc:
        raise A2uiValidationError(
            f"@index requires a numeric iteration index, got {raw_index!r}."
        ) from exc
    return idx + offset_val


IndexImplementation = create_function_implementation(IndexApi, _index_execute)

SYSTEM_FUNCTIONS: list[FunctionImplementation] = [IndexImplementation]

# The protocol version that introduced each system function. A function stays
# available in version >= the version it was introduced in.
INTRODUCED_IN: dict[str, str] = {
    INDEX_FUNCTION_NAME: "1.0",
}


def system_functions_for(
    version: ProtocolVersion | str | None,
) -> dict[str, FunctionImplementation]:
    """Returns the system functions available to a protocol version, by name.

    An unversioned catalog (`version` is None) predates system functions and
    gets none.
    """
    return {
        implementation.name: implementation
        for implementation in SYSTEM_FUNCTIONS
        if is_at_least_version(version, INTRODUCED_IN[implementation.name])
    }


def is_system_function_name(name: str) -> bool:
    """Returns whether a function name is in the reserved `@` system namespace.

    From v1.0 a call to such a name belongs to no catalog: it is resolved
    against the system functions, never against a component catalog.
    """
    return name.startswith("@")


__all__ = [
    "INDEX_FUNCTION_NAME",
    "INTRODUCED_IN",
    "SYSTEM_FUNCTIONS",
    "IndexApi",
    "IndexArgs",
    "IndexImplementation",
    "is_system_function_name",
    "system_functions_for",
]
