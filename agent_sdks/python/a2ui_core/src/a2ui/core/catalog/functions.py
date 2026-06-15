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

from typing import Any, Callable, Dict, Optional


class FunctionApi:
    """The API definition of a catalog function (schema-only)."""

    def __init__(
        self,
        name: str,
        return_type: str,
        schema: Any,
    ):
        self.name = name
        self.return_type = return_type
        self.schema = schema


class FunctionImplementation(FunctionApi):
    """Extends FunctionApi with executable Python logic and runtime validation."""

    def __init__(
        self,
        name: str,
        return_type: str,
        schema: Any,
        execute: Callable[[Dict[str, Any], Any, Optional[Any]], Any],
    ):
        super().__init__(name, return_type, schema)
        self.execute_func = execute

    def execute(
        self,
        args: Dict[str, Any],
        context: Any = None,
        abort_signal: Optional[Any] = None,
    ) -> Any:
        if self.schema and hasattr(self.schema, "model_validate"):
            safe_args = self.schema.model_validate(args).model_dump(by_alias=True)
        else:
            safe_args = args
        return self.execute_func(safe_args, context, abort_signal)


def create_function_implementation(
    api: Any, execute: Callable[[Dict[str, Any], Any, Optional[Any]], Any]
) -> FunctionImplementation:
    """Creates a FunctionImplementation from a FunctionApi specification and an executable closure."""
    name = getattr(api, "name", "")
    return_type = getattr(api, "return_type", "any")
    schema = getattr(api, "schema", None)

    return FunctionImplementation(name, return_type, schema, execute)


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
FunctionInvoker = Callable[[str, Dict[str, Any], Any, Optional[Any]], Any]
