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

"""Facade validator dispatching to version-specific validation engines."""

from __future__ import annotations
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Set, Tuple, Union, Mapping

from a2ui.schema.constants import VERSION_0_8, VERSION_0_9, VERSION_0_9_1, VERSION_1_0
from .validator_v08 import (
    LegacyA2uiValidatorV08,
    extract_component_required_fields as v08_req,
    extract_component_ref_fields as v08_ref,
)
from a2ui.core.validating import A2uiValidator as CoreValidator
from a2ui.core.validating.integrity_checker import (
    get_component_references as get_component_references,
)
from a2ui.core.validating.topology_analyzer import analyze_topology as analyze_topology
from a2ui.core.validating.validator import ValidationConfig, STRICT_VALIDATION
from a2ui.core.validating.catalog_schema_validator import CatalogSchemaValidator
from a2ui.core import A2uiValidationError, A2uiCatalogError


if TYPE_CHECKING:
    from a2ui.schema.catalog import A2uiCatalog


def extract_component_required_fields(catalog: A2uiCatalog) -> Dict[str, Set[str]]:
    if catalog.version == VERSION_0_8:
        return v08_req(catalog)
    cs = catalog.catalog_schema
    all_components = cs.get("components", {}) if isinstance(cs, dict) else {}
    req_map = {}
    for comp_name, comp_schema in all_components.items():
        if isinstance(comp_schema, dict):
            reqs = set(comp_schema.get("required", [])) - {"component"}
            if reqs:
                req_map[comp_name] = reqs
    return req_map


def extract_component_ref_fields(
    catalog: A2uiCatalog,
) -> Mapping[str, Tuple[Set[str], Set[str]]]:
    if catalog.version == VERSION_0_8:
        return v08_ref(catalog)
    result = CatalogSchemaValidator(
        catalog.core_catalog,
        catalog.common_types_schema,
    ).extract_ref_fields()
    return result


class A2uiValidatorWrapper:
    """Validates v0.9+ payloads using a2ui_core."""

    def __init__(self, catalog: A2uiCatalog):
        self._catalog = catalog
        self._validator = CoreValidator()

    def validate(
        self,
        a2ui_json: Union[Dict[str, Any], List[Any]],
        root_id: Optional[str] = None,
        config: ValidationConfig = STRICT_VALIDATION,
    ) -> None:
        target_ver = f"v{self._catalog.version}"
        updated_config = config.model_copy(update={"target_version": target_ver})
        self._validator.validate(
            schema_validator=CatalogSchemaValidator(
                self._catalog.core_catalog,
                self._catalog.common_types_schema,
            ),
            a2ui_payload=a2ui_json,
            config=updated_config,
        )


class A2uiValidatorWrapperV10:
    """Validates dynamic payloads (such as v0.9.1 and v1.0) using jsonschema and core component integrity checks."""

    def __init__(self, catalog: A2uiCatalog):
        self._catalog = catalog
        from urllib.parse import urljoin
        from jsonschema import Draft202012Validator, FormatChecker
        from referencing import Registry, Resource
        from datetime import datetime, time, date

        format_checker = FormatChecker()

        @format_checker.checks("date-time")
        def is_datetime(val: Any) -> bool:
            if not isinstance(val, str):
                return True
            try:
                datetime.fromisoformat(val)
                return True
            except ValueError:
                return False

        @format_checker.checks("time")
        def is_time(val: Any) -> bool:
            if not isinstance(val, str):
                return True
            try:
                time.fromisoformat(val)
                return True
            except ValueError:
                return False

        @format_checker.checks("date")
        def is_date(val: Any) -> bool:
            if not isinstance(val, str):
                return True
            try:
                date.fromisoformat(val)
                return True
            except ValueError:
                return False

        s2c = catalog.s2c_schema or {}
        common = catalog.common_types_schema or {}
        cat = catalog.catalog_schema or {}

        s2c_id = s2c.get("$id")
        if not s2c_id:
            if catalog.version == VERSION_0_8:
                s2c_id = "https://a2ui.org/specification/v0_8/server_to_client.json"
            elif catalog.version in (VERSION_0_9, VERSION_0_9_1):
                s2c_id = "https://a2ui.org/specification/v0_9/server_to_client.json"
            else:
                s2c_id = "https://a2ui.org/specification/v1_0/agent_to_renderer.json"

        resources = []
        for schema_name, schema in [("s2c", s2c), ("common", common)]:
            if schema is not None:
                schema_id = schema.get("$id")
                if not schema_id:
                    if schema_name == "s2c":
                        schema_id = s2c_id
                    else:
                        schema_id = (
                            urljoin(s2c_id, "common_types.json")
                            if s2c_id
                            else "https://a2ui.org/specification/v1_0/json/common_types.json"
                        )
                schema_copy = dict(schema)
                if "$schema" not in schema_copy:
                    schema_copy["$schema"] = (
                        "https://json-schema.org/draft/2020-12/schema"
                    )
                resources.append((schema_id, Resource.from_contents(schema_copy)))

        if isinstance(cat, dict) and cat:
            cat_copy = dict(cat)
            if "$schema" not in cat_copy:
                cat_copy["$schema"] = "https://json-schema.org/draft/2020-12/schema"
            # Ensure $defs and anyComponent exist in the catalog schema
            if "$defs" not in cat_copy:
                cat_copy["$defs"] = {}
            else:
                cat_copy["$defs"] = dict(cat_copy["$defs"])
            if "anyComponent" not in cat_copy["$defs"]:
                one_of_refs = []
                components = cat_copy.get("components", {})
                if isinstance(components, dict):
                    for comp_name in components.keys():
                        one_of_refs.append({"$ref": f"#/components/{comp_name}"})
                cat_copy["$defs"]["anyComponent"] = {
                    "oneOf": one_of_refs if one_of_refs else [{"type": "object"}]
                }
            resources.append(("catalog.json", Resource.from_contents(cat_copy)))
            if s2c_id:
                resolved_catalog_uri = urljoin(s2c_id, "catalog.json")
                cat_copy_uri = dict(cat_copy)
                cat_copy_uri["$id"] = resolved_catalog_uri
                resources.append(
                    (resolved_catalog_uri, Resource.from_contents(cat_copy_uri))
                )
            if "$id" in cat:
                resources.append((cat["$id"], Resource.from_contents(cat_copy)))
                resolved_common_uri = urljoin(cat["$id"], "common_types.json")
                if common:
                    resources.append(
                        (resolved_common_uri, Resource.from_contents(common))
                    )

        self._registry = Registry().with_resources(resources)
        self._wrapped_schema = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "array",
            "items": {"$ref": s2c_id},
        }
        self._schema_validator = Draft202012Validator(
            self._wrapped_schema,
            registry=self._registry,
            format_checker=format_checker,
        )

    def validate(
        self,
        a2ui_json: Union[Dict[str, Any], List[Any]],
        root_id: Optional[str] = None,
        config: ValidationConfig = STRICT_VALIDATION,
    ) -> None:
        messages = a2ui_json if isinstance(a2ui_json, list) else [a2ui_json]
        all_errors = []
        details = []

        # 1. Run schema validation
        errors = list(self._schema_validator.iter_errors(messages))
        if errors:
            from a2ui.core import A2uiErrorDetail
            import re

            for err in errors:
                path_str = (
                    ".".join(["messages"] + [str(p) for p in err.path])
                    if err.path
                    else "messages"
                )
                err_validator = getattr(err, "validator", "")
                if err_validator == "required":
                    code = "missing_field"
                    match = re.search(r"'(.+?)' is a required property", err.message)
                    if match:
                        path_str = f"{path_str}.{match.group(1)}"
                elif err_validator == "type":
                    code = "type_mismatch"
                elif err_validator == "additionalProperties":
                    code = "extra_field"
                else:
                    code = "invalid_value"
                details.append(A2uiErrorDetail(path_str, code, err.message))
                if err.context:
                    for sub_error in err.context:
                        parent_path = list(err.path)
                        sub_path_list = list(sub_error.path)
                        if sub_path_list[: len(parent_path)] != parent_path:
                            full_sub_path = parent_path + sub_path_list
                        else:
                            full_sub_path = sub_path_list
                        sub_path = (
                            ".".join(["messages"] + [str(p) for p in full_sub_path])
                            if full_sub_path
                            else path_str
                        )
                        sub_validator = getattr(sub_error, "validator", "")
                        if sub_validator == "required":
                            sub_code = "missing_field"
                            match = re.search(
                                r"'(.+?)' is a required property", sub_error.message
                            )
                            if match:
                                sub_path = f"{sub_path}.{match.group(1)}"
                        elif sub_validator == "type":
                            sub_code = "type_mismatch"
                        elif sub_validator == "additionalProperties":
                            sub_code = "extra_field"
                        else:
                            sub_code = "invalid_value"
                        details.append(
                            A2uiErrorDetail(sub_path, sub_code, sub_error.message)
                        )

            def collect_messages(error: Any) -> list[str]:
                msgs = [error.message]
                if error.context:
                    for sub in error.context:
                        msgs.extend(collect_messages(sub))
                return msgs

            if len(details) > 1:
                msg = (
                    f"Validation failed: {details[0].path}:"
                    f" {details[0].message}\nContext failures:\n"
                    + "\n".join(f"  - {d.path}: {d.message}" for d in details[1:])
                )
            else:
                msg = f"Validation failed: {details[0].path}: {details[0].message}"
            all_errors.append(A2uiValidationError(msg, details=details))

        # 2. Run component integrity validation
        has_create = any(isinstance(m, dict) and "createSurface" in m for m in messages)
        if not has_create and not config.allow_missing_root:
            config = config.model_copy(update={"allow_missing_root": True})

        from a2ui.core.validating.integrity_checker import (
            validate_component_integrity,
            validate_recursion_and_paths,
        )

        all_components: list[dict[str, Any]] = []
        for message in messages:
            if not isinstance(message, dict):
                continue
            if "createSurface" in message and isinstance(
                message["createSurface"], dict
            ):
                comps = message["createSurface"].get("components")
                if isinstance(comps, list):
                    all_components.extend(comps)
            elif "updateComponents" in message and isinstance(
                message["updateComponents"], dict
            ):
                comps = message["updateComponents"].get("components")
                if isinstance(comps, list):
                    all_components.extend(comps)

        if all_components:
            schema_validator = CatalogSchemaValidator(
                self._catalog.core_catalog,
                self._catalog.common_types_schema,
            )

            component_errors = []
            for c in all_components:
                try:
                    schema_validator.validate_components([c])
                except Exception as ce:
                    component_errors.append(ce)

            if component_errors:
                from a2ui.core import A2uiErrorDetail

                for err in component_errors:
                    if hasattr(err, "details") and err.details:
                        details.extend(err.details)
                    else:
                        details.append(
                            A2uiErrorDetail(
                                path="components",
                                code="invalid_value",
                                message=str(err),
                            )
                        )
                comp_msg = "\n".join(str(err) for err in component_errors)
                all_errors.append(A2uiValidationError(comp_msg, details=details))

            try:
                ref_fields = schema_validator.extract_ref_fields()

                validate_component_integrity(
                    all_components,
                    ref_fields,
                    allow_dangling_references=config.allow_dangling_references,
                    allow_missing_root=config.allow_missing_root,
                )

                analyze_topology(
                    all_components,
                    ref_fields,
                    allow_orphan_components=config.allow_orphan_components,
                    allow_missing_root=config.allow_missing_root,
                )
            except Exception as e:
                all_errors.append(e)

        try:
            validate_recursion_and_paths(messages)
        except Exception as e:
            all_errors.append(e)

        if all_errors:
            err_msg = "\n".join(str(err) for err in all_errors)
            raise A2uiValidationError(err_msg, details=details)


class A2uiValidator:
    """Version-aware validation facade dispatching to v0.8 or v0.9+ engines."""

    def __init__(
        self,
        catalog: A2uiCatalog,
        experiments: Optional[Union[set[str], frozenset[str]]] = None,
    ):
        ver = catalog.version
        self.version = ver if isinstance(ver, str) else VERSION_0_8

        self.experiments = (set(experiments) if experiments else set()) | (
            set(catalog.experiments) if catalog and catalog.experiments else set()
        )

        if self.version == VERSION_0_8:
            self._delegator: Union[
                LegacyA2uiValidatorV08, A2uiValidatorWrapper, A2uiValidatorWrapperV10
            ] = LegacyA2uiValidatorV08(catalog)
        elif self.version in (VERSION_0_9, VERSION_0_9_1):
            self._delegator = A2uiValidatorWrapperV10(catalog)
        elif self.version == VERSION_1_0:
            if "version_1_0" not in self.experiments:
                raise A2uiCatalogError(
                    "A2UI v1.0 validation is experimental and must be enabled via the"
                    " 'version_1_0' experiment flag."
                )
            self._delegator = A2uiValidatorWrapperV10(catalog)

    def validate(
        self,
        a2ui_json: Union[Dict[str, Any], List[Any]],
        root_id: Optional[str] = None,
        config: ValidationConfig = STRICT_VALIDATION,
    ) -> None:
        """Validates the structure, integrity, and topology of the A2UI message.

        Args:
            a2ui_json: The A2UI message payload (object or list of objects).
            root_id: The ID of the root component context.
            config: The ValidationConfig constraint settings (STRICT or RELAXED).

        Raises:
            A2uiValidationError: If any JSON schema, reference integrity, or circular path checks fail.
        """
        self._delegator.validate(a2ui_json, root_id=root_id, config=config)
