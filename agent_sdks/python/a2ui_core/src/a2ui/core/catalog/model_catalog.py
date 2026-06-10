# Copyright 2026 Google LLC
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

from typing import Any, Callable, Dict, List, Optional, Set, Tuple, Type
from pydantic import BaseModel
from .catalog import Catalog
from ..schema.constants import (
    DEFAULT_SINGLE_REF_FIELDS,
    DEFAULT_LIST_REF_FIELDS,
)
from .functions import FunctionImplementation


class ModelCatalog(Catalog):
    """A Pydantic-compiled concrete Catalog implementation."""

    def __init__(
        self,
        spec_version: str,
        catalog_id: str,
        components: Dict[str, Type[BaseModel]],
        functions: Optional[Dict[str, Any]] = None,
        theme: Optional[Type[BaseModel]] = None,
        custom_single_refs: Optional[List[str]] = None,
        custom_list_refs: Optional[List[str]] = None,
    ):
        super().__init__(
            spec_version=spec_version,
            catalog_id=catalog_id,
            custom_single_refs=custom_single_refs,
            custom_list_refs=custom_list_refs,
        )
        self.components = components
        self.theme = theme

        from .functions import FunctionImplementation, FunctionApi

        self.functions: Dict[str, FunctionImplementation] = {}
        if functions:
            source_dict = (
                functions
                if isinstance(functions, dict)
                else {
                    (fn.name if hasattr(fn, "name") else fn.__name__): fn
                    for fn in functions
                }
            )

            for name, fn in source_dict.items():
                if isinstance(fn, type) and issubclass(fn, BaseModel):
                    # Coerce Pydantic Model into FunctionImplementation
                    class CoercedFunctionImplementation(FunctionImplementation):

                        def __init__(self, name_str, schema_class):
                            super().__init__(
                                name=name_str, return_type="any", schema=schema_class
                            )

                        def execute(self, args, context=None, abort_signal=None):
                            return None

                    self.functions[name] = CoercedFunctionImplementation(name, fn)
                    normalized = name[0].lower() + name[1:]
                    self.functions[normalized] = self.functions[name]
                elif hasattr(fn, "execute"):
                    self.functions[name] = fn
                    normalized = name[0].lower() + name[1:]
                    self.functions[normalized] = fn
                elif isinstance(fn, type) and issubclass(fn, FunctionApi):
                    api_inst = fn()
                    normalized_name = api_inst.name or name
                    self.functions[normalized_name] = api_inst
                    self.functions[normalized_name[0].upper() + normalized_name[1:]] = (
                        api_inst
                    )
                elif isinstance(fn, FunctionApi):
                    normalized_name = fn.name or name
                    self.functions[normalized_name] = fn
                    self.functions[normalized_name[0].upper() + normalized_name[1:]] = (
                        fn
                    )
                elif hasattr(fn, "schema"):
                    self.functions[name] = fn
                    normalized = name[0].lower() + name[1:]
                    self.functions[normalized] = fn

        def dynamic_invoker(
            name: str,
            args: Dict[str, Any],
            context: Any = None,
            abort_signal: Optional[Any] = None,
        ) -> Any:
            fn = self.functions.get(name)
            if not fn:
                normalized = name[0].upper() + name[1:]
                fn = self.functions.get(normalized)
            if not fn:
                normalized_lower = name[0].lower() + name[1:]
                fn = self.functions.get(normalized_lower)

            if fn and hasattr(fn, "execute"):
                if hasattr(fn, "schema") and hasattr(fn.schema, "model_validate"):
                    target_val = (
                        {"call": name, "args": args}
                        if (
                            hasattr(fn.schema, "model_fields")
                            and "call" in fn.schema.model_fields
                        )
                        else args
                    )
                    try:
                        fn.schema.model_validate(target_val)
                    except Exception as e:
                        raise ValueError(
                            f"Validation failed for function '{name}': {e}"
                        )
                return fn.execute(args, context, abort_signal)

        self.invoker = dynamic_invoker

    def _get_component_class(self, comp_type: str) -> Optional[Type[BaseModel]]:
        return self.components.get(comp_type)

    def _get_function_class(self, func_name: str) -> Optional[Type[BaseModel]]:
        if not func_name:
            return None
        normalized = func_name[0].upper() + func_name[1:]
        fn = (
            self.functions.get(normalized)
            or self.functions.get(func_name)
            or self.functions.get(func_name[0].lower() + func_name[1:])
        )
        if fn is not None:
            if hasattr(fn, "schema"):
                return fn.schema
            if isinstance(fn, type) and issubclass(fn, BaseModel):
                return fn
            if isinstance(fn, type) and issubclass(fn, FunctionApi):
                return fn().schema
        return None

    def _check_nested_functions(self, val: Any) -> None:
        if isinstance(val, List):
            for item in val:
                self._check_nested_functions(item)
        elif isinstance(val, Dict):
            if "call" in val and "args" in val:
                func_name = val["call"]
                try:
                    self.validate_function(func_name, val["args"])
                except Exception as e:
                    raise ValueError(f"Invalid function call '{func_name}': {e}")
            for value in val.values():
                self._check_nested_functions(value)

    def _validate_component(self, comp_type: str, comp_payload: Dict[str, Any]) -> None:
        """Validates that a component payload conforms to the catalog's schema for this type."""
        comp_class = self._get_component_class(comp_type)
        if not comp_class:
            raise ValueError(f"Unknown component type: {comp_type}")

        schema = (
            comp_class.model_json_schema()
            if hasattr(comp_class, "model_json_schema")
            else {}
        )
        if schema.get("unevaluatedProperties") is False:
            defined = (
                set(comp_class.model_fields.keys())
                if hasattr(comp_class, "model_fields")
                else set()
            )
            extra = [k for k in comp_payload if k not in defined and k != "component"]
            if extra:
                raise ValueError(f"Extra inputs are not permitted: {extra}")

        comp_class.model_validate(comp_payload)
        self._check_nested_functions(comp_payload)

    def validate_components(self, comp_payload: List[Dict[str, Any]]) -> None:
        """Validates a list of component payloads conforming to the catalog's schemas."""
        for comp in comp_payload:
            if isinstance(comp, dict) and "component" in comp:
                self._validate_component(comp["component"], comp)

    def validate_theme(self, theme_payload: Dict[str, Any]) -> None:
        """Validates that theme properties conform to the catalog's theme schema."""
        if self.theme:
            self.theme.model_validate(theme_payload)

    def validate_function(self, func_name: str, args: Dict[str, Any]) -> None:
        """Validates that function arguments conform to the catalog's schema for this function."""
        func_class = self._get_function_class(func_name)
        if not func_class:
            raise ValueError(f"Unknown function: {func_name}")
        if hasattr(func_class, "model_fields") and "call" in func_class.model_fields:
            payload = {"call": func_name, "args": args}
            func_class.model_validate(payload)
        else:
            func_class.model_validate(args)

    def extract_ref_fields(self) -> Dict[str, Tuple[Set[str], Set[str]]]:
        """Inspects concrete Pydantic components dynamically to build the topological reference map."""
        ref_map = {}
        for comp_name, comp_class in self.components.items():
            single_refs = set()
            list_refs = set()

            # Pydantic V2 model_fields inspection
            if hasattr(comp_class, "model_fields"):
                for field_name, field_info in comp_class.model_fields.items():
                    annotation_str = str(field_info.annotation)

                    if (
                        "ComponentId" in annotation_str
                        or field_name in self.single_refs
                    ):
                        single_refs.add(field_name)
                    elif (
                        "List[ComponentId]" in annotation_str
                        or "ChildList" in annotation_str
                        or field_name in self.list_refs
                    ):
                        list_refs.add(field_name)

            if single_refs or list_refs:
                ref_map[comp_name] = (single_refs, list_refs)
        return ref_map
