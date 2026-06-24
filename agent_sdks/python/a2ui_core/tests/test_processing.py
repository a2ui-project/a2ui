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

import pytest
from typing import Any, Dict, List, Literal
from pydantic import BaseModel, Field

from a2ui.core.processing import MessageProcessor
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
from a2ui.core.schema.constants import SPEC_VERSION


@pytest.fixture
def mock_catalog():
    class MockCatalog:

        def __init__(self):
            self.version = SPEC_VERSION
            self.catalog_id = "https://a2ui.org/mock.json"
            self.catalog_schema = {"components": {}}
            self.single_refs = set()
            self.list_refs = set()

        def validate_components(self, components):
            pass

        def extract_ref_fields(self):
            return {}

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
        "version": SPEC_VERSION,
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
    delete_msg = {"version": SPEC_VERSION, "deleteSurface": {"surfaceId": "surface_1"}}
    processor.process_messages([delete_msg])
    assert processor.model.get_surface("surface_1") is None


def test_message_processor_component_updates(mock_catalog):
    processor = MessageProcessor(catalogs=[mock_catalog])

    # Setup surface
    processor.process_messages(
        [
            {
                "version": SPEC_VERSION,
                "createSurface": {
                    "surfaceId": "s1",
                    "catalogId": mock_catalog.catalog_id,
                },
            }
        ]
    )
    surface = processor.model.get_surface("s1")
    assert surface is not None

    # 1. Add Component
    comp_msg = {
        "version": SPEC_VERSION,
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
        "version": SPEC_VERSION,
        "updateComponents": {
            "surfaceId": "s1",
            "components": [{"id": "text_1", "component": "Text", "text": "World"}],
        },
    }
    processor.process_messages([comp_update])
    assert comp.properties == {"text": "World"}

    # 3. Recreate if component type changes
    comp_recreate = {
        "version": SPEC_VERSION,
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
    processor.process_messages(
        [
            {
                "version": SPEC_VERSION,
                "createSurface": {
                    "surfaceId": "s1",
                    "catalogId": mock_catalog.catalog_id,
                },
            }
        ]
    )
    surface = processor.model.get_surface("s1")
    assert surface is not None

    # Set data model
    dm_msg = {
        "version": SPEC_VERSION,
        "updateDataModel": {
            "surfaceId": "s1",
            "path": "/user/name",
            "value": "Alice",
        },
    }
    processor.process_messages([dm_msg])
    assert surface.data_model.get("/user/name") == "Alice"


def test_message_processor_capabilities_and_sync(mock_catalog):
    processor = MessageProcessor(catalogs=[mock_catalog])

    # Check Capabilities
    caps = processor.get_client_capabilities()
    assert caps == {
        SPEC_VERSION: {"supportedCatalogIds": ["https://a2ui.org/mock.json"]}
    }

    # Setup surface with sendDataModel=True
    processor.process_messages(
        [
            {
                "version": SPEC_VERSION,
                "createSurface": {
                    "surfaceId": "s1",
                    "catalogId": mock_catalog.catalog_id,
                    "sendDataModel": True,
                },
            },
            {
                "version": SPEC_VERSION,
                "updateDataModel": {"surfaceId": "s1", "path": "/val", "value": 100},
            },
        ]
    )

    # Retrieve client data model sync payload
    client_dm = processor.get_client_data_model()
    assert client_dm == {"version": SPEC_VERSION, "surfaces": {"s1": {"val": 100}}}


def test_message_processor_throws_on_duplicate_surface(mock_catalog):
    processor = MessageProcessor(catalogs=[mock_catalog])
    processor.process_messages(
        [
            {
                "version": SPEC_VERSION,
                "createSurface": {
                    "surfaceId": "s1",
                    "catalogId": mock_catalog.catalog_id,
                },
            }
        ]
    )

    with pytest.raises(ValueError, match="Surface s1 already exists"):
        processor.process_messages(
            [
                {
                    "version": SPEC_VERSION,
                    "createSurface": {
                        "surfaceId": "s1",
                        "catalogId": mock_catalog.catalog_id,
                    },
                }
            ]
        )


def test_message_processor_throws_on_updating_non_existent_surface(mock_catalog):
    processor = MessageProcessor(catalogs=[mock_catalog])
    with pytest.raises(
        ValueError, match="Surface 'unknown-s' not found for components update"
    ):
        processor.process_messages(
            [
                {
                    "version": SPEC_VERSION,
                    "updateComponents": {"surfaceId": "unknown-s", "components": []},
                }
            ]
        )


def test_message_processor_throws_on_multiple_conflicting_update_types(mock_catalog):
    processor = MessageProcessor(catalogs=[mock_catalog])
    with pytest.raises(
        ValueError, match="Message contains multiple conflicting update actions"
    ):
        processor.process_messages(
            [
                {
                    "version": SPEC_VERSION,
                    "createSurface": {
                        "surfaceId": "s1",
                        "catalogId": mock_catalog.catalog_id,
                    },
                    "deleteSurface": {"surfaceId": "s1"},
                }
            ]
        )


def test_message_processor_throws_on_component_missing_id(mock_catalog):
    processor = MessageProcessor(catalogs=[mock_catalog])
    processor.process_messages(
        [
            {
                "version": SPEC_VERSION,
                "createSurface": {
                    "surfaceId": "s1",
                    "catalogId": mock_catalog.catalog_id,
                },
            }
        ]
    )

    with pytest.raises(ValueError, match="missing required 'id' field"):
        processor.process_messages(
            [
                {
                    "version": SPEC_VERSION,
                    "updateComponents": {
                        "surfaceId": "s1",
                        "components": [{"component": "Text", "text": "Missing ID"}],
                    },
                }
            ]
        )


def test_message_processor_throws_on_creating_component_without_type(mock_catalog):
    processor = MessageProcessor(catalogs=[mock_catalog])
    processor.process_messages(
        [
            {
                "version": SPEC_VERSION,
                "createSurface": {
                    "surfaceId": "s1",
                    "catalogId": mock_catalog.catalog_id,
                },
            }
        ]
    )

    with pytest.raises(
        ValueError, match="Cannot create component 'comp_1' without a component type"
    ):
        processor.process_messages(
            [
                {
                    "version": SPEC_VERSION,
                    "updateComponents": {
                        "surfaceId": "s1",
                        "components": [
                            {"id": "comp_1", "label": "Missing Component Name"}
                        ],
                    },
                }
            ]
        )


# ==============================================================================
# Symmetrical Strict Pre-flight & Component Schema Validation Integration Tests
# ==============================================================================


def test_message_processor_strict_mode_circular_reference(real_catalog_09):
    processor = MessageProcessor(catalogs=[real_catalog_09], strict_mode=True)

    processor.process_messages(
        [
            {
                "version": SPEC_VERSION,
                "createSurface": {
                    "surfaceId": "s1",
                    "catalogId": real_catalog_09.catalog_id,
                },
            }
        ]
    )

    # Circular reference loop: root -> comp-A -> comp-B -> comp-A
    with pytest.raises(ValueError, match="Circular reference detected"):
        processor.process_messages(
            [
                {
                    "version": SPEC_VERSION,
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
                }
            ]
        )


def test_message_processor_strict_mode_orphans(real_catalog_09):
    # Using strict integrity checking via validator
    processor = MessageProcessor(catalogs=[real_catalog_09], strict_mode=True)

    # Orphan node: comp-C is unreachable from root
    with pytest.raises(ValueError, match="is not reachable from"):
        processor.process_messages(
            [
                {
                    "version": SPEC_VERSION,
                    "createSurface": {
                        "surfaceId": "s1",
                        "catalogId": real_catalog_09.catalog_id,
                    },
                }
            ]
        )
        processor.process_messages(
            [
                {
                    "version": SPEC_VERSION,
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
                }
            ]
        )


def test_message_processor_strict_mode_component_strict_properties(
    real_catalog_09,
):
    # 1. Without strict_validation: accepts extra fields via passthrough
    lazy_processor = MessageProcessor(catalogs=[real_catalog_09])
    lazy_processor.process_messages(
        [
            {
                "version": SPEC_VERSION,
                "createSurface": {
                    "surfaceId": "s1",
                    "catalogId": real_catalog_09.catalog_id,
                },
            },
            {
                "version": SPEC_VERSION,
                "updateComponents": {
                    "surfaceId": "s1",
                    "components": [
                        {
                            "id": "root",
                            "component": "Text",
                            "text": "Hello",
                            "extraField": "garbage",
                        }
                    ],
                },
            },
        ]
    )
    surface = lazy_processor.model.get_surface("s1")
    assert surface is not None
    lazy_comp = surface.components_model.get("root")
    assert lazy_comp is not None
    assert lazy_comp.properties.get("extraField") == "garbage"


def test_message_processor_strict_mode_missing_root(real_catalog_09):
    strict_processor = MessageProcessor(catalogs=[real_catalog_09], strict_mode=True)

    # Missing root component: components only has comp-A
    with pytest.raises(ValueError, match="Missing root component"):
        strict_processor.process_messages(
            [
                {
                    "version": SPEC_VERSION,
                    "createSurface": {
                        "surfaceId": "s1",
                        "catalogId": real_catalog_09.catalog_id,
                    },
                }
            ]
        )
        strict_processor.process_messages(
            [
                {
                    "version": SPEC_VERSION,
                    "updateComponents": {
                        "surfaceId": "s1",
                        "components": [
                            {
                                "id": "comp-A",
                                "component": "Text",
                                "text": "Missing Root",
                            }
                        ],
                    },
                }
            ]
        )


def test_message_processor_strict_mode_invalid_path_pointer(real_catalog_09):
    strict_processor = MessageProcessor(catalogs=[real_catalog_09], strict_mode=True)

    # Contains unescaped tilde ~ not followed by 0 or 1 in path pointer
    with pytest.raises(ValueError, match="Invalid path syntax"):
        strict_processor.process_messages(
            [
                {
                    "version": SPEC_VERSION,
                    "createSurface": {
                        "surfaceId": "s1",
                        "catalogId": real_catalog_09.catalog_id,
                    },
                }
            ]
        )
        strict_processor.process_messages(
            [
                {
                    "version": SPEC_VERSION,
                    "updateComponents": {
                        "surfaceId": "s1",
                        "components": [
                            {
                                "id": "root",
                                "component": "Text",
                                "text": {"path": "/user/name~2"},
                            }
                        ],
                    },
                }
            ]
        )


def test_message_processor_strict_mode_unrecognized_component_type(
    real_catalog_09,
):
    # 1. Without strict_validation: unknown component type is successfully ingested
    lazy_processor = MessageProcessor(catalogs=[real_catalog_09])
    lazy_processor.process_messages(
        [
            {
                "version": SPEC_VERSION,
                "createSurface": {
                    "surfaceId": "s1",
                    "catalogId": real_catalog_09.catalog_id,
                },
            },
            {
                "version": SPEC_VERSION,
                "updateComponents": {
                    "surfaceId": "s1",
                    "components": [
                        {"id": "root", "component": "UnknownComp", "val": "garbage"}
                    ],
                },
            },
        ]
    )
    surface = lazy_processor.model.get_surface("s1")
    assert surface is not None
    lazy_comp = surface.components_model.get("root")
    assert lazy_comp is not None
    assert lazy_comp.type == "UnknownComp"
    assert lazy_comp.properties.get("val") == "garbage"


def test_message_processor_xor_conflict_coverage():
    catalog = BasicCatalog()

    processor = MessageProcessor(catalogs=[catalog])

    conflicting_payload = [
        {
            "version": SPEC_VERSION,
            "createSurface": {"surfaceId": "s1", "catalogId": catalog.catalog_id},
            "deleteSurface": {"surfaceId": "s1"},
        }
    ]
    with pytest.raises(
        ValueError, match="Message contains multiple conflicting update actions"
    ):
        processor.process_messages(conflicting_payload)


def test_message_processor_missing_data_model_path_reactive_binding(mock_catalog):
    processor = MessageProcessor(catalogs=[mock_catalog])

    processor.process_messages(
        [
            {
                "version": SPEC_VERSION,
                "createSurface": {
                    "surfaceId": "s1",
                    "catalogId": mock_catalog.catalog_id,
                },
            },
            {
                "version": SPEC_VERSION,
                "updateComponents": {
                    "surfaceId": "s1",
                    "components": [
                        {
                            "id": "root",
                            "component": "Text",
                            "text": {"path": "/missing/username"},
                        }
                    ],
                },
            },
        ]
    )

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

    processor.process_messages(
        [
            {
                "version": SPEC_VERSION,
                "updateDataModel": {
                    "surfaceId": "s1",
                    "path": "/missing/username",
                    "value": "Alice",
                },
            }
        ]
    )

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
                spec_version=SPEC_VERSION,
                components=[ModelComponentApi(ChartComponent, "Chart")],
                functions=[],
            )

    catalog = CustomCatalog()
    processor = MessageProcessor(catalogs=[catalog], strict_mode=True)

    processor.process_messages(
        [
            {
                "version": SPEC_VERSION,
                "createSurface": {"surfaceId": "s1", "catalogId": catalog.catalog_id},
            }
        ]
    )

    processor.process_messages(
        [
            {
                "version": SPEC_VERSION,
                "updateComponents": {
                    "surfaceId": "s1",
                    "components": [
                        {
                            "id": "root",
                            "component": "Chart",
                            "title": "Sales",
                            "value": 45.6,
                        }
                    ],
                },
            }
        ]
    )

    surface = processor.model.get_surface("s1")
    assert surface is not None
    chart_comp = surface.components_model.get("root")
    assert chart_comp is not None
    assert chart_comp.properties.get("title") == "Sales"
    assert chart_comp.properties.get("value") == 45.6

    with pytest.raises(
        ValueError,
        match=r"Components validation failed for surface 's1': \[value\] Field required",
    ):
        processor.process_messages(
            [
                {
                    "version": SPEC_VERSION,
                    "updateComponents": {
                        "surfaceId": "s1",
                        "components": [
                            {"id": "root", "component": "Chart", "title": "Sales"}
                        ],
                    },
                }
            ]
        )


def test_message_processor_empty_catalogs_throws():
    with pytest.raises(ValueError, match="At least one catalog must be provided"):
        MessageProcessor(catalogs=[])


def test_message_processor_theme_validation(real_catalog_09):
    processor = MessageProcessor(catalogs=[real_catalog_09], strict_mode=True)
    with pytest.raises(
        ValueError,
        match="Validation failed for theme on surface 's1'|String should match pattern",
    ):
        processor.process_messages(
            [
                {
                    "version": SPEC_VERSION,
                    "createSurface": {
                        "surfaceId": "s1",
                        "catalogId": real_catalog_09.catalog_id,
                        "theme": {"primaryColor": "invalid-color-name"},
                    },
                }
            ]
        )


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

    catalog = Catalog.from_json(catalog_json, spec_version=SPEC_VERSION)
    processor = MessageProcessor(catalogs=[catalog], strict_mode=True)

    # 2. Process surface creation
    processor.process_messages(
        [
            {
                "version": SPEC_VERSION,
                "createSurface": {"surfaceId": "s1", "catalogId": catalog.catalog_id},
            }
        ]
    )

    # 3. Validate correct component ingestion
    processor.process_messages(
        [
            {
                "version": SPEC_VERSION,
                "updateComponents": {
                    "surfaceId": "s1",
                    "components": [
                        {
                            "id": "root",
                            "component": "Chart",
                            "title": "Income",
                            "value": 100.5,
                        }
                    ],
                },
            }
        ]
    )
    surface = processor.model.get_surface("s1")
    assert surface is not None
    comp = surface.components_model.get("root")
    assert comp is not None
    assert comp.properties["title"] == "Income"
    assert comp.properties["value"] == 100.5

    # 4. Assert strict JSON Schema validation catches invalid types!
    with pytest.raises(ValueError, match="is not of type 'number'"):
        processor.process_messages(
            [
                {
                    "version": SPEC_VERSION,
                    "updateComponents": {
                        "surfaceId": "s1",
                        "components": [
                            {
                                "id": "root",
                                "component": "Chart",
                                "title": "Income",
                                "value": "string-invalid",
                            }
                        ],
                    },
                }
            ]
        )

    # 5. Assert strict JSON Schema validation catches unrecognized component properties!
    with pytest.raises(ValueError, match="Additional properties are not allowed"):
        processor.process_messages(
            [
                {
                    "version": SPEC_VERSION,
                    "updateComponents": {
                        "surfaceId": "s1",
                        "components": [
                            {
                                "id": "root",
                                "component": "Chart",
                                "title": "Income",
                                "value": 100.5,
                                "garbage_prop": True,
                            }
                        ],
                    },
                }
            ]
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

    catalog = Catalog.from_json(catalog_json, spec_version=SPEC_VERSION)
    processor = MessageProcessor(catalogs=[catalog], strict_mode=True)

    # Dynamic JSON Theme validation fails on incorrect color hex code pattern
    with pytest.raises(
        ValueError, match="Validation failed for theme on surface 's1'|does not match"
    ):
        processor.process_messages(
            [
                {
                    "version": SPEC_VERSION,
                    "createSurface": {
                        "surfaceId": "s1",
                        "catalogId": catalog.catalog_id,
                        "theme": {"primaryColor": "red"},  # Must match hex color regex!
                    },
                }
            ]
        )
