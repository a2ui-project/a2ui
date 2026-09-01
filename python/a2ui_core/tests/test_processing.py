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
from typing import Any, Literal
from pydantic import BaseModel, Field

from a2ui.core.processing import MessageProcessor
from a2ui.core.validation import STRICT_VALIDATION, ValidationConfig
from a2ui.core.rendering import (
    DataContext,
    ComponentContext,
    GenericBinder,
    MissingDataBindingWarning,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.catalog import (
    Catalog,
    ComponentApi,
    ModelComponentApi,
)
from a2ui.core.schema.v0_9.constants import PROTOCOL_VERSION


@pytest.fixture
def mock_catalog():
    class MockCatalog:

        def __init__(self):
            self.version = PROTOCOL_VERSION
            self.catalog_id = "https://a2ui.org/mock.json"
            self.catalog_schema = {"components": {}}
            self.single_refs = set()
            self.list_refs = set()

        def validate_components(self, components):
            pass

        def validate_theme(self, theme):
            pass

    return MockCatalog()


@pytest.fixture
def real_catalog_09():
    return BasicCatalog()


def test_message_processor_surface_lifecycle(mock_catalog):
    processor = MessageProcessor(catalogs=[mock_catalog])

    # 1. Create surface
    create_msg = {
        "version": PROTOCOL_VERSION,
        "createSurface": {
            "surfaceId": "surface_1",
            "catalogId": mock_catalog.catalog_id,
            "theme": {"primaryColor": "red"},
            "sendDataModel": True,
        },
    }
    processor.process_messages([create_msg])

    surface = processor.model.get_surface("surface_1")
    assert surface is not None
    assert surface.id == "surface_1"
    assert surface.theme == {"primaryColor": "red"}
    assert surface.send_data_model is True

    # 2. Delete surface
    delete_msg = {
        "version": PROTOCOL_VERSION,
        "deleteSurface": {"surfaceId": "surface_1"},
    }
    processor.process_messages([delete_msg])
    assert processor.model.get_surface("surface_1") is None


def test_message_processor_component_updates(mock_catalog):
    processor = MessageProcessor(catalogs=[mock_catalog])

    # Setup surface
    processor.process_messages([{
        "version": PROTOCOL_VERSION,
        "createSurface": {
            "surfaceId": "s1",
            "catalogId": mock_catalog.catalog_id,
        },
    }])
    surface = processor.model.get_surface("s1")
    assert surface is not None

    # 1. Add Component
    comp_msg = {
        "version": PROTOCOL_VERSION,
        "updateComponents": {
            "surfaceId": "s1",
            "components": [{"id": "text_1", "component": "Text", "text": "Hello"}],
        },
    }
    processor.process_messages([comp_msg])

    comp = surface.components_model.get("text_1")
    assert comp is not None
    assert comp.type == "Text"
    assert comp.properties == {"text": "Hello"}

    # 2. Update properties
    comp_update = {
        "version": PROTOCOL_VERSION,
        "updateComponents": {
            "surfaceId": "s1",
            "components": [{"id": "text_1", "component": "Text", "text": "World"}],
        },
    }
    processor.process_messages([comp_update])
    assert comp.properties == {"text": "World"}

    # 3. Recreate if component type changes
    comp_recreate = {
        "version": PROTOCOL_VERSION,
        "updateComponents": {
            "surfaceId": "s1",
            "components": [{"id": "text_1", "component": "Image", "url": "img.png"}],
        },
    }
    processor.process_messages([comp_recreate])
    new_comp = surface.components_model.get("text_1")
    assert new_comp is not None
    assert new_comp.type == "Image"
    assert new_comp.properties == {"url": "img.png"}


def test_message_processor_data_model_updates(mock_catalog):
    processor = MessageProcessor(catalogs=[mock_catalog])

    # Setup surface
    processor.process_messages([{
        "version": PROTOCOL_VERSION,
        "createSurface": {
            "surfaceId": "s1",
            "catalogId": mock_catalog.catalog_id,
        },
    }])
    surface = processor.model.get_surface("s1")
    assert surface is not None

    # Set data model
    dm_msg = {
        "version": PROTOCOL_VERSION,
        "updateDataModel": {
            "surfaceId": "s1",
            "path": "/user/name",
            "value": "Alice",
        },
    }
    processor.process_messages([dm_msg])
    assert surface.data_model.get("/user/name") == "Alice"


def test_message_processor_get_renderer_capabilities_list_of_versions(
    mock_catalog,
):
    from a2ui.core.schema import ProtocolVersion

    processor = MessageProcessor(catalogs=[mock_catalog])
    caps = processor.get_renderer_capabilities(
        versions=[ProtocolVersion.V0_8, ProtocolVersion.V0_9, ProtocolVersion.V1_0]
    )
    assert caps == {
        "v0.8": {"supportedCatalogIds": ["https://a2ui.org/mock.json"]},
        "v0.9": {"supportedCatalogIds": ["https://a2ui.org/mock.json"]},
        "v1.0": {"supportedCatalogIds": ["https://a2ui.org/mock.json"]},
    }


def test_message_processor_capabilities_and_sync(mock_catalog):
    from a2ui.core.schema import ProtocolVersion

    processor = MessageProcessor(catalogs=[mock_catalog])

    # Check Capabilities
    caps = processor.get_renderer_capabilities(versions=[ProtocolVersion.V0_9])
    assert caps == {
        PROTOCOL_VERSION: {"supportedCatalogIds": ["https://a2ui.org/mock.json"]}
    }

    # Setup surface with sendDataModel=True
    processor.process_messages([
        {
            "version": PROTOCOL_VERSION,
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": mock_catalog.catalog_id,
                "sendDataModel": True,
            },
        },
        {
            "version": PROTOCOL_VERSION,
            "updateDataModel": {"surfaceId": "s1", "path": "/val", "value": 100},
        },
    ])

    # Retrieve client data model sync payload
    client_dm = processor.get_renderer_data_model()
    assert client_dm == {"version": PROTOCOL_VERSION, "surfaces": {"s1": {"val": 100}}}


def test_message_processor_throws_on_duplicate_surface(mock_catalog):
    processor = MessageProcessor(catalogs=[mock_catalog])
    processor.process_messages([{
        "version": PROTOCOL_VERSION,
        "createSurface": {
            "surfaceId": "s1",
            "catalogId": mock_catalog.catalog_id,
        },
    }])

    with pytest.raises(ValueError, match="Surface s1 already exists"):
        processor.process_messages([{
            "version": PROTOCOL_VERSION,
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": mock_catalog.catalog_id,
            },
        }])


def test_message_processor_throws_on_updating_non_existent_surface(mock_catalog):
    processor = MessageProcessor(catalogs=[mock_catalog])
    with pytest.raises(
        ValueError, match="Surface unknown-s not found for components update"
    ):
        processor.process_messages([{
            "version": PROTOCOL_VERSION,
            "updateComponents": {"surfaceId": "unknown-s", "components": []},
        }])


def test_message_processor_throws_on_multiple_conflicting_update_types(mock_catalog):
    processor = MessageProcessor(catalogs=[mock_catalog])
    with pytest.raises(
        ValueError, match="Message contains multiple conflicting update actions"
    ):
        processor.process_messages([{
            "version": PROTOCOL_VERSION,
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": mock_catalog.catalog_id,
            },
            "deleteSurface": {"surfaceId": "s1"},
        }])


def test_message_processor_throws_on_component_missing_id(mock_catalog):
    processor = MessageProcessor(catalogs=[mock_catalog])
    processor.process_messages([{
        "version": PROTOCOL_VERSION,
        "createSurface": {
            "surfaceId": "s1",
            "catalogId": mock_catalog.catalog_id,
        },
    }])

    with pytest.raises(ValueError, match="missing required 'id' field"):
        processor.process_messages([{
            "version": PROTOCOL_VERSION,
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{"component": "Text", "text": "Missing ID"}],
            },
        }])


def test_message_processor_throws_on_creating_component_without_type(mock_catalog):
    processor = MessageProcessor(catalogs=[mock_catalog])
    processor.process_messages([{
        "version": PROTOCOL_VERSION,
        "createSurface": {
            "surfaceId": "s1",
            "catalogId": mock_catalog.catalog_id,
        },
    }])

    with pytest.raises(
        ValueError, match="Cannot create component comp_1 without a type"
    ):
        processor.process_messages([{
            "version": PROTOCOL_VERSION,
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{"id": "comp_1", "label": "Missing Component Name"}],
            },
        }])


# ==============================================================================
# Symmetrical Strict Pre-flight & Component Schema Validation Integration Tests
# ==============================================================================


def test_message_processor_strict_mode_circular_reference(real_catalog_09):
    processor = MessageProcessor(
        catalogs=[real_catalog_09], validation_config=STRICT_VALIDATION
    )

    processor.process_messages([{
        "version": PROTOCOL_VERSION,
        "createSurface": {
            "surfaceId": "s1",
            "catalogId": real_catalog_09.catalog_id,
        },
    }])

    # Circular reference loop: root -> comp-A -> comp-B -> comp-A
    with pytest.raises(ValueError, match="Circular reference detected"):
        processor.process_messages([{
            "version": PROTOCOL_VERSION,
            "updateComponents": {
                "surfaceId": "s1",
                "components": [
                    {
                        "id": "root",
                        "component": "Column",
                        "children": ["comp-A"],
                    },
                    {"id": "comp-A", "component": "Card", "child": "comp-B"},
                    {"id": "comp-B", "component": "Card", "child": "comp-A"},
                ],
            },
        }])


def test_message_processor_strict_mode_orphans(real_catalog_09):
    # Using strict integrity checking via validator
    processor = MessageProcessor(
        catalogs=[real_catalog_09], validation_config=STRICT_VALIDATION
    )

    # Orphan node: comp-C is unreachable from root
    with pytest.raises(ValueError, match="is not reachable from"):
        processor.process_messages([{
            "version": PROTOCOL_VERSION,
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": real_catalog_09.catalog_id,
            },
        }])
        processor.process_messages([{
            "version": PROTOCOL_VERSION,
            "updateComponents": {
                "surfaceId": "s1",
                "components": [
                    {
                        "id": "root",
                        "component": "Column",
                        "children": ["comp-B"],
                    },
                    {"id": "comp-B", "component": "Text", "text": "Hello"},
                    {
                        "id": "comp-C",
                        "component": "Text",
                        "text": "Unreachable",
                    },
                ],
            },
        }])


def test_message_processor_strict_mode_component_strict_properties(
    real_catalog_09,
):
    # 1. Without strict_validation: accepts extra fields via passthrough
    lazy_processor = MessageProcessor(catalogs=[real_catalog_09])
    lazy_processor.process_messages([
        {
            "version": PROTOCOL_VERSION,
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": real_catalog_09.catalog_id,
            },
        },
        {
            "version": PROTOCOL_VERSION,
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{
                    "id": "root",
                    "component": "Text",
                    "text": "Hello",
                    "extraField": "garbage",
                }],
            },
        },
    ])
    surface = lazy_processor.model.get_surface("s1")
    assert surface is not None
    lazy_comp = surface.components_model.get("root")
    assert lazy_comp is not None
    assert lazy_comp.properties.get("extraField") == "garbage"


def test_message_processor_strict_mode_missing_root(real_catalog_09):
    strict_processor = MessageProcessor(
        catalogs=[real_catalog_09], validation_config=STRICT_VALIDATION
    )

    # Missing root component: components only has comp-A
    with pytest.raises(ValueError, match="Missing root component"):
        strict_processor.process_messages([{
            "version": PROTOCOL_VERSION,
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": real_catalog_09.catalog_id,
            },
        }])
        strict_processor.process_messages([{
            "version": PROTOCOL_VERSION,
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{
                    "id": "comp-A",
                    "component": "Text",
                    "text": "Missing Root",
                }],
            },
        }])


def test_message_processor_strict_mode_invalid_path_pointer(real_catalog_09):
    strict_processor = MessageProcessor(
        catalogs=[real_catalog_09], validation_config=STRICT_VALIDATION
    )

    # Contains unescaped tilde ~ not followed by 0 or 1 in path pointer
    with pytest.raises(ValueError, match="Invalid path syntax"):
        strict_processor.process_messages([{
            "version": PROTOCOL_VERSION,
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": real_catalog_09.catalog_id,
            },
        }])
        strict_processor.process_messages([{
            "version": PROTOCOL_VERSION,
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{
                    "id": "root",
                    "component": "Text",
                    "text": {"path": "/user/name~2"},
                }],
            },
        }])


def test_message_processor_strict_mode_unrecognized_component_type(
    real_catalog_09,
):
    # 1. Without strict_validation: unknown component type is successfully ingested
    lazy_processor = MessageProcessor(catalogs=[real_catalog_09])
    lazy_processor.process_messages([
        {
            "version": PROTOCOL_VERSION,
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": real_catalog_09.catalog_id,
            },
        },
        {
            "version": PROTOCOL_VERSION,
            "updateComponents": {
                "surfaceId": "s1",
                "components": [
                    {"id": "root", "component": "UnknownComp", "val": "garbage"}
                ],
            },
        },
    ])
    surface = lazy_processor.model.get_surface("s1")
    assert surface is not None
    lazy_comp = surface.components_model.get("root")
    assert lazy_comp is not None
    assert lazy_comp.type == "UnknownComp"
    assert lazy_comp.properties.get("val") == "garbage"


def test_message_processor_xor_conflict_coverage():
    catalog = BasicCatalog()

    processor = MessageProcessor(catalogs=[catalog])

    conflicting_payload = [{
        "version": PROTOCOL_VERSION,
        "createSurface": {"surfaceId": "s1", "catalogId": catalog.catalog_id},
        "deleteSurface": {"surfaceId": "s1"},
    }]
    with pytest.raises(
        ValueError, match="Message contains multiple conflicting update actions"
    ):
        processor.process_messages(conflicting_payload)


def test_message_processor_missing_data_model_path_reactive_binding(mock_catalog):
    processor = MessageProcessor(catalogs=[mock_catalog])

    processor.process_messages([
        {
            "version": PROTOCOL_VERSION,
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": mock_catalog.catalog_id,
            },
        },
        {
            "version": PROTOCOL_VERSION,
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{
                    "id": "root",
                    "component": "Text",
                    "text": {"path": "/missing/username"},
                }],
            },
        },
    ])

    surface = processor.model.get_surface("s1")
    assert surface is not None
    text_comp = surface.components_model.get("root")
    assert text_comp is not None

    ctx = DataContext(surface, path="/")
    context = ComponentContext(text_comp, ctx)

    with pytest.warns(MissingDataBindingWarning):
        binder = GenericBinder(context)
        text_val = binder.current_props.get("text")
        assert text_val is None

    processor.process_messages([{
        "version": PROTOCOL_VERSION,
        "updateDataModel": {
            "surfaceId": "s1",
            "path": "/missing/username",
            "value": "Alice",
        },
    }])

    assert binder.current_props.get("text") == "Alice"
    binder.dispose()


def test_message_processor_custom_catalog_component_validation():
    class ChartComponent(BaseModel):
        id: str
        component: Literal["Chart"] = "Chart"
        title: str = Field(..., description="Chart title.")
        value: float = Field(..., description="Chart numeric value.")

    class CustomCatalog(Catalog):

        def __init__(self):
            super().__init__(
                catalog_id="https://rizzcharts.com/catalog.json",
                protocol_version=PROTOCOL_VERSION,
                components=[ModelComponentApi(ChartComponent, "Chart")],
                functions=[],
            )

    catalog = CustomCatalog()
    processor = MessageProcessor(
        catalogs=[catalog], validation_config=STRICT_VALIDATION
    )

    processor.process_messages([{
        "version": PROTOCOL_VERSION,
        "createSurface": {"surfaceId": "s1", "catalogId": catalog.catalog_id},
    }])

    processor.process_messages([{
        "version": PROTOCOL_VERSION,
        "updateComponents": {
            "surfaceId": "s1",
            "components": [{
                "id": "root",
                "component": "Chart",
                "title": "Sales",
                "value": 45.6,
            }],
        },
    }])

    surface = processor.model.get_surface("s1")
    assert surface is not None
    chart_comp = surface.components_model.get("root")
    assert chart_comp is not None
    assert chart_comp.properties.get("title") == "Sales"
    assert chart_comp.properties.get("value") == 45.6

    with pytest.raises(
        ValueError,
        match=(
            r"Validation failed for component 'Chart': (?:\[value\] Field"
            r" required|components.root: 'value' is a required property)"
        ),
    ):
        processor.process_messages([{
            "version": PROTOCOL_VERSION,
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{"id": "root", "component": "Chart", "title": "Sales"}],
            },
        }])


def test_message_processor_component_catalog_override():
    cat_a = Catalog.from_json({
        "catalogId": "cat-a",
        "protocolVersion": "v1.0",
        "components": {
            "CompA": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "child": {"type": "string"},
                },
                "required": ["text"],
            }
        },
    })
    cat_b = Catalog.from_json({
        "catalogId": "cat-b",
        "protocolVersion": "v1.0",
        "components": {
            "CompB": {
                "type": "object",
                "properties": {
                    "count": {"type": "integer"},
                },
                "required": ["count"],
            }
        },
    })

    processor = MessageProcessor(
        catalogs=[cat_a, cat_b], validation_config=STRICT_VALIDATION
    )

    processor.process_messages([
        {
            "version": "v1.0",
            "createSurface": {"surfaceId": "s1", "catalogId": "cat-a"},
        },
        {
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "s1",
                "components": [
                    {
                        "id": "root",
                        "component": "CompA",
                        "text": "hello",
                        "child": "c2",
                    },
                    {
                        "id": "c2",
                        "component": "CompB",
                        "catalogId": "cat-b",
                        "count": 42,
                    },
                ],
            },
        },
    ])

    surface = processor.model.get_surface("s1")
    assert surface is not None
    assert surface.components_model.get("root").catalog is cat_a
    assert surface.components_model.get("c2").catalog is cat_b

    # Update c2 with explicit catalogId -> resolves to cat_b
    processor.process_messages([{
        "version": "v1.0",
        "updateComponents": {
            "surfaceId": "s1",
            "components": [{"id": "c2", "catalogId": "cat-b", "count": 99}],
        },
    }])
    assert surface.components_model.get("c2").catalog is cat_b
    assert surface.components_model.get("c2").properties["count"] == 99

    # Update c2 without catalogId -> defaults back to surface.default_catalog (cat_a)
    processor.process_messages([{
        "version": "v1.0",
        "updateComponents": {
            "surfaceId": "s1",
            "components": [
                {"id": "c2", "component": "CompA", "text": "updated", "count": 100}
            ],
        },
    }])
    assert surface.components_model.get("c2").catalog is cat_a


def test_message_processor_atomic_state_rollback_on_error():
    from a2ui.core.exceptions import A2uiValidationError

    cat = Catalog.from_json({
        "catalogId": "cat-test",
        "protocolVersion": "v1.0",
        "components": {
            "Comp": {
                "type": "object",
                "properties": {
                    "val": {"type": "string"},
                },
                "required": ["val"],
            }
        },
    })

    processor = MessageProcessor(catalogs=[cat], validation_config=STRICT_VALIDATION)

    processor.process_messages([
        {
            "version": "v1.0",
            "createSurface": {"surfaceId": "s1", "catalogId": "cat-test"},
        },
        {
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{"id": "root", "component": "Comp", "val": "initial"}],
            },
        },
    ])

    surface = processor.model.get_surface("s1")
    assert surface is not None
    assert surface.components_model.get("root").properties["val"] == "initial"

    # Attempt invalid update on root (missing required 'val')
    with pytest.raises(A2uiValidationError):
        processor.process_messages([{
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{"id": "root", "component": "Comp"}],
            },
        }])

    # Assert surface state remains unchanged
    assert surface.components_model.get("root").properties["val"] == "initial"


def test_message_processor_empty_catalogs_throws():
    with pytest.raises(ValueError, match="At least one catalog must be provided"):
        MessageProcessor(catalogs=[])


@pytest.mark.skip(
    reason="TODO: validation package is only about component schema validation"
)
def test_message_processor_theme_validation(real_catalog_09):
    processor = MessageProcessor(
        catalogs=[real_catalog_09], validation_config=STRICT_VALIDATION
    )
    with pytest.raises(
        ValueError,
        match="Validation failed for theme on surface 's1'|String should match pattern",
    ):
        processor.process_messages([{
            "version": PROTOCOL_VERSION,
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": real_catalog_09.catalog_id,
                "theme": {"primaryColor": "invalid-color-name"},
            },
        }])


def test_message_processor_json_catalog_validation():
    # 1. Define a raw JSON catalog schema (Inference style)
    catalog_json = {
        "catalogId": "https://rizzcharts.com/catalog.json",
        "components": {
            "Chart": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "value": {"type": "number"},
                },
                "required": ["title", "value"],
                "additionalProperties": False,
            }
        },
    }

    catalog = Catalog.from_json(catalog_json, protocol_version=PROTOCOL_VERSION)
    processor = MessageProcessor(
        catalogs=[catalog], validation_config=STRICT_VALIDATION
    )

    # 2. Process surface creation
    processor.process_messages([{
        "version": PROTOCOL_VERSION,
        "createSurface": {"surfaceId": "s1", "catalogId": catalog.catalog_id},
    }])

    # 3. Validate correct component ingestion
    processor.process_messages([{
        "version": PROTOCOL_VERSION,
        "updateComponents": {
            "surfaceId": "s1",
            "components": [{
                "id": "root",
                "component": "Chart",
                "title": "Income",
                "value": 100.5,
            }],
        },
    }])
    surface = processor.model.get_surface("s1")
    assert surface is not None
    comp = surface.components_model.get("root")
    assert comp is not None
    assert comp.properties["title"] == "Income"
    assert comp.properties["value"] == 100.5

    # 4. Assert strict JSON Schema validation catches invalid types!
    with pytest.raises(ValueError, match="is not of type 'number'"):
        processor.process_messages([{
            "version": PROTOCOL_VERSION,
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{
                    "id": "root",
                    "component": "Chart",
                    "title": "Income",
                    "value": "string-invalid",
                }],
            },
        }])

    # 5. Assert strict JSON Schema validation catches unrecognized component properties!
    with pytest.raises(ValueError, match="Additional properties are not allowed"):
        processor.process_messages([{
            "version": PROTOCOL_VERSION,
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{
                    "id": "root",
                    "component": "Chart",
                    "title": "Income",
                    "value": 100.5,
                    "garbage_prop": True,
                }],
            },
        }])


@pytest.mark.skip(
    reason="TODO: validation package is only about component schema validation"
)
def test_message_processor_json_catalog_theme_validation():
    # Define JSON catalog schema containing theme and functions specs
    catalog_json = {
        "catalogId": "https://rizzcharts.com/catalog.json",
        "theme": {
            "type": "object",
            "properties": {
                "primaryColor": {"type": "string", "pattern": "^#[0-9a-fA-F]{6}$"}
            },
            "additionalProperties": False,
        },
        "functions": {
            "regex": {
                "type": "object",
                "properties": {
                    "call": {"const": "regex"},
                    "args": {
                        "type": "object",
                        "properties": {
                            "value": {"type": "string"},
                            "pattern": {"type": "string"},
                        },
                        "required": ["value", "pattern"],
                        "additionalProperties": False,
                    },
                },
                "required": ["call", "args"],
            }
        },
    }

    catalog = Catalog.from_json(catalog_json, protocol_version=PROTOCOL_VERSION)
    processor = MessageProcessor(
        catalogs=[catalog], validation_config=STRICT_VALIDATION
    )

    # Dynamic JSON Theme validation fails on incorrect color hex code pattern
    with pytest.raises(
        ValueError, match="Validation failed for theme on surface 's1'|does not match"
    ):
        processor.process_messages([{
            "version": PROTOCOL_VERSION,
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": catalog.catalog_id,
                "theme": {"primaryColor": "red"},  # Must match hex color regex!
            },
        }])


def test_strict_mode_validates_single_message_dict(real_catalog_09):
    processor = MessageProcessor(
        catalogs=[real_catalog_09], validation_config=STRICT_VALIDATION
    )

    # Single message dict without 'messages' key must still be validated in strict_mode
    invalid_single_msg = {
        "version": "v0.9",
        "createSurface": {
            "surfaceId": "s_invalid",
            "catalogId": real_catalog_09.catalog_id,
            "theme": {"primaryColor": "invalid_color"},
        },
    }

    with pytest.raises(
        ValueError,
        match=(
            "Validation failed for theme on surface 's_invalid'|String should match"
            " pattern"
        ),
    ):
        processor.process_messages(invalid_single_msg)


def test_message_processor_pydantic_model_payload(mock_catalog):
    from a2ui.core.schema.v0_9.server_to_client import (
        CreateSurfaceMessage,
        CreateSurface,
    )

    processor = MessageProcessor(catalogs=[mock_catalog])
    msg = CreateSurfaceMessage(
        create_surface=CreateSurface(
            surface_id="surface_pydantic",
            catalog_id=mock_catalog.catalog_id,
            send_data_model=True,
        )
    )
    processor.process_messages(msg)
    surface = processor.model.get_surface("surface_pydantic")
    assert surface is not None
    assert surface.id == "surface_pydantic"
    assert surface.send_data_model is True


def test_version_adapter_factory_unsupported_version_raises_validation_error():
    from a2ui.core.processing.adapters import VersionAdapterFactory
    from a2ui.core.exceptions import A2uiValidationError

    # Unparseable/unsupported version string in payload must raise A2uiValidationError
    with pytest.raises(
        A2uiValidationError, match="Unsupported protocol version 'v9999.0'"
    ):
        VersionAdapterFactory.resolve_from_payload(
            [{"version": "v9999.0", "createSurface": {}}]
        )

    with pytest.raises(
        A2uiValidationError, match="Unsupported protocol version 'invalid_ver'"
    ):
        VersionAdapterFactory.resolve_from_payload({"version": "invalid_ver"})


def test_message_processor_v0_9_1_version_payload(mock_catalog):
    processor = MessageProcessor(
        catalogs=[mock_catalog], validation_config=STRICT_VALIDATION
    )
    messages = [{
        "version": "v0.9.1",
        "createSurface": {
            "surfaceId": "s_v091",
            "catalogId": mock_catalog.catalog_id,
        },
    }]
    processor.process_messages(messages)
    surface = processor.model.get_surface("s_v091")
    assert surface is not None
    assert surface.id == "s_v091"
