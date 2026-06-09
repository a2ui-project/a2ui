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

# Auto-generated. Do not edit manually.
from typing import Any, Callable, Dict, Optional, Type


class FunctionApi:
    """Represents a specification for a catalog function schema."""

    name: str = ""
    return_type: str = "any"
    schema: Any = None

    def __init__(
        self,
        name: Optional[str] = None,
        return_type: Optional[str] = None,
        schema: Optional[Type[Any]] = None,
    ):
        self.name = name or getattr(self.__class__, "name", "")
        self.return_type = return_type or getattr(
            self.__class__, "return_type", getattr(self.__class__, "returnType", "any")
        )
        self.schema = schema or getattr(
            self.__class__, "schema", getattr(self.__class__, "args", None)
        )

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        if not getattr(cls, "name", None):
            cls.name = getattr(cls, "call", "")
        if not getattr(cls, "return_type", None):
            cls.return_type = getattr(cls, "returnType", "any")
        if not getattr(cls, "schema", None):
            cls.schema = getattr(cls, "args", None)
            if not cls.schema and hasattr(cls, "__annotations__"):
                cls.schema = cls.__annotations__.get("args", None)


class FunctionImplementation(FunctionApi):
    """A Function Api combined with an executable execution implementation."""

    def __init__(self, name: str, return_type: str, schema: Any):
        super().__init__(name=name, return_type=return_type, schema=schema)

    def execute(
        self,
        args: Dict[str, Any],
        context: Any = None,
        abort_signal: Optional[Any] = None,
    ) -> Any:
        """Executes the functional implementation with validated, coerced arguments."""
        raise NotImplementedError("Subclasses must override and implement execute()")


def create_function_implementation(
    api: Any, execute: Callable[[Dict[str, Any], Any, Optional[Any]], Any]
) -> FunctionImplementation:
    """Utility helper to dynamically compose an API specification with an executable closure."""

    class DynamicFunctionImplementation(FunctionImplementation):

        def __init__(self):
            # Extract attributes from Api class or Api instance
            name = getattr(api, "name", getattr(api.__class__, "name", ""))
            return_type = getattr(
                api,
                "return_type",
                getattr(
                    api,
                    "returnType",
                    getattr(
                        api.__class__,
                        "return_type",
                        getattr(api.__class__, "returnType", "any"),
                    ),
                ),
            )
            schema = getattr(
                api,
                "schema",
                getattr(
                    api,
                    "args",
                    getattr(
                        api.__class__, "schema", getattr(api.__class__, "args", None)
                    ),
                ),
            )
            super().__init__(name=name, return_type=return_type, schema=schema)

        def execute(
            self,
            args: Dict[str, Any],
            context: Any = None,
            abort_signal: Optional[Any] = None,
        ) -> Any:
            return execute(args, context, abort_signal)

    return DynamicFunctionImplementation()


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
