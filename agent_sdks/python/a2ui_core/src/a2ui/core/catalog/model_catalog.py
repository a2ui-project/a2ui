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

from typing import Any, Callable, Dict, List, Optional, Set, Tuple, Type, Union, get_args, get_origin
from pydantic import BaseModel
from .catalog import CatalogImplementation
from .functions import FunctionImplementation
from ..schema.common_types import ComponentReference, SingleReference, ListReference


class ModelCatalog(CatalogImplementation):
    """A Pydantic-compiled concrete Catalog implementation."""

    def __init__(
        self,
        spec_version: str,
        catalog_id: str,
        components: Dict[str, Type[BaseModel]],
        functions: Optional[Dict[str, Any]] = None,
        theme: Optional[Type[BaseModel]] = None,
    ):
        super().__init__(
            spec_version=spec_version,
            catalog_id=catalog_id,
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

    def get_component_class(self, comp_type: str) -> Optional[Type[BaseModel]]:
        return self.components.get(comp_type)

    def get_function_class(self, func_name: str) -> Optional[Type[BaseModel]]:
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

    def get_component_schema(self, comp_type: str) -> Optional[Dict[str, Any]]:
        comp_class = self.get_component_class(comp_type)
        if comp_class and hasattr(comp_class, "model_json_schema"):
            return comp_class.model_json_schema()
        return None

    def get_function_schema(self, func_name: str) -> Optional[Dict[str, Any]]:
        func_class = self.get_function_class(func_name)
        if func_class and hasattr(func_class, "model_json_schema"):
            return func_class.model_json_schema()
        return None

    def get_theme_schema(self) -> Optional[Dict[str, Any]]:
        if self.theme and hasattr(self.theme, "model_json_schema"):
            return self.theme.model_json_schema()
        return None

    def get_function_implementation(
        self, func_name: str
    ) -> Optional[FunctionImplementation]:
        return self.functions.get(func_name)

    def invoke_function(
        self,
        name: str,
        args: Dict[str, Any],
        context: Any = None,
        abort_signal: Optional[Any] = None,
    ) -> Any:
        return self.invoker(name, args, context, abort_signal)

    def extract_ref_fields(self) -> Dict[str, Tuple[Set[str], Set[str]]]:
        """Inspects concrete Pydantic components dynamically to build the topological reference map using Reference helper classes."""

        def _is_ref_type(typ: Any) -> Tuple[bool, bool]:
            if isinstance(typ, type):
                if issubclass(typ, SingleReference):
                    return True, False
                if issubclass(typ, ListReference):
                    return False, True

            origin = get_origin(typ)
            if origin in (list, List):
                args = get_args(typ)
                if args:
                    elem = args[0]
                    if isinstance(elem, type) and issubclass(elem, ComponentReference):
                        return False, True
                    if isinstance(elem, type) and issubclass(elem, BaseModel):
                        for fi in elem.model_fields.values():
                            s, l = _is_ref_type(fi.annotation)
                            if s or l:
                                return False, True

            if origin == Union:
                args = get_args(typ)
                has_s, has_l = False, False
                for arg in args:
                    s, l = _is_ref_type(arg)
                    if s:
                        has_s = True
                    if l:
                        has_l = True
                return has_s, has_l

            return False, False

        ref_map = {}
        for comp_name, comp_class in self.components.items():
            single_refs = set()
            list_refs = set()

            if hasattr(comp_class, "model_fields"):
                for field_name, field_info in comp_class.model_fields.items():
                    if field_name in ("id", "component"):
                        continue
                    s, l = _is_ref_type(field_info.annotation)
                    if s:
                        single_refs.add(field_name)
                    if l:
                        list_refs.add(field_name)

            if single_refs or list_refs:
                ref_map[comp_name] = (single_refs, list_refs)
        return ref_map
