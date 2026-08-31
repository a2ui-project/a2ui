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

from typing import (
    Any,
    Callable,
    Dict,
    Generic,
    List,
    Literal,
    Optional,
    Type,
    Union,
    cast,
)
from typing_extensions import TypeVar

AllowedCallers = Literal["rendererOnly", "agentOnly", "rendererOrAgent"]
FunctionReturnType = Literal[
    "string",
    "number",
    "boolean",
    "array",
    "object",
    "validationResult",
    "any",
    "void",
]

# InferA2uiReturnType mapping in Python: maps FunctionReturnType to concrete Python return types
InferA2uiReturnType = str | int | float | bool | list[Any] | dict[str, Any] | None | Any

TReturn = TypeVar("TReturn", bound=InferA2uiReturnType, default=Any)


class FunctionApi:
    """The API definition of a catalog function (schema-only)."""

    def __init__(
        self,
        name: str,
        return_type: FunctionReturnType | None = "any",
        schema: Any = None,
        allowed_callers: AllowedCallers | None = "rendererOnly",
        requires_user_activation: bool | None = False,
    ):
        self.name = name
        self.return_type = return_type or "any"
        self.schema = schema
        self.allowed_callers = allowed_callers or "rendererOnly"
        self.requires_user_activation = bool(requires_user_activation)


class FunctionImplementation(FunctionApi, Generic[TReturn]):
    """Extends FunctionApi with executable Python logic and runtime validation."""

    def __init__(
        self,
        name: str,
        return_type: FunctionReturnType | None = "any",
        schema: Any = None,
        execute: Callable[[dict[str, Any], Any, Any | None], TReturn] | None = None,
        allowed_callers: AllowedCallers | None = "rendererOnly",
        requires_user_activation: bool | None = False,
    ):
        super().__init__(
            name=name,
            return_type=return_type,
            schema=schema,
            allowed_callers=allowed_callers,
            requires_user_activation=requires_user_activation,
        )
        self.execute_func = execute

    def execute(
        self,
        args: dict[str, Any],
        context: Any = None,
        abort_signal: Any | None = None,
    ) -> TReturn:
        if self.execute_func is None:
            raise ValueError(f"Function {self.name} has no executable logic.")
        if self.schema and hasattr(self.schema, "model_validate"):
            safe_args = self.schema.model_validate(args).model_dump(by_alias=True)
        else:
            safe_args = args
        return self.execute_func(safe_args, context, abort_signal)


def create_function_implementation(
    api: FunctionApi | Type[FunctionApi],
    execute: Callable[[dict[str, Any], Any, Any | None], TReturn],
) -> FunctionImplementation[TReturn]:
    """Creates a FunctionImplementation from a FunctionApi specification and an executable closure."""
    return FunctionImplementation[TReturn](
        name=getattr(api, "name", ""),
        return_type=getattr(api, "return_type", "any"),
        schema=getattr(api, "schema", None),
        execute=execute,
        allowed_callers=getattr(api, "allowed_callers", "rendererOnly"),
        requires_user_activation=getattr(api, "requires_user_activation", False),
    )


"""
A function that invokes a catalog function by name and returns its result synchronously.

Parameters:
    name: The name of the function to invoke.
    args: The arguments to pass to the function.
    context: The data context in which the function is being executed.
    abort_signal: An optional AbortSignal for asynchronous or long-running operations.

Returns:
    The result of the function call (e.g. literal, list, dict, or None).
"""
FunctionInvoker = Callable[[str, dict[str, Any], Any, Any | None], Any]
