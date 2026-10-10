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

"""Transformers that prune a catalog's components or functions to an allowlist."""

from __future__ import annotations

from collections import deque
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from a2ui.core import CatalogApi

from .base import CatalogTransformer

__all__ = [
    "ComponentPruningTransformer",
    "FunctionPruningTransformer",
]

_DEFS_REF_PREFIX = "#/$defs/"


def _allowlist(names: Sequence[str] | None, argument: str) -> frozenset[str]:
    if names is None:
        return frozenset()
    if isinstance(names, str):
        raise TypeError(f"{argument} must be a sequence of names, not a string.")
    return frozenset(names)


def _def_refs(node: Any) -> set[str]:
    """Returns the `#/$defs/<name>` targets referenced in `node`."""
    refs: set[str] = set()
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith(_DEFS_REF_PREFIX):
            refs.add(ref.removeprefix(_DEFS_REF_PREFIX).split("/")[0])
        for value in node.values():
            refs.update(_def_refs(value))
    elif isinstance(node, list):
        for item in node:
            refs.update(_def_refs(item))
    return refs


def _prune_defs(
    defs: Mapping[str, Any] | None,
    roots: Iterable[Any],
) -> dict[str, Any] | None:
    """Returns the entries of `defs` reachable from `roots`."""
    if not defs:
        return None
    reachable: set[str] = set()
    queue = deque(name for root in roots for name in _def_refs(root))
    while queue:
        name = queue.popleft()
        if name in defs and name not in reachable:
            reachable.add(name)
            queue.extend(_def_refs(defs[name]))
    return {name: value for name, value in defs.items() if name in reachable}


def _pruned(
    catalog: CatalogApi,
    *,
    components: frozenset[str] | None = None,
    functions: frozenset[str] | None = None,
) -> CatalogApi:
    """Returns a copy of `catalog` that keeps only the named entries.

    `None` keeps every entry of that kind. The copy's schema is generated from
    the entries it keeps, so its `anyComponent`, `anyFunction`, and helper
    `$defs` refer only to those. The kept entries are unchanged, so the copy
    keeps the catalog's document metadata and their authored JSON, which
    `to_json` emits.
    """
    kept_components = [
        component
        for name, component in catalog.components.items()
        if components is None or name in components
    ]
    kept_functions = [
        function
        for name, function in catalog.functions.items()
        if functions is None or name in functions
    ]
    roots = [
        *(component.schema for component in kept_components),
        *(
            function.schema.model_json_schema()
            if isinstance(function.schema, type)
            and hasattr(function.schema, "model_json_schema")
            else function.schema
            for function in kept_functions
        ),
        catalog.theme_schema,
    ]
    return catalog.copy_with(
        components=kept_components,
        functions=kept_functions,
        defs=_prune_defs(catalog.defs, roots) or {},
    )


class ComponentPruningTransformer(CatalogTransformer):
    """Keeps only the allowlisted components of a catalog.

    The allowlist is read literally. An empty allowlist keeps no components,
    and a name the catalog doesn't declare is ignored. To keep every component,
    don't apply the transformer. Functions and the other definitions are kept.
    """

    def __init__(self, allowed_components: Sequence[str] | None = None) -> None:
        """Initializes the transformer.

        Args:
            allowed_components: The names of the components to keep, or None
              to keep no components.

        Raises:
            TypeError: If `allowed_components` is a single string.
        """
        self.allowed_components = _allowlist(allowed_components, "allowed_components")

    def transform(self, catalog: CatalogApi) -> CatalogApi:
        """Returns a copy of `catalog` with only the allowlisted components."""
        return _pruned(catalog, components=self.allowed_components)


class FunctionPruningTransformer(CatalogTransformer):
    """Keeps only the allowlisted functions of a catalog.

    The allowlist is read literally. An empty allowlist keeps no functions, and
    a name the catalog doesn't declare is ignored. To keep every function, don't
    apply the transformer. Components and the other definitions are kept.
    """

    def __init__(self, allowed_functions: Sequence[str] | None = None) -> None:
        """Initializes the transformer.

        Args:
            allowed_functions: The names of the functions to keep, or None
              to keep no functions.

        Raises:
            TypeError: If `allowed_functions` is a single string.
        """
        self.allowed_functions = _allowlist(allowed_functions, "allowed_functions")

    def transform(self, catalog: CatalogApi) -> CatalogApi:
        """Returns a copy of `catalog` with only the allowlisted functions."""
        return _pruned(catalog, functions=self.allowed_functions)
