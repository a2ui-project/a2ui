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

from typing import Any, Callable
from ..catalog.catalog import TComponent, TFunction
from ..state import ComponentModel, SurfaceComponentsModel, SurfaceModel
from .data_context import DataContext


class ComponentContext:
    """Headless pairing of a component's active model with its scoped DataContext."""

    def __init__(
        self,
        component_model: ComponentModel,
        data_context: DataContext,
        surface_components: SurfaceComponentsModel | None = None,
        dispatch_action_callback: Callable[[dict[str, Any], str], None] | None = None,
    ):
        self.component_model = component_model
        self.data_context = data_context
        self.surface_components = surface_components or SurfaceComponentsModel()
        self.theme: dict[str, Any] = {}
        self._dispatch_action = dispatch_action_callback

    @classmethod
    def from_surface(
        cls,
        surface: SurfaceModel[TComponent, TFunction],
        component_id: str,
        data_model_base_path: str = "/",
    ) -> "ComponentContext":
        """Creates a new component context initialized directly from a surface."""
        model = surface.components_model.get(component_id)
        if not model:
            raise ValueError(f"Component not found: {component_id}")

        data_ctx = DataContext(
            surface=surface,
            path=data_model_base_path,
        )
        inst = cls(
            component_model=model,
            data_context=data_ctx,
            surface_components=surface.components_model,
            dispatch_action_callback=lambda act, cid: surface.dispatch_action(act, cid),
        )
        inst.theme = getattr(surface, "theme", {})
        return inst

    def dispatch_action(self, action_payload: dict[str, Any]) -> None:
        """Dispatches a user-initiated action back to the global controller handler."""
        if self._dispatch_action:
            self._dispatch_action(action_payload, self.component_model.id)
