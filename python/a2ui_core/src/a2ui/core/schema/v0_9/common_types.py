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
from typing import Annotated, Any, Callable, Literal
from pydantic import (
    AfterValidator,
    BaseModel,
    Field,
    ConfigDict,
    StrictBool,
    StrictFloat,
    StrictInt,
    StrictStr,
    field_serializer,
    model_serializer,
)
from ..common_types import (
    Child,
    ChildList,
    ComponentId,
    ComponentReference,
    DataBinding,
    ListReference,
    SingleReference,
    StrictBaseModel,
    TemplateChildList,
)


class FunctionCall(StrictBaseModel):
    """Invokes a named function on the client."""

    model_config = ConfigDict(populate_by_name=True)
    call: str = Field(..., description="The name of the function to call.")
    args: dict[str, Any] | None = Field(
        None, description="Arguments passed to the function."
    )
    return_type: (
        Literal["string", "number", "boolean", "array", "object", "any", "void"] | None
    ) = Field(
        alias="returnType",
        description="The expected return type of the function call.",
        default="boolean",
    )

    # Hand-maintained: codegen_pydantic.py does not emit this serializer (or the
    # return-type validators below), so re-add them after regenerating this file.
    # The schema default for returnType is "boolean", but an unset or inferred
    # returnType is omitted from the serialized output.
    @model_serializer(mode="wrap")
    def _serialize_model(self, handler: Any) -> Any:
        d = handler(self)
        if isinstance(d, dict) and "return_type" not in self.model_fields_set:
            d.pop("returnType", None)
            d.pop("return_type", None)
        return d


def _make_return_type_validator(
    expected: str,
) -> Callable[[FunctionCall], FunctionCall]:
    def _validate_return_type(fc: FunctionCall) -> FunctionCall:
        if "return_type" in fc.model_fields_set:
            if fc.return_type != expected:
                raise ValueError(
                    f"FunctionCall in Dynamic type must have returnType '{expected}',"
                    f" got '{fc.return_type}'"
                )
            return fc
        if fc.return_type != expected:
            fc = fc.model_copy()
            object.__setattr__(fc, "return_type", expected)
        return fc

    return _validate_return_type


DynamicString = (
    StrictStr
    | DataBinding
    | Annotated[FunctionCall, AfterValidator(_make_return_type_validator("string"))]
)


class AccessibilityAttributes(StrictBaseModel):
    """Attributes to enhance accessibility when using assistive technologies like screen readers."""

    model_config = ConfigDict(populate_by_name=True)
    label: DynamicString | None = Field(
        None,
        description=(
            "A short string, typically 1 to 3 words, used by assistive technologies to"
            " convey the purpose or intent of an element. For example, an input field"
            " might have an accessible label of 'User ID' or a button might be labeled"
            " 'Submit'."
        ),
    )
    description: DynamicString | None = Field(
        None,
        description=(
            "Additional information provided by assistive technologies about an element"
            " such as instructions, format requirements, or result of an action. For"
            " example, a mute button might have a label of 'Mute' and a description of"
            " 'Silences notifications about this conversation'."
        ),
    )


class ComponentCommon(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: ComponentId = Field(...)
    accessibility: AccessibilityAttributes | None = Field(None)


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
    | Annotated[FunctionCall, AfterValidator(_make_return_type_validator("number"))]
)


DynamicBoolean = (
    StrictBool
    | DataBinding
    | Annotated[FunctionCall, AfterValidator(_make_return_type_validator("boolean"))]
)


DynamicStringList = (
    list[StrictStr]
    | DataBinding
    | Annotated[FunctionCall, AfterValidator(_make_return_type_validator("array"))]
)


class CheckRule(StrictBaseModel):
    """A single validation rule applied to an input component."""

    model_config = ConfigDict(populate_by_name=True)
    condition: DynamicBoolean = Field(...)
    message: str = Field(
        ..., description="The error message to display if the check fails."
    )


class Checkable(StrictBaseModel):
    """Properties for components that support client-side checks."""

    model_config = ConfigDict(populate_by_name=True)
    checks: list[CheckRule] | None = Field(
        None,
        description=(
            "A list of checks to perform. These are function calls that must return a"
            " boolean indicating validity."
        ),
    )


class ActionEvent(StrictBaseModel):
    """The event to dispatch to the server."""

    model_config = ConfigDict(populate_by_name=True)
    name: str = Field(
        ..., description="The name of the action to be dispatched to the server."
    )
    context: dict[str, DynamicValue] | None = Field(
        None,
        description=(
            "A JSON object containing the key-value pairs for the action context."
            " Values can be literals or paths. Use literal values unless the value must"
            " be dynamically bound to the data model. Do NOT use paths for static IDs."
        ),
    )


class ActionEventWrapper(StrictBaseModel):
    """Triggers a server-side event."""

    model_config = ConfigDict(populate_by_name=True)
    event: ActionEvent = Field(..., description="The event to dispatch to the server.")


class ActionFunctionCallWrapper(StrictBaseModel):
    """Executes a local client-side function."""

    model_config = ConfigDict(populate_by_name=True)
    function_call: FunctionCall = Field(..., alias="functionCall")


Action = ActionEventWrapper | ActionFunctionCallWrapper

__all__ = [
    "AccessibilityAttributes",
    "Action",
    "ActionEvent",
    "ActionEventWrapper",
    "ActionFunctionCallWrapper",
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
    "StrictBaseModel",
    "TemplateChildList",
]
