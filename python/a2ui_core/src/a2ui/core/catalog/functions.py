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

from collections.abc import Awaitable
from dataclasses import dataclass
import inspect
from typing import (
    Any,
    Callable,
    Generic,
    Literal,
    Type,
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
        description: str | None = None,
        is_definition: bool | None = None,
        from_document: bool = False,
    ):
        """Initializes the function API.

        Args:
            name: The function's name, which calls use as `call`.
            return_type: The type of the function's result.
            schema: The schema of the function's `args`, as a Pydantic model
                class or a JSON schema, or the function's whole definition
                as its catalog document writes it (a call schema, or a
                schema that declares `returnType`), without the `name` of a
                list entry. `Catalog.from_json` keeps each definition here
                unchanged, and `Catalog.to_json` writes it back. None, the
                default, means the function takes any args.
            allowed_callers: Who may call the function.
            requires_user_activation: Whether a call needs a user gesture.
            description: What the function does, published in the catalog
                schema.
            is_definition: Whether `schema` is the function's whole catalog
                document entry rather than the schema of its `args`, which
                `Catalog.to_json` writes as it is. `Catalog.from_json` sets
                it on every function it loads. None infers it from the
                schema: a call schema, or one that declares `returnType`,
                `parameters`, `allowedCallers` or `requiresUserActivation`.
            from_document: Whether `schema` was loaded from a catalog
                document, which `Catalog.from_json` sets on every function it
                loads. `Catalog.to_json` writes such a definition with its
                references exactly as they are; for a function defined in
                code, it points local references to common types at the
                catalog's `common_types_uri`.
        """
        self.name = name
        self.return_type = return_type or "any"
        self.schema = schema
        self.allowed_callers = allowed_callers or "rendererOnly"
        self.requires_user_activation = bool(requires_user_activation)
        self.description = (
            description
            if description is not None
            else getattr(self, "description", None)
        )
        self.is_definition = is_definition
        self.from_document = from_document


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
        description: str | None = None,
        is_definition: bool | None = None,
        from_document: bool = False,
    ):
        super().__init__(
            name=name,
            return_type=return_type,
            schema=schema,
            allowed_callers=allowed_callers,
            requires_user_activation=requires_user_activation,
            description=description,
            is_definition=is_definition,
            from_document=from_document,
        )
        self.execute_func = execute

    def execute(
        self,
        args: dict[str, Any],
        context: Any = None,
        abort_signal: Any | None = None,
    ) -> TReturn:
        """Runs the function with already-validated, already-resolved arguments.

        ``execute`` does not validate ``args``. The argument schema describes
        the arguments as written in a payload (a ``DynamicBoolean`` admits a
        ``{"@call": ...}``), so it applies before bindings and nested calls are
        resolved, not to the resolved values this method receives. The caller
        validates the written arguments, with
        ``PayloadValidator.validate_function`` or the schema model directly,
        resolves them, and then calls ``execute``. ``DataContext`` does this
        for every call it evaluates.

        Args:
            args: The named arguments, resolved to plain values.
            context: The data context the call is evaluated in.
            abort_signal: Cancels a long-running call.
        """
        if self.execute_func is None:
            raise ValueError(f"Function {self.name} has no executable logic.")
        exec_fn = cast(Callable[..., TReturn], self.execute_func)
        try:
            sig = inspect.signature(exec_fn)
            param_count = len(sig.parameters)
        except (ValueError, TypeError):
            param_count = 3

        if param_count >= 3:
            return exec_fn(args, context, abort_signal)
        elif param_count == 2:
            return exec_fn(args, context)
        else:
            return exec_fn(args)


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
        description=getattr(api, "description", None),
        is_definition=getattr(api, "is_definition", None),
        from_document=getattr(api, "from_document", False),
    )


@dataclass(frozen=True)
class AgentFunctionContext:
    """Where an agent function call came from.

    Attributes:
        catalog_id: The catalog the renderer resolved the call to.
        surface_id: The surface the call was made on.
        function_call_id: The ID that the response must copy.
    """

    catalog_id: str
    surface_id: str
    function_call_id: str


AgentFunctionHandler = Callable[
    [dict[str, Any], AgentFunctionContext], Any | Awaitable[Any]
]
"""Runs an agent function call.

Receives the call's arguments, validated against the function's schema with
its defaults applied, and the context of the call. Returns the value to send
back, directly or as an awaitable.
"""


class AgentFunction(FunctionApi):
    """A catalog function that runs on the agent.

    A renderer has no implementation for it, so from v1.0 it sends calls to
    the agent with `callAgentFunction`, and the agent runs `handler`. Add
    agent functions to the agent's copy of a catalog with
    `Catalog(agent_functions=...)` or `Catalog.copy_with(agent_functions=...)`,
    so that validation and prompts treat them like any other function of the
    catalog. The catalog document lists them like functions without an
    implementation, and never includes the handler.

    An agent function has no `execute` method, so a renderer core that is
    handed a catalog containing one treats it as declared but not
    implemented.
    """

    def __init__(
        self,
        name: str,
        *,
        handler: AgentFunctionHandler,
        return_type: FunctionReturnType | None = "any",
        schema: Any = None,
        allowed_callers: AllowedCallers | None = "rendererOnly",
        requires_user_activation: bool | None = False,
        description: str | None = None,
        is_definition: bool | None = None,
        from_document: bool = False,
    ):
        """Initializes the agent function.

        Args:
            name: The function's name, which calls use as `@call`.
            handler: Runs a call on the agent.
            return_type: The type of the function's result.
            schema: The schema of the function's `args`, as `FunctionApi`
                takes it.
            allowed_callers: Who may call the function. The default,
                `rendererOnly`, lets renderers call it; `agentOnly` would
                make renderers refuse to call it at all.
            requires_user_activation: Whether a call needs a user gesture.
            description: What the function does, published in the catalog
                schema and the prompt.
            is_definition: Whether `schema` is the function's whole catalog
                document entry, as `FunctionApi` takes it.
            from_document: Whether `schema` was loaded from a catalog
                document, as `FunctionApi` takes it.

        Raises:
            TypeError: If `handler` is not callable.
        """
        if not callable(handler):
            raise TypeError(f"Agent function '{name}' needs a callable handler.")
        super().__init__(
            name=name,
            return_type=return_type,
            schema=schema,
            allowed_callers=allowed_callers,
            requires_user_activation=requires_user_activation,
            description=description,
            is_definition=is_definition,
            from_document=from_document,
        )
        self.handler = handler
        self._declaration: FunctionApi | None = None

    @property
    def declaration(self) -> FunctionApi | None:
        """The catalog entry this function was built from with `from_api`, if any."""
        return self._declaration

    @classmethod
    def from_api(
        cls, api: FunctionApi, handler: AgentFunctionHandler
    ) -> "AgentFunction":
        """Builds an agent function from a function a catalog already declares.

        Use it when the catalog document declares the function, so that its
        definition stays as written: a catalog takes the result in place of
        `api` instead of rejecting it as a second function of that name.

        Args:
            api: The catalog's entry for the function.
            handler: Runs a call on the agent.

        Returns:
            The agent function, with `api`'s name, schema and metadata.
        """
        agent_function = cls(
            api.name,
            handler=handler,
            return_type=api.return_type,
            schema=api.schema,
            allowed_callers=api.allowed_callers,
            requires_user_activation=api.requires_user_activation,
            description=api.description,
            is_definition=api.is_definition,
            from_document=api.from_document,
        )
        agent_function._declaration = api
        return agent_function


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
