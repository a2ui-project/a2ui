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

"""Unit tests for A2uiGenerator and A2uiRequestProcessor."""

from __future__ import annotations

import pytest

from a2ui.catalog_transformers import ComponentPruningTransformer
from a2ui.core import A2uiCatalogError, A2uiValidationError, Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats import to_message_models
from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
from a2ui.inference_formats.express import ExpressFormatFactory
from a2ui.parser import A2uiPart, TextPart
from a2ui.processor import A2uiGenerator, A2uiRequestProcessor, CatalogConfig


def test_request_processor_rejects_empty_catalogs():
    with pytest.raises(A2uiCatalogError, match="At least one active catalog"):
        A2uiRequestProcessor(catalogs=[])


def test_generator_rejects_none_capabilities():
    generator = A2uiGenerator(catalogs=[CatalogConfig(BasicCatalog("v1.0"))])
    with pytest.raises(A2uiCatalogError, match="Renderer capabilities are required"):
        generator.create_processor(None)  # type: ignore[arg-type]


def test_generator_and_processor_end_to_end():
    basic = BasicCatalog("v1.0")
    custom = Catalog.from_json(
        {
            "catalogId": "https://a2ui.org/catalogs/custom",
            "components": {
                "Badge": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "component": {"const": "Badge"},
                        "label": {"type": "string"},
                    },
                    "required": ["id", "component", "label"],
                }
            },
        },
        protocol_version="v1.0",
        catalog_id="https://a2ui.org/catalogs/custom",
    )

    example_turn = to_message_models([
        {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": basic.catalog_id,
            },
        },
        {
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{"id": "root", "component": "Text", "text": "Example"}],
            },
        },
    ])

    generator = A2uiGenerator(
        catalogs=[
            CatalogConfig(
                basic,
                transformers=[ComponentPruningTransformer(["Text", "Column"])],
            ),
            CatalogConfig(custom),
        ],
        examples=[example_turn],
        inference_format_factory=DirectJsonFormatFactory(),
    )

    capabilities = {
        "v1.0": {
            "supportedCatalogIds": [
                "https://a2ui.org/catalogs/custom",
                basic.catalog_id,
            ]
        }
    }
    processor = generator.create_processor(capabilities)
    assert [c.catalog_id for c in processor.active_catalogs] == [
        "https://a2ui.org/catalogs/custom",
        basic.catalog_id,
    ]
    assert processor.examples == [example_turn]
    assert "Badge" in processor.prompt_snippet
    assert "Text" in processor.prompt_snippet
    assert "Button" not in processor.prompt_snippet

    parts = processor.parse_response(
        'Hello!\n<a2ui-json>[{"version": "v1.0", "createSurface": {"surfaceId": "main",'
        ' "catalogId": "https://a2ui.org/catalogs/custom"}}, {"version": "v1.0",'
        ' "updateComponents": {"surfaceId": "main", "components": [{"id": "root",'
        ' "component": "Badge", "label": "VIP"}]}}]</a2ui-json>'
    )
    assert len(parts) == 2
    assert isinstance(parts[0], TextPart)
    assert parts[0].text == "Hello!"
    assert isinstance(parts[1], A2uiPart)
    assert len(parts[1].a2ui) == 2

    # Format override with ExpressFormatFactory
    express_processor = generator.create_processor(
        capabilities,
        inference_format_factory=ExpressFormatFactory(),
    )
    assert "<a2ui>" in express_processor.prompt_snippet
    express_parts = express_processor.parse_response(
        '<a2ui>\nsurface("main")\nroot = Badge("VIP")\n</a2ui>'
    )
    assert len(express_parts) == 1
    assert isinstance(express_parts[0], A2uiPart)


def test_processor_validates_examples_against_active_catalogs():
    basic = BasicCatalog("v1.0")
    pruned = ComponentPruningTransformer(["Column"]).transform(basic)
    bad_example = to_message_models([
        {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": basic.catalog_id,
            },
        },
        {
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "s1",
                "components": [
                    {"id": "root", "component": "Text", "text": "Not allowed"}
                ],
            },
        },
    ])
    with pytest.raises(A2uiValidationError):
        A2uiRequestProcessor(catalogs=[pruned], examples=[bad_example])
