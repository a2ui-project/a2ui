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

"""Protocol v0.9 data models, bindings, actions, and type aliases for A2UI builders.

A model here is reused from ``a2ui.core.schema.common_types`` when the authoring
form and the parsed form are genuinely the same thing, and defined locally when
they are not. ``ActionEvent`` is core's outright; ``DataBinding`` subclasses
core's to add path normalization and immutability without changing its fields.

The rest stay local because authoring is a different job from parsing. It wants
nested children rather than IDs, narrow enums, and no defaulted field reaching
the wire that the author never wrote. ``FunctionCall`` is the clearest case:
core defaults ``return_type`` to ``"boolean"``, so reusing it would stamp a
``returnType`` onto every call site.

No model here defines a custom serializer. Field shape, aliases, defaults and null
handling are Pydantic's; the only behaviour the builder adds is child resolution,
which lives on the :data:`~a2ui.builder.core.child.Child` type.
"""

from __future__ import annotations

from typing import Any, Optional, Sequence, TypeAlias, Union
from pydantic import (
    AliasChoices,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from ..core.base_model import BuilderBaseModel
from ..core.child import Child

from a2ui.core.schema.common_types import ActionEvent as ActionEvent
from a2ui.core.schema.common_types import DataBinding as CoreDataBinding


def _absolute_pointer(path: str) -> str:
    """Normalizes a data model path to the absolute form the wire requires.

    Every path in A2UI is rooted at the data model. Authors habitually write the
    relative-looking ``"user/name"``, which a client would fail to resolve, so
    the leading slash is supplied here rather than left to each caller.
    """
    return path if path.startswith("/") else f"/{path}"


class DataBinding(CoreDataBinding):
    """A two-way binding to a path in the client data model.

    The field set comes from :mod:`a2ui.core.schema.common_types`, so a binding
    built here is one the core models accept. Authoring adds two things core has
    no reason to: paths are normalized to absolute form, and the model is frozen
    so a binding can be shared between components and used as a dict key.
    """

    model_config = ConfigDict(frozen=True)

    @field_validator("path")
    @classmethod
    def _normalize_path(cls, v: str) -> str:
        return _absolute_pointer(v)


class AccessibilityAttributes(BuilderBaseModel):
    """Attributes to enhance accessibility when using assistive technologies.

    Only ``label`` and ``description`` exist in v0.9.1. The ``live`` and
    ``hidden`` attributes are v1.0 additions and belong on the v1.0 model:
    v0.9.1 omits ``additionalProperties: false`` here, so declaring them would
    validate cleanly while no v0.9 renderer read them.
    """

    label: Optional[Union[str, DataBinding]] = None
    description: Optional[Union[str, DataBinding]] = None


class FunctionCall(BuilderBaseModel):
    """Invocation of a client-side catalog function.

    Unlike :class:`DataBinding` and :class:`ActionEvent`, this is not core's
    model. Core defaults ``return_type`` to ``"boolean"``, which is not ``None``
    and so survives ``exclude_none``: every call would carry a ``returnType`` the
    author never wrote. Reuse becomes possible if that default becomes ``None``.

    Note there is no call identifier here. Correlating a call with its response
    is a v1.0 agent-function concern, carried as ``functionCallId`` on the
    call and response messages, not a property of a catalog function invoked
    from inside a component.
    """

    call: str
    args: dict[str, Any] = Field(default_factory=dict)


# Canonical Protocol Type Aliases
#
# Spelled as explicit unions rather than over a shared expression base class:
# ``DataBinding`` is core's model and ``FunctionCall`` is the builder's, so they
# have no common ancestor to name. This is also how core spells them.
DynamicString = Union[str, DataBinding, FunctionCall]
DynamicNumber = Union[int, float, DataBinding, FunctionCall]
DynamicBoolean = Union[bool, DataBinding, FunctionCall]
DynamicStringList = Union[Sequence[str], DataBinding, FunctionCall]
DynamicValue = Union[Any, DataBinding, FunctionCall]


class Action(BuilderBaseModel):
    """An interaction handler dispatching a server event or a client function.

    The spec models this as a ``oneOf``: an action carries an ``event`` or a
    ``functionCall``, never both and never neither. That constraint is enforced
    here rather than left to the wire, because an action with neither branch
    silently does nothing at runtime.

    There is no string shorthand for ``event``. A before-validator accepting
    ``Action(event="save")`` would be invisible to a type checker, which then
    reports the ergonomic spelling as an error. Construct the branch instead:
    ``Action(event=ActionEvent(name="save"))``.
    """

    event: Optional[ActionEvent] = None
    function_call: Optional[FunctionCall] = Field(
        default=None,
        serialization_alias="functionCall",
        validation_alias=AliasChoices("function_call", "functionCall"),
    )

    @model_validator(mode="after")
    def _require_exactly_one_branch(self) -> Action:
        if (self.event is None) == (self.function_call is None):
            raise ValueError(
                "Action requires exactly one of 'event' or 'function_call'."
            )
        return self


class CheckRule(BuilderBaseModel):
    """A client-side validation check (condition + error message).

    ``condition`` is any ``DynamicBoolean``, which is what the spec and the core
    models allow. A catalog validation function is the usual way to write one,
    but binding straight to a boolean in the data model is legitimate, so the
    type does not rule it out.
    """

    condition: DynamicBoolean
    message: str


class DynamicChildList(BuilderBaseModel):
    """Generates children by repeating one template component over a data model list.

    On the wire this is ``{"componentId": <id>, "path": <str>}``: the template is
    an ordinary sibling component, referenced by ID exactly like any other child.
    Authors nest the template here, and the :data:`Child` serializer resolves it
    to the ID it was allocated, so the reference cannot dangle.
    """

    path: str = Field(
        validation_alias=AliasChoices("path", "data_model_path", "dataModelPath"),
    )
    template: Child = Field(
        serialization_alias="componentId",
        validation_alias=AliasChoices("template", "componentId"),
    )

    @field_validator("path")
    @classmethod
    def _normalize_path(cls, v: str) -> str:
        return _absolute_pointer(v)


ChildList: TypeAlias = Union[Sequence[Child], DynamicChildList]
