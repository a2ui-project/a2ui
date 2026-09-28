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

"""Catalog enum validator: strict ``Literal`` during authoring, open ``str`` when ``OPEN_ENUM_CONTEXT`` is set."""

from __future__ import annotations

from typing import Any, Mapping

from pydantic import (
    ValidationError,
    ValidationInfo,
    ValidatorFunctionWrapHandler,
    WrapValidator,
)

OPEN_ENUM_KEY = "a2ui.open_enums"

OPEN_ENUM_CONTEXT: Mapping[str, Any] = {OPEN_ENUM_KEY: True}
"""Pass as ``model_validate(..., context=OPEN_ENUM_CONTEXT)`` to accept unknown enum values."""


def _validate_open_enum(
    value: Any,
    handler: ValidatorFunctionWrapHandler,
    info: ValidationInfo,
) -> Any:
    try:
        return handler(value)
    except ValidationError:
        context = info.context
        open_enums = isinstance(context, Mapping) and (
            context.get(OPEN_ENUM_KEY) or context.get("a2ui.lenient_enums")
        )
        if open_enums and isinstance(value, str):
            return value
        raise


OPEN_ENUM = WrapValidator(_validate_open_enum)
"""``Annotated`` validator metadata preserving static ``Literal`` checking while allowing open runtime parsing."""
