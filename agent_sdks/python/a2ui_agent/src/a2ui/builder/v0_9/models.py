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
they are not. ``AccessibilityAttributes``, ``ActionEvent``, ``CheckRule``,
``DataBinding`` and ``FunctionCall`` are core's outright.

Two stay local, and in both cases because the authoring shape really is a
different shape rather than because core's model has a defect:

``Action``
    Core models this as ``ActionEventWrapper | ActionFunctionCallWrapper``. The
    union is the right read of the wire and enforces the ``oneOf`` structurally,
    but it cannot be constructed — ``Action(...)`` on a ``Union`` raises
    ``TypeError`` — so every call site would name a wrapper class instead of the
    type its own signature advertises.

``DynamicChildList``
    Core's ``TemplateChildList`` references its template by ``component_id``,
    which is what a parser sees. An author nests the template and lets the
    flatten pass allocate the ID, so the reference cannot dangle.

Both are pinned against their core counterparts by tests asserting that what
they serialize validates as core's model, so the shapes cannot drift apart
without failing the suite.

No model here defines a custom serializer, and none rewrites a value the author
supplied. Field shape, aliases, defaults and null handling are Pydantic's; the
only behaviour the builder adds is child resolution, which lives on the
:data:`~a2ui.builder.core.child.Child` type.

.. note::
   Data model paths are preserved exactly as written. A leading ``/`` is
   semantically load-bearing: absolute paths resolve from the root of the data
   model, while a path without one is *relative* and resolves against the
   enclosing collection scope created by a :class:`DynamicChildList` template.
   Normalizing to absolute would make item-scoped bindings — the entire point
   of templates — impossible to express. See "Path resolution & scope" in
   ``specification/v0_9_1/docs/a2ui_protocol.md``.
"""

from __future__ import annotations

from typing import Any, Optional, Sequence, TypeAlias, Union
from pydantic import (
    AliasChoices,
    Field,
    model_validator,
)

from ..core.base_model import BuilderBaseModel
from ..core.child import Child

from a2ui.core.schema.common_types import (
    AccessibilityAttributes as AccessibilityAttributes,
)
from a2ui.core.schema.common_types import ActionEvent as ActionEvent
from a2ui.core.schema.common_types import CheckRule as CheckRule
from a2ui.core.schema.common_types import DataBinding as DataBinding
from a2ui.core.schema.common_types import FunctionCall as FunctionCall


# Canonical Protocol Type Aliases
#
# Spelled as explicit unions rather than over a shared expression base class:
# the members are independent core models with no common ancestor to name. This
# is also how core spells them.
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


class DynamicChildList(BuilderBaseModel):
    """Generates children by repeating one template component over a data model list.

    On the wire this is ``{"componentId": <id>, "path": <str>}``: the template is
    an ordinary sibling component, referenced by ID exactly like any other child.
    Authors nest the template here, and the :data:`Child` serializer resolves it
    to the ID it was allocated, so the reference cannot dangle.

    ``path`` is kept exactly as written. It is usually absolute, but a template
    nested inside another template must address its list relative to the
    enclosing item scope — iterating ``employees`` within a loop over
    ``/departments`` — so rewriting it to absolute would make two-level
    collections impossible to express.
    """

    path: str = Field(
        validation_alias=AliasChoices("path", "data_model_path", "dataModelPath"),
    )
    template: Child = Field(
        serialization_alias="componentId",
        validation_alias=AliasChoices("template", "componentId"),
    )


ChildList: TypeAlias = Union[Sequence[Child], DynamicChildList]
