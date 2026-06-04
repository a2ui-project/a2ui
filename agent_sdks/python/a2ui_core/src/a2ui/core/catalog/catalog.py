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

from typing import Any, Dict, List, Optional, Set, Tuple
from ..schema.constants import DEFAULT_SINGLE_REF_FIELDS, DEFAULT_LIST_REF_FIELDS, ROOT_ID, SPEC_BASE_URL


class Catalog:
    """Base abstract Catalog definition for framework-agnostic A2UI catalog integrations."""

    def __init__(
        self,
        version: str,
        catalog_id: str,
        custom_single_refs: Optional[List[str]] = None,
        custom_list_refs: Optional[List[str]] = None,
    ):
        if not version:
            raise ValueError("version must be provided.")
        if not catalog_id:
            raise ValueError("catalog_id must be provided.")

        self.version = version
        self.catalog_id = catalog_id
        self.single_refs = set(custom_single_refs or DEFAULT_SINGLE_REF_FIELDS)
        self.list_refs = set(custom_list_refs or DEFAULT_LIST_REF_FIELDS)

    def validate_components(self, comp_payload: List[Dict[str, Any]]) -> None:
        """Validates a list of component payloads conforming to the catalog's schemas."""
        raise NotImplementedError("Subclasses must implement validate_components()")

    def validate_function(self, func_name: str, args: Dict[str, Any]) -> None:
        """Validates that function arguments conform to the catalog's schema for this function."""
        raise NotImplementedError("Subclasses must implement validate_function()")

    def validate_theme(self, theme_payload: Dict[str, Any]) -> None:
        """Validates that theme properties conform to the catalog's theme schema."""
        raise NotImplementedError("Subclasses must implement validate_theme()")

    def extract_ref_fields(self) -> Dict[str, Tuple[Set[str], Set[str]]]:
        """Inspects and retrieves the topological reference pointer map for the active catalog components."""
        raise NotImplementedError("Subclasses must implement extract_ref_fields()")
