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

"""Catalog enums that are strict when authoring and open when parsing.

Authoring wants the narrowest possible type: ``variant="bdoy"`` should be caught
by the type checker and again at runtime. Parsing wants the opposite, because a
client may legitimately send a value from a newer catalog revision than the one
this SDK was generated from, and dropping it would be worse than keeping it.

Widening the annotation to ``Literal[...] | str`` would serve parsing at the cost
of authoring: the type checker stops rejecting anything. Instead the annotation
stays the strict ``Literal`` and the relaxation is carried by the validation
context, so the two modes are separated rather than averaged.
"""

from __future__ import annotations

from typing import Any, Mapping

from pydantic import (
    ValidationError,
    ValidationInfo,
    ValidatorFunctionWrapHandler,
    WrapValidator,
)

# Namespaced so a caller-supplied validation context cannot collide with ours.
LENIENT_ENUMS_KEY = "a2ui.lenient_enums"

LENIENT_ENUM_CONTEXT: Mapping[str, Any] = {LENIENT_ENUMS_KEY: True}
"""Pass as ``model_validate(..., context=LENIENT_ENUM_CONTEXT)`` to accept unknown enum values."""


def _validate_open_enum(
    value: Any,
    handler: ValidatorFunctionWrapHandler,
    info: ValidationInfo,
) -> Any:
    try:
        return handler(value)
    except ValidationError:
        context = info.context
        lenient = isinstance(context, Mapping) and context.get(LENIENT_ENUMS_KEY)
        if lenient and isinstance(value, str):
            # Forward-compatibility: a value from a newer catalog revision.
            return value
        raise


OPEN_ENUM = WrapValidator(_validate_open_enum)
"""Annotation metadata marking an enum strict when authoring, permissive when parsing.

Used as ``Annotated[Literal["a", "b"], OPEN_ENUM]``. It is deliberately a piece
of ``Annotated`` metadata rather than a wrapper function: a type checker strips
``Annotated`` metadata and still sees the bare ``Literal``, so completion and
the edit-time rejection of an unknown variant are unaffected. A function
returning the annotation would erase the ``Literal`` and silently give up the
static checking this is meant to preserve.
"""

