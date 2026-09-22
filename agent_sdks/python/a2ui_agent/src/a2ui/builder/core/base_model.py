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

"""The strict Pydantic configuration shared by every builder model."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class BuilderBaseModel(BaseModel):
    """Base class carrying the builder's authoring configuration.

    Every model in the builder wants the same three settings, so they live in
    one place rather than being restated per class. Pydantic merges
    ``model_config`` along the MRO, so a subclass adds to this rather than
    replacing it.

    This is not a component. Component nodes are
    :class:`~a2ui.builder.core.base_node.ComponentBuilderNode`, which adds the
    ``component`` and ``id`` fields on top of this configuration. Item models
    nested inside a component's properties, such as a tab or a picker option,
    inherit this directly: the schema does not give them an identity of their
    own, so they must not carry those two fields.
    """

    model_config = ConfigDict(
        # Strict authoring validation: catches typos (e.g. lable="Save") at
        # runtime and edit-time. Loose parsing will be handled by dedicated
        # deserialization constructors in Phase 2 (#2571).
        extra="forbid",
        # Arbitrary types forbidden to enforce strict typing on builder inputs
        arbitrary_types_allowed=False,
        # Modern Pydantic 2.11+ replacement for populate_by_name
        validate_by_name=True,
    )
