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

import pytest
from a2ui.core.catalog import Catalog
from a2ui.core.exceptions import A2uiValidationError
from a2ui.core.validation import (
    A2uiValidatorError,
    CatalogSchemaValidator,
    RELAXED_VALIDATION,
    STRICT_VALIDATION,
    ValidationConfig,
)


@pytest.fixture
def sample_catalog() -> Catalog:
    catalog_schema = {
        "catalogId": "test-catalog",
        "components": {
            "Button": {
                "type": "object",
                "properties": {
                    "component": {"const": "Button"},
                    "id": {"type": "string"},
                    "label": {"type": "string"},
                },
                "required": ["component", "id", "label"],
                "additionalProperties": False,
            }
        },
        "functions": {
            "formatString": {
                "parameters": {
                    "template": {"type": "string"},
                },
                "required": ["template"],
                "additionalProperties": False,
            }
        },
    }
    return Catalog.from_json(catalog_schema, protocol_version="v0.9")


def test_validation_config_defaults():
    config = ValidationConfig()
    assert config.allow_unknown_elements is False
    assert STRICT_VALIDATION.allow_unknown_elements is False
    assert RELAXED_VALIDATION.allow_unknown_elements is True


def test_unknown_component_type(sample_catalog):
    schema_val = CatalogSchemaValidator.from_catalog(sample_catalog)

    components = [{"id": "c1", "component": "UnknownWidget", "foo": "bar"}]

    # Default / strict mode: rejects unknown component
    strict_config = ValidationConfig(allow_unknown_elements=False)
    with pytest.raises((A2uiValidationError, A2uiValidatorError)):
        schema_val.validate_components(components, config=strict_config)

    # Allowed unknown elements mode: permits unknown component
    relaxed_config = ValidationConfig(allow_unknown_elements=True)
    schema_val.validate_components(components, config=relaxed_config)


def test_unknown_component_property(sample_catalog):
    schema_val = CatalogSchemaValidator.from_catalog(sample_catalog)

    components = [{
        "id": "btn1",
        "component": "Button",
        "label": "Click Me",
        "unknownAttribute": "someValue",
    }]

    # Default / strict mode: rejects extra property
    strict_config = ValidationConfig(allow_unknown_elements=False)
    with pytest.raises((A2uiValidationError, A2uiValidatorError)):
        schema_val.validate_components(components, config=strict_config)

    # Allowed unknown elements mode: permits extra property
    relaxed_config = ValidationConfig(allow_unknown_elements=True)
    schema_val.validate_components(components, config=relaxed_config)


def test_unknown_function_name(sample_catalog):
    schema_val = CatalogSchemaValidator.from_catalog(sample_catalog)

    # Strict mode: rejects unknown function
    strict_config = ValidationConfig(allow_unknown_elements=False)
    with pytest.raises((A2uiValidationError, A2uiValidatorError)):
        schema_val.validate_function(
            "unknownFunc", {"arg": "val"}, config=strict_config
        )

    # Allowed unknown elements mode: permits unknown function
    relaxed_config = ValidationConfig(allow_unknown_elements=True)
    schema_val.validate_function("unknownFunc", {"arg": "val"}, config=relaxed_config)


def test_unknown_function_parameter(sample_catalog):
    schema_val = CatalogSchemaValidator.from_catalog(sample_catalog)

    # Strict mode: rejects extra parameter
    strict_config = ValidationConfig(allow_unknown_elements=False)
    with pytest.raises((A2uiValidationError, A2uiValidatorError)):
        schema_val.validate_function(
            "formatString",
            {"template": "Hello %s", "extraParam": True},
            config=strict_config,
        )

    # Allowed unknown elements mode: permits extra parameter
    relaxed_config = ValidationConfig(allow_unknown_elements=True)
    schema_val.validate_function(
        "formatString",
        {"template": "Hello %s", "extraParam": True},
        config=relaxed_config,
    )
