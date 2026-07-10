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
from pydantic import BaseModel, ConfigDict, ValidationError

from ..exceptions import A2uiValidationError, A2uiErrorDetail
from ..schema import A2uiMessageListWrapper
from ..schema.constants import (
    SPEC_VERSION,
    MSG_TYPE_CREATE_SURFACE,
    MSG_TYPE_UPDATE_COMPONENTS,
    MSG_TYPE_UPDATE_DATA_MODEL,
    MSG_TYPE_DELETE_SURFACE,
    CATALOG_COMPONENTS_KEY,
    THEME_KEY,
    ROOT_ID,
)

from .integrity_checker import (
    validate_component_integrity,
    validate_recursion_and_paths,
)
from .topology_analyzer import analyze_topology
from .catalog_schema_validator import CatalogSchemaValidator


class A2uiValidatorError(A2uiValidationError):
    """Exception raised when an A2UI Catalog payload validation fails."""


class ValidationConfig(BaseModel):
    """Configuration options for A2UI payload and component validation."""

    model_config = ConfigDict(frozen=True)

    allow_orphan_components: bool = False
    allow_dangling_references: bool = False
    allow_missing_root: bool = False
    target_version: Optional[str] = None


# Define the presets as global constants
STRICT_VALIDATION = ValidationConfig()
RELAXED_VALIDATION = ValidationConfig(
    allow_orphan_components=True,
    allow_dangling_references=True,
    allow_missing_root=True,
)


# Define the presets as global constants
STRICT_VALIDATION = ValidationConfig()
RELAXED_VALIDATION = ValidationConfig(
    allow_orphan_components=True, allow_dangling_references=True
)


def _clean_loc_part(x: str) -> str:
    """Extracts base message class names from Pydantic validator wrapper strings."""
    if x.startswith("function-after[") or x.startswith("function-before["):
        match = re.search(r"([A-Za-z0-9_]+Message)\]", x)
        if match:
            return match.group(1)
    return x


class A2uiValidator:
    """Validates the A2UI JSON payload against catalog schemas and checks for layout integrity."""

    def validate_protocol_envelope(
        self,
        messages: List[Dict[str, Any]],
        config: ValidationConfig = STRICT_VALIDATION,
    ) -> None:
        """Validates the overall A2UI protocol payload structure using Pydantic."""
        details = []
        expected_version = (
            config.target_version if config.target_version else SPEC_VERSION
        )

        for i, msg in enumerate(messages):
            if not isinstance(msg, dict):
                details.append(
                    A2uiErrorDetail(
                        path=f"messages.{i}",
                        code="type_mismatch",
                        message="Message must be an object",
                    )
                )
            else:
                if "version" not in msg:
                    details.append(
                        A2uiErrorDetail(
                            path=f"messages.{i}.version",
                            code="missing_field",
                            message="'version' is a required property",
                        )
                    )

        try:
            A2uiMessageListWrapper.model_validate(
                {"messages": messages},
                context={"target_version": expected_version},
            )
            validate_recursion_and_paths(messages)
        except ValidationError as e:
            details.extend(self._format_validation_errors(e, messages))
        except A2uiValidationError as e:
            raise A2uiValidatorError(str(e), details=e.details)

        if details:
            summary = "\n".join(f"{d.path}: {d.message}" for d in details)
            raise A2uiValidatorError(summary, details=details)

    def _format_validation_errors(
        self, error: ValidationError, messages: List[Dict[str, Any]]
    ) -> List[A2uiErrorDetail]:
        """Formats Pydantic validation errors while filtering out irrelevant union branches."""
        details = []
        for err in error.errors():
            loc = err.get("loc", [])
            loc_parts = [_clean_loc_part(str(x)) for x in loc]
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
            clean_loc_parts = [
                x
                for x in loc_parts
                if x
                not in (
                    "CreateSurfaceMessage",
                    "UpdateComponentsMessage",
                    "UpdateDataModelMessage",
                    "DeleteSurfaceMessage",
                )
            ]
            path_str = ".".join(clean_loc_parts)
            msg = err.get("msg", "Validation failed")
            err_type = err.get("type", "")
            if err_type == "missing":
                code = "missing_field"
            elif err_type == "extra_forbidden":
                code = "extra_field"
            elif (
                err_type.endswith("_type")
                or err_type.endswith("_parsing")
                or "type" in err_type
            ):
                code = "type_mismatch"
            else:
                code = "invalid_value"
            details.append(A2uiErrorDetail(path_str, code, msg))
        return details

    def validate_components(
        self,
        schema_validator: CatalogSchemaValidator,
        components: List[Dict[str, Any]],
        config: ValidationConfig = STRICT_VALIDATION,
    ) -> None:
        errors = []
        if components:
            # Validate each component individually to avoid short-circuiting on the first
            # invalid component and collect all schema validation errors across the payload.
            for c in components:
                try:
                    schema_validator.validate_components([c])
                except Exception as ce:
                    errors.append(ce)
            if not errors:
                try:
                    ref_fields = schema_validator.extract_ref_fields()
                    validate_component_integrity(
                        components,
                        ref_fields,
                        allow_dangling_references=config.allow_dangling_references,
                        allow_missing_root=config.allow_missing_root,
                    )
                    analyze_topology(
                        components,
                        ref_fields,
                        allow_orphan_components=config.allow_orphan_components,
                        allow_missing_root=config.allow_missing_root,
                    )
                except Exception as e:
                    errors.append(e)
        if errors:
            details = []
            for err in errors:
                if hasattr(err, "details") and err.details:
                    details.extend(err.details)
            err_msg = "\n".join(str(err) for err in errors)
            raise A2uiValidatorError(err_msg, details=details)

    def validate(
        self,
        schema_validator: CatalogSchemaValidator,
        a2ui_payload: Union[Dict[str, Any], List[Any]],
        config: ValidationConfig = STRICT_VALIDATION,
    ) -> None:

        messages = a2ui_payload if isinstance(a2ui_payload, list) else [a2ui_payload]

        errors = []
        try:
            self.validate_protocol_envelope(messages, config=config)
        except Exception as e:
            errors.append(e)

        # Automatically enable allow_missing_root if it's an incremental update (no createSurface)
        has_create = any(
            isinstance(m, dict) and MSG_TYPE_CREATE_SURFACE in m for m in messages
        )
        if not has_create and not config.allow_missing_root:
            config = config.model_copy(update={"allow_missing_root": True})

        for msg in messages:
            if isinstance(msg, dict):
                try:
                    if MSG_TYPE_CREATE_SURFACE in msg:
                        theme = msg[MSG_TYPE_CREATE_SURFACE].get(THEME_KEY)
                        if theme:
                            schema_validator.validate_theme(theme)
                    elif MSG_TYPE_UPDATE_COMPONENTS in msg:
                        components = msg[MSG_TYPE_UPDATE_COMPONENTS].get(
                            CATALOG_COMPONENTS_KEY
                        )
                        if isinstance(components, list):
                            self.validate_components(
                                schema_validator,
                                components,
                                config=config,
                            )
                except Exception as e:
                    errors.append(e)

        if errors:
            details = []
            for err in errors:
                if hasattr(err, "details") and err.details:
                    details.extend(err.details)
            raise A2uiValidatorError(
                "\n".join(str(err) for err in errors), details=details
            )
