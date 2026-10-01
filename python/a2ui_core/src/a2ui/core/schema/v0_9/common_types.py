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

# Auto-generated. Do not edit manually.
from __future__ import annotations
from typing import TYPE_CHECKING, Annotated, Any, Callable, Final, Literal, TypeAlias, Union
from pydantic import (
    AfterValidator,
    BaseModel,
    Field,
    ConfigDict,
    StrictBool,
    StrictFloat,
    StrictInt,
    StrictStr,
    model_serializer,
)
from typing_extensions import TypeAliasType
from .._json_schema import (
    JsonSchemaAs,
    KeepAnyOf,
    OpenObject,
    ReturnType,
    SchemaKeywords,
    catalog_functions,
)
from ..common_types import (
    Child,
    ChildList,
    ComponentId,
    ComponentReference,
    DataBinding,
    ListReference,
    SingleReference,
    SpecBaseModel,
    StrictBaseModel,
    TemplateChildList,
)


def _reject_null_values(value: dict[str, Any]) -> dict[str, Any]:
    nulls = sorted(key for key, item in value.items() if item is None)
    if nulls:
        raise ValueError(f"Values must not be null: {nulls}")
    return value


class FunctionCall(SpecBaseModel):
    """Invokes a named function on the client."""

    model_config = ConfigDict(
        json_schema_extra=SchemaKeywords(
            {"oneOf": [catalog_functions()]},
            drop=("additionalProperties",),
            spec_only=True,
        ),
        populate_by_name=True,
    )
    call: str = Field(..., description="The name of the function to call.")
    args: (
        Annotated[
            dict[str, Any],
            AfterValidator(_reject_null_values),
            _FUNCTION_CALL_ARGS_SCHEMA,
        ]
        | None
    ) = Field(default=None, description="Arguments passed to the function.")
    return_type: (
        Literal["string", "number", "boolean", "array", "object", "any", "void"] | None
    ) = Field(
        default=None,
        alias="returnType",
        description="The expected return type of the function call.",
        json_schema_extra={"default": "boolean"},
    )

    # Hand-maintained: omit an inferred return type from serialized calls.
    @model_serializer(mode="wrap")
    def _serialize_model(self, handler: Any) -> Any:
        d = handler(self)
        if isinstance(d, dict) and "return_type" not in self.model_fields_set:
            d.pop("returnType", None)
            d.pop("return_type", None)
        return d


DynamicString = StrictStr | DataBinding | Annotated[FunctionCall, ReturnType("string")]


class AccessibilityAttributes(SpecBaseModel):
    """Attributes to enhance accessibility when using assistive technologies like screen readers."""

    model_config = ConfigDict(
        json_schema_extra=SchemaKeywords(drop=("additionalProperties",)),
        extra="allow",
        populate_by_name=True,
    )
    label: DynamicString | None = Field(
        default=None,
        description=(
            "A short string, typically 1 to 3 words, used by assistive technologies to"
            " convey the purpose or intent of an element. For example, an input field"
            " might have an accessible label of 'User ID' or a button might be labeled"
            " 'Submit'."
        ),
    )
    description: DynamicString | None = Field(
        default=None,
        description=(
            "Additional information provided by assistive technologies about an element"
            " such as instructions, format requirements, or result of an action. For"
            " example, a mute button might have a label of 'Mute' and a description of"
            " 'Silences notifications about this conversation'."
        ),
    )


class ComponentCommon(SpecBaseModel):
    model_config = ConfigDict(
        json_schema_extra=SchemaKeywords(drop=("additionalProperties",)),
        populate_by_name=True,
    )
    id: ComponentId = Field(...)
    accessibility: AccessibilityAttributes | None = Field(default=None)


DynamicValue = (
    StrictStr
    | StrictFloat
    | StrictInt
    | StrictBool
    | list[Any]
    | DataBinding
    | FunctionCall
)


DynamicNumber = (
    StrictFloat
    | StrictInt
    | DataBinding
    | Annotated[FunctionCall, ReturnType("number")]
)


DynamicBoolean = (
    StrictBool | DataBinding | Annotated[FunctionCall, ReturnType("boolean")]
)


DynamicStringList = (
    list[StrictStr] | DataBinding | Annotated[FunctionCall, ReturnType("array")]
)


class CheckRule(SpecBaseModel):
    """A single validation rule applied to an input component."""

    model_config = ConfigDict(populate_by_name=True)
    condition: DynamicBoolean = Field(...)
    message: str = Field(
        ..., description="The error message to display if the check fails."
    )


class Checkable(SpecBaseModel):
    """Properties for components that support client-side checks."""

    model_config = ConfigDict(
        json_schema_extra=SchemaKeywords(drop=("additionalProperties",)),
        extra="allow",
        populate_by_name=True,
    )
    checks: list[CheckRule] | None = Field(
        default=None,
        description=(
            "A list of checks to perform. These are function calls that must return a"
            " boolean indicating validity."
        ),
    )


class ActionEvent(SpecBaseModel):
    """The event to dispatch to the server."""

    model_config = ConfigDict(populate_by_name=True)
    name: str = Field(
        ..., description="The name of the action to be dispatched to the server."
    )
    context: dict[str, DynamicValue] | None = Field(
        default=None,
        description=(
            "A JSON object containing the key-value pairs for the action context."
            " Values can be literals or paths. Use literal values unless the value must"
            " be dynamically bound to the data model. Do NOT use paths for static IDs."
        ),
    )


class ActionEventWrapper(SpecBaseModel):
    """Triggers a server-side event."""

    model_config = ConfigDict(populate_by_name=True)
    event: ActionEvent = Field(..., description="The event to dispatch to the server.")


class ActionFunctionCallWrapper(SpecBaseModel):
    """Executes a local client-side function."""

    model_config = ConfigDict(populate_by_name=True)
    function_call: FunctionCall = Field(..., alias="functionCall")


Action = TypeAliasType("Action", ActionEventWrapper | ActionFunctionCallWrapper)


if TYPE_CHECKING:
    _DynamicValueRef: TypeAlias = DynamicValue
else:
    _DynamicValueRef = TypeAliasType("DynamicValue", DynamicValue)


_FUNCTION_CALL_ARGS_SCHEMA = JsonSchemaAs(
    dict[
        str,
        Annotated[
            Union[
                _DynamicValueRef,
                Annotated[
                    OpenObject,
                    Field(
                        description="A literal object argument (e.g. configuration)."
                    ),
                ],
            ],
            KeepAnyOf(),
        ],
    ]
)


FunctionCall.model_rebuild()


COMMON_TYPES_DEFS: Final[dict[str, Any]] = {
    "ComponentId": Annotated[
        ComponentId,
        Field(
            description=(
                "The unique identifier for a component, used for both definitions and"
                " references within the same surface."
            )
        ),
    ],
    "AccessibilityAttributes": AccessibilityAttributes,
    "ComponentCommon": ComponentCommon,
    "ChildList": (
        Annotated[
            list[ComponentId],
            Field(description="A static list of child component IDs."),
        ]
        | TemplateChildList
    ),
    "DataBinding": DataBinding,
    "DynamicValue": Annotated[
        DynamicValue,
        Field(
            description=(
                "A value that can be a literal, a path, or a function call returning"
                " any type."
            )
        ),
    ],
    "DynamicString": Annotated[DynamicString, Field(description="Represents a string")],
    "DynamicNumber": Annotated[
        DynamicNumber,
        Field(
            description=(
                "Represents a value that can be either a literal number, a path to a"
                " number in the data model, or a function call returning a number."
            )
        ),
    ],
    "DynamicBoolean": Annotated[
        DynamicBoolean,
        Field(
            description=(
                "A boolean value that can be a literal, a path, or a function call"
                " returning a boolean."
            )
        ),
    ],
    "DynamicStringList": Annotated[
        DynamicStringList,
        Field(
            description=(
                "Represents a value that can be either a literal array of strings, a"
                " path to a string array in the data model, or a function call"
                " returning a string array."
            )
        ),
    ],
    "FunctionCall": FunctionCall,
    "CheckRule": CheckRule,
    "Checkable": Checkable,
    "Action": Annotated[
        Action,
        Field(
            description=(
                "Defines an interaction handler that can either trigger a server-side"
                " event or execute a local client-side function."
            )
        ),
    ],
}

__all__ = [
    "AccessibilityAttributes",
    "Action",
    "ActionEvent",
    "ActionEventWrapper",
    "ActionFunctionCallWrapper",
    "COMMON_TYPES_DEFS",
    "CheckRule",
    "Checkable",
    "Child",
    "ChildList",
    "ComponentCommon",
    "ComponentId",
    "ComponentReference",
    "DataBinding",
    "DynamicBoolean",
    "DynamicNumber",
    "DynamicString",
    "DynamicStringList",
    "DynamicValue",
    "FunctionCall",
    "ListReference",
    "SingleReference",
    "SpecBaseModel",
    "StrictBaseModel",
    "TemplateChildList",
]
