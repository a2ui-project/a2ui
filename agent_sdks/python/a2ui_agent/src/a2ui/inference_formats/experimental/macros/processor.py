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

"""Runtime expansion processor for A2UI macros."""

from typing import Any, Optional, Sequence, Union

from a2ui.builder import (
    AccessibilityAttributes,
    Action,
    ComponentBuilderNode,
    ComponentRef,
    DataBinding,
    ExternalComponentBuilderNode,
    flatten_component_tree,
)
from a2ui.inference_formats.experimental.macros.macro import get_macro


class MacroProcessor:
    """Executes registered macros and flattens them into standard A2UI components."""

    def has_macro(self, macro_name: str) -> bool:
        """Checks if a macro is registered by name."""
        return get_macro(macro_name) is not None

    def expand(
        self,
        macro_name: str,
        args: dict[str, Any],
        instance_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """Executes a macro by name with provided arguments and returns flat component dicts.

        Args:
            macro_name: The registered macro function name.
            args: Keyword arguments for the macro invocation.
            instance_id: The ID assigned to this macro component instance (becomes root component ID).

        Returns:
            List of standard A2UI component dictionaries ready for surfaceUpdate.
        """
        root_id = instance_id
        meta = get_macro(macro_name)
        if meta is None:
            raise KeyError(f"Macro '{macro_name}' is not registered.")

        # Coerce parameters from incoming JSON values to rich builder AST types
        coerced_args: dict[str, Any] = {}
        for p_name, p_val in args.items():
            if p_name in meta.parameters:
                p_meta = meta.parameters[p_name]
                t = p_meta.type_hint

                # 1. Coerce single child slot from string ID to ComponentRef
                if isinstance(p_val, str) and (
                    t
                    in (
                        ComponentBuilderNode,
                        ExternalComponentBuilderNode,
                        ComponentRef,
                        Optional[ComponentBuilderNode],
                        Optional[ComponentRef],
                    )
                    or (isinstance(t, type) and issubclass(t, ComponentBuilderNode))
                ):
                    coerced_args[p_name] = ComponentRef(id=p_val)

                # 2. Coerce child slot list from sequence of IDs to ComponentRefs
                elif isinstance(p_val, (list, tuple)) and (
                    t
                    in (
                        Sequence[ComponentBuilderNode],
                        list[ComponentBuilderNode],
                        Optional[Sequence[ComponentBuilderNode]],
                    )
                ):
                    coerced_args[p_name] = [
                        ComponentRef(id=x) if isinstance(x, str) else x for x in p_val
                    ]

                # 3. Coerce DataBinding dictionary: {"path": "/..."}
                elif (
                    isinstance(p_val, dict)
                    and "path" in p_val
                    and len(p_val) == 1
                    and not isinstance(p_val, DataBinding)
                ):
                    coerced_args[p_name] = DataBinding(path=p_val["path"])

                # 4. Coerce Action string or dict
                elif isinstance(p_val, str) and t in (Action, Optional[Action]):
                    coerced_args[p_name] = Action(event=p_val)
                elif (
                    isinstance(p_val, dict)
                    and t in (Action, Optional[Action])
                    and not isinstance(p_val, Action)
                ):
                    if "event" in p_val:
                        coerced_args[p_name] = Action(event=p_val["event"])
                    elif "name" in p_val:
                        coerced_args[p_name] = Action(event=p_val)
                    else:
                        coerced_args[p_name] = Action(event=p_val)

                # 5. Coerce AccessibilityAttributes
                elif (
                    isinstance(p_val, dict)
                    and t
                    in (AccessibilityAttributes, Optional[AccessibilityAttributes])
                    and not isinstance(p_val, AccessibilityAttributes)
                ):
                    coerced_args[p_name] = AccessibilityAttributes(**p_val)

                else:
                    coerced_args[p_name] = p_val
            else:
                coerced_args[p_name] = p_val

        # Execute macro layout function
        result = meta.func(**coerced_args)

        if not isinstance(result, (ComponentBuilderNode, Sequence)):
            raise TypeError(
                f"Macro '{macro_name}' must return a ComponentBuilderNode or Sequence"
                f" of nodes, got {type(result)}."
            )

        # Flatten into primitive components with ID namespacing and root stitching
        return flatten_component_tree(result, root_id=root_id)
