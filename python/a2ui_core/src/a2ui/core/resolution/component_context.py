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

import inspect
from typing import Any, Callable
from ..state.component_model import ComponentModel
from ..state.surface_components_model import SurfaceComponentsModel
from ..state.surface_model import SurfaceModel
from .data_context import DataContext


class ComponentContext:
    """Headless pairing of a component's active model with its scoped DataContext."""

    def __init__(
        self,
        component_model: ComponentModel,
        data_context: DataContext,
        surface_components: SurfaceComponentsModel | None = None,
        dispatch_action_callback: Callable[..., Any] | None = None,
    ):
        self.component_model = component_model
        self.data_context = data_context
        self.surface_components = surface_components or SurfaceComponentsModel()
        self.theme: dict[str, Any] = {}
        self._dispatch_action = dispatch_action_callback

    @property
    def metadata(self) -> dict[str, Any] | None:
        """Returns the component's metadata object (defensive copy), or None."""
        return self.component_model.metadata

    @property
    def extensions(self) -> dict[str, Any] | None:
        """Returns the component's metadata extensions dictionary (defensive copy), or None."""
        return self.component_model.extensions

    @classmethod
    def from_surface(
        cls,
        surface: SurfaceModel,
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
            dispatch_action_callback=lambda act, cid, meta=None: (
                surface.dispatch_action(act, cid, metadata=meta)
            ),
        )
        inst.theme = getattr(surface, "theme", {})
        return inst

    def dispatch_action(
        self,
        action_payload: dict[str, Any],
        metadata: dict[str, Any] | None = None,
    ) -> Any:
        """Dispatches a user-initiated action back to the global controller handler."""
        if self._dispatch_action:
            if metadata is None:
                return self._dispatch_action(action_payload, self.component_model.id)
            params = inspect.signature(self._dispatch_action).parameters.values()
            accepts_metadata = any(
                p.kind == inspect.Parameter.VAR_POSITIONAL for p in params
            ) or (
                sum(
                    1
                    for p in params
                    if p.kind
                    in (
                        inspect.Parameter.POSITIONAL_ONLY,
                        inspect.Parameter.POSITIONAL_OR_KEYWORD,
                    )
                )
                >= 3
            )
            if accepts_metadata:
                return self._dispatch_action(
                    action_payload, self.component_model.id, metadata
                )
            return self._dispatch_action(action_payload, self.component_model.id)
        elif (
            self.data_context
            and hasattr(self.data_context, "surface")
            and self.data_context.surface
        ):
            return self.data_context.surface.dispatch_action(
                action_payload, self.component_model.id, metadata=metadata
            )
        return None
