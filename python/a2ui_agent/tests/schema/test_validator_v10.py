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

"""Unit tests for the A2UI v1.0 validation wrapper."""

import unittest
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import VERSION_1_0
from a2ui.validation.validator import A2uiValidator, A2uiValidationError


class TestA2uiValidatorWrapperV10(unittest.TestCase):

    def setUp(self):
        self.catalog = A2uiCatalog(
            version=VERSION_1_0,
            name="test_catalog",
            experiments={"version_1_0"},
            s2c_schema={
                "$id": (
                    "https://a2ui.org/specification/v1_0/json/agent_to_renderer.json"
                ),
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "version": {"type": "string", "enum": ["1.0", "v1.0"]},
                    "createSurface": {
                        "type": "object",
                        "required": ["surfaceId", "components"],
                        "properties": {
                            "surfaceId": {"type": "string"},
                            "components": {
                                "type": "array",
                                "items": {"$ref": "catalog.json#/components/Text"},
                            },
                        },
                        "additionalProperties": False,
                    },
                },
                "required": ["version"],
            },
            common_types_schema={},
            catalog_schema={
                "catalogId": "https://a2ui.org/test_catalog",
                "components": {
                    "Text": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "component": {"type": "string", "enum": ["Text"]},
                            "text": {"type": "string"},
                        },
                        "required": ["id", "component", "text"],
                        "additionalProperties": False,
                    }
                },
            },
        )
        self.validator = A2uiValidator(self.catalog, experiments={"version_1_0"})

    def test_validation_success(self):
        payload = [{
            "version": "1.0",
            "createSurface": {
                "surfaceId": "welcome",
                "components": [
                    {"id": "root", "component": "Text", "text": "Hello World"}
                ],
            },
        }]
        # Should not raise any exception
        self.validator.validate(payload)

    def test_validation_missing_field(self):
        payload = [{
            "version": "1.0",
            "createSurface": {"components": []},  # missing surfaceId
        }]
        with self.assertRaises(A2uiValidationError) as ctx:
            self.validator.validate(payload)

        err = ctx.exception
        self.assertTrue(any(detail.code == "missing_field" for detail in err.details))
        self.assertTrue(any("surfaceId" in detail.message for detail in err.details))

    def test_validation_type_mismatch(self):
        payload = [{
            "version": "1.0",
            "createSurface": {
                "surfaceId": 12345,  # should be string
                "components": [],
            },
        }]
        with self.assertRaises(A2uiValidationError) as ctx:
            self.validator.validate(payload)

        err = ctx.exception
        self.assertTrue(any(detail.code == "type_mismatch" for detail in err.details))

    def test_validation_extra_field(self):
        payload = [{
            "version": "1.0",
            "createSurface": {
                "surfaceId": "welcome",
                "components": [],
                "extra_key": "not_allowed",  # additionalProperties: False
            },
        }]
        with self.assertRaises(A2uiValidationError) as ctx:
            self.validator.validate(payload)

        err = ctx.exception
        self.assertTrue(any(detail.code == "extra_field" for detail in err.details))

    def test_validation_oneof_context_errors(self):
        oneof_catalog = A2uiCatalog(
            version=VERSION_1_0,
            name="oneof_catalog",
            experiments={"version_1_0"},
            s2c_schema={
                "$id": (
                    "https://a2ui.org/specification/v1_0/json/agent_to_renderer.json"
                ),
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "oneOf": [
                    {
                        "properties": {
                            "version": {"const": "1.0"},
                            "first": {"type": "string"},
                        },
                        "required": ["version", "first"],
                    },
                    {
                        "properties": {
                            "version": {"const": "1.0"},
                            "second": {"type": "number"},
                        },
                        "required": ["version", "second"],
                    },
                ],
            },
            common_types_schema={},
            catalog_schema={
                "catalogId": "https://a2ui.org/test_catalog",
                "components": {},
            },
        )
        validator = A2uiValidator(oneof_catalog, experiments={"version_1_0"})
        payload = [{
            "version": "1.0",
            "first": (
                12345
            ),  # should be string, meaning first branch fails on type, second fails on missing "second"
        }]
        with self.assertRaises(A2uiValidationError) as ctx:
            validator.validate(payload)

        err = ctx.exception
        # Ensure context failures are formatted into the main error message
        self.assertIn("Context failures:", str(err))
        # Ensure sub-errors are parsed into err.details
        self.assertTrue(any(detail.code == "type_mismatch" for detail in err.details))
        self.assertTrue(any(detail.code == "missing_field" for detail in err.details))

    def test_validation_date_time_formats(self):
        date_catalog = A2uiCatalog(
            version=VERSION_1_0,
            name="date_catalog",
            experiments={"version_1_0"},
            s2c_schema={
                "$id": (
                    "https://a2ui.org/specification/v1_0/json/agent_to_renderer.json"
                ),
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "version": {"const": "v1.0"},
                    "dt": {"type": "string", "format": "date-time"},
                    "tm": {"type": "string", "format": "time"},
                    "d": {"type": "string", "format": "date"},
                },
                "required": ["version"],
            },
            common_types_schema={},
            catalog_schema={
                "catalogId": "https://a2ui.org/test_catalog",
                "components": {},
            },
        )
        validator = A2uiValidator(date_catalog, experiments={"version_1_0"})
        # Valid date/time formats
        validator.validate([{
            "version": "v1.0",
            "dt": "2026-08-12T11:35:00Z",
            "tm": "11:35:00",
            "d": "2026-08-12",
        }])

        # Invalid date-time format
        with self.assertRaises(A2uiValidationError):
            validator.validate([{
                "version": "v1.0",
                "dt": "invalid-datetime",
            }])

        # Invalid time format
        with self.assertRaises(A2uiValidationError):
            validator.validate([{
                "version": "v1.0",
                "tm": "invalid-time",
            }])

        # Invalid date format
        with self.assertRaises(A2uiValidationError):
            validator.validate([{
                "version": "v1.0",
                "d": "invalid-date",
            }])

    def test_validation_update_components_message(self):
        from a2ui.validation.validator import ValidationConfig

        payload = [{
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "welcome",
                "components": [{"id": "c1", "component": "Text", "text": "Updated"}],
            },
        }]
        # s2c_schema supports updateComponents for this test
        update_catalog = A2uiCatalog(
            version=VERSION_1_0,
            name="update_catalog",
            experiments={"version_1_0"},
            s2c_schema={
                "$id": (
                    "https://a2ui.org/specification/v1_0/json/agent_to_renderer.json"
                ),
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "version": {"const": "v1.0"},
                    "updateComponents": {
                        "type": "object",
                        "required": ["surfaceId", "components"],
                        "properties": {
                            "surfaceId": {"type": "string"},
                            "components": {
                                "type": "array",
                                "items": {"$ref": "catalog.json#/components/Text"},
                            },
                        },
                    },
                },
                "required": ["version"],
            },
            common_types_schema={},
            catalog_schema={
                "catalogId": "https://a2ui.org/test_catalog",
                "components": {
                    "Text": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "component": {"type": "string", "enum": ["Text"]},
                            "text": {"type": "string"},
                        },
                        "required": ["id", "component", "text"],
                    }
                },
            },
        )
        validator = A2uiValidator(update_catalog, experiments={"version_1_0"})
        # 1. Valid updateComponents payload passes
        validator.validate(payload, config=ValidationConfig(allow_missing_root=True))

        # 2. Invalid component property raises A2uiValidationError
        invalid_comp_payload = [{
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "welcome",
                "components": [{"id": "c1", "component": "Text"}],  # missing text
            },
        }]
        with self.assertRaises(A2uiValidationError) as ctx:
            validator.validate(
                invalid_comp_payload, config=ValidationConfig(allow_missing_root=True)
            )
        self.assertTrue(any(d.code == "missing_field" for d in ctx.exception.details))
