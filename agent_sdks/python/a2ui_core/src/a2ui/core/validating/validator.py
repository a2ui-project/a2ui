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

import re
from typing import Any, Dict, Iterator, List, Optional, Set, Tuple, Union
from pydantic import BaseModel, ValidationError

from ..schema import A2uiMessageListWrapper
from ..schema.constants import (
    MSG_TYPE_CREATE_SURFACE,
    MSG_TYPE_UPDATE_COMPONENTS,
    MSG_TYPE_UPDATE_DATA_MODEL,
    MSG_TYPE_DELETE_SURFACE,
    CATALOG_COMPONENTS_KEY,
    THEME_KEY,
)

from .integrity_checker import (
    validate_component_integrity,
    validate_recursion_and_paths,
)
from .topology_analyzer import analyze_topology
from .catalog_validator import CatalogValidator


class A2uiValidatorError(ValueError):
    """Exception raised when an A2UI Catalog payload validation fails."""


class ValidationConfig(BaseModel):
    """Configuration options for A2UI payload and component validation."""

    allow_orphan_components: bool = False
    allow_dangling_references: bool = False


class A2uiValidator:
    """Validates the A2UI JSON payload against catalog schemas and checks for layout integrity."""

    def validate_protocol_envelope(self, messages: List[Dict[str, Any]]) -> None:
        """Validates the overall A2UI protocol payload structure using Pydantic."""
        struct_errors = []
        for msg in messages:
            if not isinstance(msg, dict):
                struct_errors.append("Message must be an object")
            elif "version" not in msg:
                struct_errors.append("'version' is a required property")

        try:
            A2uiMessageListWrapper.model_validate({"messages": messages})
            for msg in messages:
                validate_recursion_and_paths(messages)
        except ValidationError as e:
            struct_errors.extend(self._format_validation_errors(e, messages))
        if struct_errors:
            raise A2uiValidatorError("\n".join(struct_errors))

    def _format_validation_errors(
        self, error: ValidationError, messages: List[Dict[str, Any]]
    ) -> List[str]:
        """Formats Pydantic validation errors while filtering out irrelevant union branches."""
        formatted_errors = []
        for err in error.errors():
            loc = err.get("loc", [])
            loc_parts = [str(x) for x in loc]
            if len(loc) >= 3 and loc[0] == "messages" and isinstance(loc[1], int):
                msg_idx = loc[1]
                if msg_idx < len(messages) and isinstance(messages[msg_idx], dict):
                    m = messages[msg_idx]
                    is_recognized_message_type = any(
                        k in m
                        for k in [
                            MSG_TYPE_CREATE_SURFACE,
                            MSG_TYPE_UPDATE_COMPONENTS,
                            MSG_TYPE_UPDATE_DATA_MODEL,
                            MSG_TYPE_DELETE_SURFACE,
                        ]
                    )
                    if is_recognized_message_type:
                        branch = loc_parts[2]
                        if (
                            branch == "CreateSurfaceMessage"
                            and MSG_TYPE_CREATE_SURFACE not in m
                        ):
                            continue
                        if (
                            branch == "UpdateComponentsMessage"
                            and MSG_TYPE_UPDATE_COMPONENTS not in m
                        ):
                            continue
                        if (
                            branch == "UpdateDataModelMessage"
                            and MSG_TYPE_UPDATE_DATA_MODEL not in m
                        ):
                            continue
                        if (
                            branch == "DeleteSurfaceMessage"
                            and MSG_TYPE_DELETE_SURFACE not in m
                        ):
                            continue
            path_str = ".".join(loc_parts)
            msg = err.get("msg", "Validation failed")
            formatted_errors.append(f"{path_str}: {msg}")
        return formatted_errors

    def validate_components(
        self,
        catalog_validator: CatalogValidator,
        components: List[Dict[str, Any]],
        config: ValidationConfig = ValidationConfig(),
    ) -> None:
        errors = []
        if components:
            # Validate each component individually to avoid short-circuiting on the first
            # invalid component and collect all schema validation errors across the payload.
            for c in components:
                try:
                    catalog_validator.validate_components([c])
                except Exception as ce:
                    errors.append(ce)
            if not errors:
                try:
                    ref_fields = catalog_validator.extract_ref_fields()
                    validate_component_integrity(
                        components,
                        ref_fields,
                        allow_dangling_references=config.allow_dangling_references,
                    )
                    analyze_topology(
                        components,
                        ref_fields,
                        allow_orphan_components=config.allow_orphan_components,
                    )
                except Exception as e:
                    errors.append(e)
        if errors:
            err_msg = "\n".join(str(err) for err in errors)
            raise A2uiValidatorError(err_msg)

    def validate(
        self,
        catalog_validator: CatalogValidator,
        a2ui_payload: Union[Dict[str, Any], List[Any]],
        config: Optional[ValidationConfig] = None,
    ) -> None:
        if config is None:
            config = ValidationConfig(
                allow_orphan_components=False, allow_dangling_references=False
            )

        messages = a2ui_payload if isinstance(a2ui_payload, list) else [a2ui_payload]

        errors = []
        try:
            self.validate_protocol_envelope(messages)
        except Exception as e:
            errors.append(e)

        for msg in messages:
            if isinstance(msg, dict):
                try:
                    if MSG_TYPE_CREATE_SURFACE in msg:
                        theme = msg[MSG_TYPE_CREATE_SURFACE].get(THEME_KEY)
                        if theme:
                            catalog_validator.validate_theme(theme)
                    elif MSG_TYPE_UPDATE_COMPONENTS in msg:
                        components = msg[MSG_TYPE_UPDATE_COMPONENTS].get(
                            CATALOG_COMPONENTS_KEY
                        )
                        if isinstance(components, list):
                            self.validate_components(
                                catalog_validator,
                                components,
                                config=config,
                            )
                except Exception as e:
                    errors.append(e)

        if errors:
            raise A2uiValidatorError("\n".join(str(err) for err in errors))
