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
from typing import Annotated, Any, Callable, Final, Literal, Union
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
from pydantic import GetJsonSchemaHandler, model_validator
from pydantic.json_schema import JsonSchemaValue
from pydantic_core import CoreSchema
from typing_extensions import TypeAliasType
from .._json_schema import (
    INLINE_DEF_MARKER,
    KEEP_ANY_OF_MARKER,
    SPEC_TITLE_KEY,
    JsonSchemaKeywords,
    OpenObject,
    catalog_functions,
    is_identifier_key,
    is_spec_schema,
    model_ref,
)
from ..common_types import (
    Child,
    ChildList,
    ComponentId,
    ComponentReference,
    ListReference,
    SingleReference,
    StrictBaseModel,
    TemplateChildList,
)


class DataBinding(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    path: str = Field(
        ...,
        alias="@path",
        description="A JSON Pointer path to a value in the data model.",
    )


class FunctionCommon(StrictBaseModel):
    """Baseline envelope properties common to all function calls. Function-specific argument schemas ('args') are defined individually by each function in the active catalog."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)
    call: str = Field(..., description="The name of the function to call.")
    catalog_id: str | None = Field(
        default=None,
        alias="catalogId",
        description=(
            "The catalog ID for this function, overriding any surface-level default"
            " catalogId."
        ),
    )

    @classmethod
    def __get_pydantic_json_schema__(
        cls, core_schema: CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        json_schema = handler(core_schema)
        if cls is not FunctionCommon:
            return json_schema
        target = handler.resolve_ref_schema(json_schema)
        target.pop("additionalProperties", None)
        return json_schema

    @model_validator(mode="before")
    @classmethod
    def _reject_null_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            nulls = [
                key
                for key in ("catalogId", "catalog_id")
                if key in data and data[key] is None
            ]
            if nulls:
                raise ValueError(f"{cls.__name__} fields must not be null: {nulls}")
        return data


class FunctionCall(StrictBaseModel):
    """Invokes a named function, combining common function properties with the catalog function definition."""

    model_config = ConfigDict(populate_by_name=True)
    call: str = Field(
        ..., alias="@call", description="The name of the function to call."
    )
    args: dict[str, Any] | None = Field(
        default=None, description="Arguments passed to the function."
    )
    catalog_id: str | None = Field(
        default=None,
        alias="catalogId",
        description=(
            "The catalog ID for this function, overriding any surface-level default"
            " catalogId."
        ),
    )

    @classmethod
    def __get_pydantic_json_schema__(
        cls, core_schema: CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        if not is_spec_schema() or cls is not FunctionCall:
            return handler(core_schema)
        return {
            "type": "object",
            "description": (
                "Invokes a named function, combining common function properties with"
                " the catalog function definition."
            ),
            "allOf": [
                model_ref(FunctionCommon, handler),
                {
                    "oneOf": [
                        catalog_functions(),
                        model_ref(IndexSystemFunction, handler),
                    ]
                },
            ],
            "unevaluatedProperties": False,
        }

    @model_validator(mode="before")
    @classmethod
    def _reject_null_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            nulls = [
                key
                for key in ("args", "catalogId", "catalog_id")
                if key in data and data[key] is None
            ]
            if nulls:
                raise ValueError(f"{cls.__name__} fields must not be null: {nulls}")
        return data


CallId = TypeAliasType("CallId", str)


DynamicString = StrictStr | DataBinding | FunctionCall


DynamicBoolean = StrictBool | DataBinding | FunctionCall


class AccessibilityAttributes(StrictBaseModel):
    """Attributes to enhance accessibility when using assistive technologies like screen readers or model understanding."""

    model_config = ConfigDict(populate_by_name=True)
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
    live: Literal["off", "polite", "assertive"] | None = Field(
        default=None,
        description=(
            "Controls screen reader announcements for dynamic updates (WAI-ARIA"
            " aria-live). 'polite' waits for user pause; 'assertive' interrupts"
            " immediately for alerts."
        ),
        json_schema_extra={"default": "off"},
    )
    hidden: DynamicBoolean | None = Field(
        default=None,
        description=(
            "Hides the element and its children from assistive technologies when true."
            " Default is false."
        ),
    )

    @model_validator(mode="before")
    @classmethod
    def _reject_null_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            nulls = [
                key
                for key in ("label", "description", "live", "hidden")
                if key in data and data[key] is None
            ]
            if nulls:
                raise ValueError(f"{cls.__name__} fields must not be null: {nulls}")
        return data


def _validate_extensions_keys(value: dict[str, Any]) -> dict[str, Any]:
    invalid = sorted(key for key in value if not is_identifier_key(key))
    if invalid:
        raise ValueError(f"Extensions keys must be Unicode identifiers: {invalid}")
    return value


Extensions = TypeAliasType(
    "Extensions",
    Annotated[
        OpenObject,
        AfterValidator(_validate_extensions_keys),
        JsonSchemaKeywords({
            "patternProperties": {"^[\\p{XID_Start}_][\\p{XID_Continue}]*$": {}},
            "additionalProperties": False,
        }),
    ],
)


class ComponentCommonMetadata(StrictBaseModel):
    """Optional component-level metadata for vendor extensions."""

    model_config = ConfigDict(
        json_schema_extra={INLINE_DEF_MARKER: True}, populate_by_name=True
    )
    extensions: Extensions | None = Field(default=None)

    @model_validator(mode="before")
    @classmethod
    def _reject_null_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            nulls = [
                key for key in ("extensions",) if key in data and data[key] is None
            ]
            if nulls:
                raise ValueError(f"{cls.__name__} fields must not be null: {nulls}")
        return data


class ComponentCommon(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: ComponentId = Field(...)
    catalog_id: str | None = Field(
        default=None,
        alias="catalogId",
        description=(
            "The catalog ID for this component, overriding any surface-level default"
            " catalogId."
        ),
    )
    accessibility: AccessibilityAttributes | None = Field(default=None)
    metadata: ComponentCommonMetadata | None = Field(
        default=None,
        description="Optional component-level metadata for vendor extensions.",
    )

    @classmethod
    def __get_pydantic_json_schema__(
        cls, core_schema: CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        json_schema = handler(core_schema)
        if cls is not ComponentCommon:
            return json_schema
        target = handler.resolve_ref_schema(json_schema)
        target.pop("additionalProperties", None)
        return json_schema

    @model_validator(mode="before")
    @classmethod
    def _reject_null_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            nulls = [
                key
                for key in ("catalogId", "catalog_id", "accessibility", "metadata")
                if key in data and data[key] is None
            ]
            if nulls:
                raise ValueError(f"{cls.__name__} fields must not be null: {nulls}")
        return data


def _validate_literal_object(v: Any) -> dict[str, Any]:
    if not isinstance(v, dict):
        raise ValueError("Expected a dictionary object")
    forbidden = {"@call", "@path"}
    found = forbidden.intersection(v.keys())
    if found:
        raise ValueError(
            "Object in DynamicValue cannot contain forbidden properties:"
            f" {', '.join(sorted(found))}"
        )
    for k in v.keys():
        if k.startswith("@") and not k.startswith("@@"):
            raise ValueError(
                "Object in DynamicValue cannot contain unrecognized reserved"
                f" directive: '{k}'"
            )
    return v


LiteralObject = Annotated[
    dict[str, Any],
    AfterValidator(_validate_literal_object),
    JsonSchemaKeywords(
        {
            "not": {
                "anyOf": [{"required": ["path"]}, {"required": ["call"]}],
                KEEP_ANY_OF_MARKER: True,
            }
        },
        drop=("additionalProperties",),
    ),
]


DynamicValue = (
    StrictStr
    | StrictFloat
    | StrictInt
    | StrictBool
    | list[Any]
    | LiteralObject
    | DataBinding
    | FunctionCall
)


DynamicNumber = StrictFloat | StrictInt | DataBinding | FunctionCall


DynamicStringList = list[StrictStr] | DataBinding | FunctionCall


class IndexSystemFunctionArgs(StrictBaseModel):
    model_config = ConfigDict(
        json_schema_extra={INLINE_DEF_MARKER: True}, populate_by_name=True
    )
    offset: DynamicNumber | None = Field(
        default=None,
        description=(
            "Optional. An offset to add to the 0-based index (e.g., 1 for 1-based"
            " indexing). Defaults to 0."
        ),
        json_schema_extra={"default": 0},
    )

    @classmethod
    def __get_pydantic_json_schema__(
        cls, core_schema: CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        json_schema = handler(core_schema)
        if cls is not IndexSystemFunctionArgs:
            return json_schema
        target = handler.resolve_ref_schema(json_schema)
        target.pop("additionalProperties", None)
        target.update({"unevaluatedProperties": False})
        return json_schema

    @model_validator(mode="before")
    @classmethod
    def _reject_null_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            nulls = [key for key in ("offset",) if key in data and data[key] is None]
            if nulls:
                raise ValueError(f"{cls.__name__} fields must not be null: {nulls}")
        return data


class IndexSystemFunction(StrictBaseModel):
    """Returns the 0-based index of the current item when rendering a dynamic list from a template. This function MUST ONLY be available when evaluating template items within a list context."""

    model_config = ConfigDict(populate_by_name=True)
    call: Literal["@index"] = Field(...)
    args: IndexSystemFunctionArgs | None = Field(default=None)

    @classmethod
    def __get_pydantic_json_schema__(
        cls, core_schema: CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        json_schema = handler(core_schema)
        if cls is not IndexSystemFunction:
            return json_schema
        target = handler.resolve_ref_schema(json_schema)
        target.pop("additionalProperties", None)
        target.update({"unevaluatedProperties": False, "returnType": "number"})
        return json_schema

    @model_validator(mode="before")
    @classmethod
    def _reject_null_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            nulls = [key for key in ("args",) if key in data and data[key] is None]
            if nulls:
                raise ValueError(f"{cls.__name__} fields must not be null: {nulls}")
        return data


class CheckRule(StrictBaseModel):
    """A single validation check rule applied to an input component. The condition function or path evaluates to a structured validation result object."""

    model_config = ConfigDict(populate_by_name=True)
    condition: DataBinding | FunctionCall = Field(
        ...,
        description=(
            "Path or function call evaluating to a structured validation result object."
        ),
    )
    message: str | None = Field(
        default=None, description="Optional fallback error message."
    )

    @model_validator(mode="before")
    @classmethod
    def _reject_null_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            nulls = [key for key in ("message",) if key in data and data[key] is None]
            if nulls:
                raise ValueError(f"{cls.__name__} fields must not be null: {nulls}")
        return data


class Checkable(StrictBaseModel):
    """Properties for components that support renderer-side checks."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)
    checks: list[CheckRule] | None = Field(
        default=None,
        description=(
            "A list of checks to perform. These are function calls that must return a"
            " boolean indicating validity."
        ),
    )

    @classmethod
    def __get_pydantic_json_schema__(
        cls, core_schema: CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        json_schema = handler(core_schema)
        if cls is not Checkable:
            return json_schema
        target = handler.resolve_ref_schema(json_schema)
        target.pop("additionalProperties", None)
        return json_schema

    @model_validator(mode="before")
    @classmethod
    def _reject_null_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            nulls = [key for key in ("checks",) if key in data and data[key] is None]
            if nulls:
                raise ValueError(f"{cls.__name__} fields must not be null: {nulls}")
        return data


class ActionEvent(StrictBaseModel):
    """The event to dispatch to the agent."""

    model_config = ConfigDict(populate_by_name=True)
    name: str = Field(
        ..., description="The name of the action to be dispatched to the agent."
    )
    user_message: DynamicString | None = Field(
        default=None,
        alias="userMessage",
        description=(
            "An optional human-readable message describing the action performed by the"
            " user, to present in conversation history or user feedback."
        ),
    )
    context: dict[str, DynamicValue] | None = Field(
        default=None,
        description=(
            "A JSON object containing the key-value pairs for the action context."
            " Values can be literals or paths. Use literal values unless the value must"
            " be dynamically bound to the data model. Do NOT use paths for static IDs."
        ),
    )

    @model_validator(mode="before")
    @classmethod
    def _reject_null_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            nulls = [
                key
                for key in ("userMessage", "user_message", "context")
                if key in data and data[key] is None
            ]
            if nulls:
                raise ValueError(f"{cls.__name__} fields must not be null: {nulls}")
        return data


class ActionEventWrapper(StrictBaseModel):
    """Triggers an agent-side event."""

    model_config = ConfigDict(populate_by_name=True)
    event: ActionEvent = Field(..., description="The event to dispatch to the agent.")


class ActionFunctionCallWrapper(StrictBaseModel):
    """Executes a renderer or agent-side function."""

    model_config = ConfigDict(populate_by_name=True)
    function_call: FunctionCall = Field(..., alias="functionCall")


Action = ActionEventWrapper | ActionFunctionCallWrapper


class Surface(StrictBaseModel):
    """The reserved canonical container component representing an A2UI surface. The Surface component is immutable and always has 'child': 'root'."""

    model_config = ConfigDict(populate_by_name=True)
    component: Literal["Surface"] | None = Field(default="Surface")
    child: Literal["root"] | None = Field(default="root")

    @classmethod
    def __get_pydantic_json_schema__(
        cls, core_schema: CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        json_schema = handler(core_schema)
        if cls is not Surface:
            return json_schema
        target = handler.resolve_ref_schema(json_schema)
        target.update(
            {SPEC_TITLE_KEY: "Surface Container Component", "allowedParents": []}
        )
        return json_schema

    @model_validator(mode="before")
    @classmethod
    def _reject_null_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            nulls = [
                key
                for key in ("component", "child")
                if key in data and data[key] is None
            ]
            if nulls:
                raise ValueError(f"{cls.__name__} fields must not be null: {nulls}")
        return data


class FunctionResponseError(StrictBaseModel):
    """An error object indicating failure of the function execution."""

    model_config = ConfigDict(
        json_schema_extra={INLINE_DEF_MARKER: True}, populate_by_name=True
    )
    code: str = Field(...)
    message: str = Field(...)


class FunctionResponse(StrictBaseModel):
    """The return response matching a callAgentFunction or callRendererFunction invocation."""

    model_config = ConfigDict(populate_by_name=True)
    function_call_id: CallId = Field(
        ...,
        alias="functionCallId",
        description="The unique ID matching the initiating function call.",
    )
    value: Any | None = Field(
        default=None, description="The return value of the function."
    )
    error: FunctionResponseError | None = Field(
        default=None,
        description="An error object indicating failure of the function execution.",
    )

    @classmethod
    def __get_pydantic_json_schema__(
        cls, core_schema: CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        json_schema = handler(core_schema)
        if cls is not FunctionResponse:
            return json_schema
        target = handler.resolve_ref_schema(json_schema)
        target.update({"oneOf": [{"required": ["value"]}, {"required": ["error"]}]})
        return json_schema

    @model_validator(mode="after")
    def _check_one_of_required(self) -> FunctionResponse:
        branches = (("value",), ("error",))
        matched = sum(
            all(field in self.model_fields_set for field in fields)
            for fields in branches
        )
        if matched != 1:
            raise ValueError("FunctionResponse must set exactly one of: value | error")
        return self

    @model_validator(mode="before")
    @classmethod
    def _reject_null_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            nulls = [key for key in ("error",) if key in data and data[key] is None]
            if nulls:
                raise ValueError(f"{cls.__name__} fields must not be null: {nulls}")
        return data


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
    "CallId": Annotated[
        CallId, Field(description="The unique identifier for a function call.")
    ],
    "AccessibilityAttributes": AccessibilityAttributes,
    "Extensions": Annotated[
        Extensions,
        Field(
            description=(
                "Optional extension metadata. Keys MUST be Unicode identifiers (UAX"
                " #31). Keys starting with 'a2ui_' are reserved for official"
                " extensions."
            )
        ),
    ],
    "ComponentCommon": ComponentCommon,
    "Child": Annotated[
        Child, Field(description="A reference to a single child component ID.")
    ],
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
    "FunctionCommon": FunctionCommon,
    "IndexSystemFunction": IndexSystemFunction,
    "FunctionCall": FunctionCall,
    "CheckRule": CheckRule,
    "Checkable": Checkable,
    "Action": Annotated[
        Action,
        Field(
            description=(
                "Defines an interaction handler that can either trigger an agent-side"
                " event or execute a local renderer-side function."
            )
        ),
    ],
    "Surface": Surface,
    "FunctionResponse": FunctionResponse,
}

__all__ = [
    "AccessibilityAttributes",
    "Action",
    "ActionEvent",
    "ActionEventWrapper",
    "ActionFunctionCallWrapper",
    "COMMON_TYPES_DEFS",
    "CallId",
    "CheckRule",
    "Checkable",
    "Child",
    "ChildList",
    "ComponentCommon",
    "ComponentCommonMetadata",
    "ComponentId",
    "ComponentReference",
    "DataBinding",
    "DynamicBoolean",
    "DynamicNumber",
    "DynamicString",
    "DynamicStringList",
    "DynamicValue",
    "Extensions",
    "FunctionCall",
    "FunctionCommon",
    "FunctionResponse",
    "FunctionResponseError",
    "IndexSystemFunction",
    "IndexSystemFunctionArgs",
    "ListReference",
    "LiteralObject",
    "SingleReference",
    "StrictBaseModel",
    "Surface",
    "TemplateChildList",
]
