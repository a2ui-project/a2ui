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

"""Macro expander transforming catalog schemas and lowering message envelopes."""

from __future__ import annotations

import copy
from dataclasses import replace
import logging
from typing import Any, Callable, Optional, Sequence, Union

from a2ui.core import A2uiCatalogError, A2uiRecursionError
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import CATALOG_COMPONENTS_KEY
from a2ui.transformers.macros.macro import _MacroMetadata
from a2ui.transformers.macros.processor import _MacroProcessor
from google.adk.utils.feature_decorator import experimental

logger = logging.getLogger(__name__)


@experimental
class MacroExpander:
    """Expands composite macro components into standard A2UI primitive component subtrees.

    Acts as a catalog and message transformer:
    1. transform_to_inference_catalog: Augments a base catalog with synthesized
       macro component schemas so LLMs can author high-level components.
    2. transform_to_transport: Rewrites outbound messages by expanding macro
       components into flat primitive ASTs understood by downstream renderers.
    3. transform_to_inference: Passes transport messages through untouched (safe identity pass-through).
    """

    def __init__(
        self,
        macros: Optional[Sequence[Union[Callable[..., Any], _MacroMetadata]]] = None,
        *,
        passthrough_components: Optional[Sequence[str]] = None,
    ):
        """Initializes the macro expander.

        Args:
            macros: Explicit sequence of macro functions decorated with @macro.
            passthrough_components: Optional sequence of component names from the source
                catalog to pass through to the inference catalog. If None (default), all
                source catalog components pass through. If specified, only these
                components are retained from the source catalog alongside the macros.
                Passing an empty sequence ([]) retains zero source catalog components,
                exposing exclusively the macros.
        """
        self.macros: list[_MacroMetadata] = []
        if macros:
            for m in macros:
                if isinstance(m, _MacroMetadata):
                    self.macros.append(m)
                elif hasattr(m, "__a2ui_macro__"):
                    self.macros.append(getattr(m, "__a2ui_macro__"))
                elif callable(m):
                    raise ValueError(
                        f"Callable '{m.__name__}' is not decorated with @macro."
                    )

        macro_map = {m.name: m for m in self.macros}
        self.processor = _MacroProcessor(macro_map)
        self.passthrough_components: Optional[set[str]] = (
            set(passthrough_components) if passthrough_components is not None else None
        )

    def transform_to_inference_catalog(self, base_catalog: A2uiCatalog) -> A2uiCatalog:
        """Derives an authoring/inference catalog by augmenting the base catalog with macro schemas.

        Args:
            base_catalog: The base client catalog.

        Returns:
            A new A2uiCatalog containing macro component schemas.

        Raises:
            A2uiCatalogError: If a macro component collides with an existing component in the base catalog.
        """
        schema_copy = copy.deepcopy(base_catalog.catalog_schema)
        comps_map = dict(schema_copy.get(CATALOG_COMPONENTS_KEY, {}))
        defs_map = schema_copy.setdefault("$defs", {})
        any_comp = defs_map.setdefault("anyComponent", {})
        any_comp_refs = any_comp.setdefault("oneOf", [])

        # Filter base catalog components if passthrough_components is specified
        if self.passthrough_components is not None:
            pruned_base_names = set(comps_map.keys()) - self.passthrough_components
            for name in pruned_base_names:
                del comps_map[name]
            any_comp_refs[:] = [
                ref
                for ref in any_comp_refs
                if not any(
                    ref.get("$ref", "").endswith(f"/{name}")
                    for name in pruned_base_names
                )
            ]

        macro_components = {m.name: m.to_json_schema() for m in self.macros}

        for name, comp_schema in macro_components.items():
            if name in comps_map:
                raise A2uiCatalogError(
                    f"Macro component '{name}' collides with an existing component in"
                    " the base catalog."
                )
            comps_map[name] = comp_schema
            ref_entry = {"$ref": f"#/{CATALOG_COMPONENTS_KEY}/{name}"}
            if ref_entry not in any_comp_refs:
                any_comp_refs.append(ref_entry)

        schema_copy[CATALOG_COMPONENTS_KEY] = comps_map
        return replace(base_catalog, catalog_schema=schema_copy)

    def transform_to_transport(self, message: dict[str, Any]) -> list[dict[str, Any]]:
        """Lowers an outbound inference message by expanding macro components into primitive subtrees.

        Args:
            message: Raw A2UI envelope dictionary.

        Returns:
            List containing the message with expanded primitive components.
        """
        if not self.macros:
            return [message]

        if not isinstance(message, dict):
            return [message]

        expanded_msg = dict(message)

        for envelope_key in ("surfaceUpdate", "createSurface", "updateComponents"):
            if envelope_key in expanded_msg and isinstance(
                expanded_msg[envelope_key], dict
            ):
                body = dict(expanded_msg[envelope_key])
                comps = body.get("components")
                if comps and isinstance(comps, list):
                    body["components"] = self._expand_component_list(comps)
                    expanded_msg[envelope_key] = body

        return [expanded_msg]

    def transform_to_inference(self, message: dict[str, Any]) -> list[dict[str, Any]]:
        """Lifts transport messages to inference level (safe identity pass-through)."""
        return [message]

    def _expand_component_list(
        self,
        components: list[dict[str, Any]],
        *,
        depth: int = 0,
        max_depth: int = 16,
    ) -> list[dict[str, Any]]:
        """Recursively expands macro components in a flat component list."""
        if depth > max_depth:
            raise A2uiRecursionError(
                f"Macro expansion exceeded maximum recursion depth of {max_depth}."
            )

        expanded: list[dict[str, Any]] = []
        for comp in components:
            if not isinstance(comp, dict):
                expanded.append(comp)
                continue

            c_name = comp.get("component")
            c_id = comp.get("id")

            if c_name and self.processor.has_macro(c_name):
                params = {k: v for k, v in comp.items() if k not in ("component", "id")}
                try:
                    expanded_macro = self.processor.expand(
                        c_name, params, instance_id=c_id
                    )
                    # Spliced components may themselves contain macros
                    expanded.extend(
                        self._expand_component_list(
                            expanded_macro, depth=depth + 1, max_depth=max_depth
                        )
                    )
                except (A2uiRecursionError, RecursionError):
                    raise A2uiRecursionError(
                        "Macro expansion exceeded maximum recursion depth of"
                        f" {max_depth}."
                    )
                except Exception as e:
                    logger.error(
                        "Failed to expand macro %r: %s", c_name, e, exc_info=True
                    )
                    expanded.append(comp)
            else:
                expanded.append(comp)

        return expanded


__all__ = ["MacroExpander"]
