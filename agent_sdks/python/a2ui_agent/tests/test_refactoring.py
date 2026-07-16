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

"""Unit tests verifying API refactoring, capabilities, and streaming checks."""

import pytest
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import VERSION_0_9
from a2ui.inference_formats.transport import TransportFormat
from a2ui.inference_formats.experimental.express import ExpressFormat, ExpressParser
from a2ui.inference_formats.experimental.elemental import ElementalFormat, ElementalParser


@pytest.fixture
def sample_catalog():
    return A2uiCatalog(
        version=VERSION_0_9,
        name="test_catalog",
        s2c_schema={},
        common_types_schema={},
        catalog_schema={
            "catalogId": "https://a2ui.org/test_catalog",
            "components": {
                "Text": {
                    "properties": {
                        "text": {"type": "string", "positionalIndex": 0}
                    }
                }
            },
            "functions": {
                "openUrl": {
                    "properties": {
                        "url": {"type": "string", "positionalIndex": 0}
                    }
                }
            },
        },
    )


def test_supports_streaming_property(sample_catalog):
    from a2ui.schema.catalog import CatalogConfig
    from a2ui.schema.catalog_provider import A2uiCatalogProvider

    class MemoryCatalogProvider(A2uiCatalogProvider):

        def __init__(self, schema):
            self.schema = schema

        def load(self):
            return self.schema

    config = CatalogConfig(
        name="test_catalog",
        provider=MemoryCatalogProvider(sample_catalog.catalog_schema),
    )

    # 1. TransportFormat parser supports streaming
    transport_fmt = TransportFormat(version=VERSION_0_9, catalogs=[config])
    assert transport_fmt.supports_streaming is True
    assert transport_fmt.parser.supports_streaming is True

    # 2. ExpressFormat parser does not support streaming
    express_fmt = ExpressFormat(catalog=sample_catalog)
    assert express_fmt.supports_streaming is False
    assert express_fmt.parser.supports_streaming is False

    # 3. ElementalFormat parser does not support streaming
    elemental_fmt = ElementalFormat(catalog=sample_catalog)
    assert elemental_fmt.supports_streaming is False
    assert elemental_fmt.parser.supports_streaming is False


def test_process_chunk_raises_not_implemented(sample_catalog):
    express_parser = ExpressParser(sample_catalog)
    with pytest.raises(NotImplementedError) as exc_info:
        express_parser.process_chunk("chunk")
    assert "Streaming is not supported by ExpressParser" in str(exc_info.value)

    elemental_parser = ElementalParser(sample_catalog)
    with pytest.raises(NotImplementedError) as exc_info:
        elemental_parser.process_chunk("chunk")
    assert "Streaming is not supported by ElementalParser" in str(exc_info.value)




def test_decompiler_delegation(sample_catalog):
    # Verify Transport Decompiler
    transport_fmt = TransportFormat(version=VERSION_0_9, catalogs=[])
    payload = {"createSurface": {"surfaceId": "main"}}
    direct_decompile = transport_fmt.decompiler.decompile(payload)
    assert "createSurface" in direct_decompile
    assert "main" in direct_decompile

    # Verify Express Decompiler
    express_fmt = ExpressFormat(catalog=sample_catalog)
    expr_decompiler = express_fmt.decompiler
    envelope = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "main",
            "components": [
                {
                    "id": "root",
                    "component": "Text",
                    "text": "Hello World",
                }
            ],
        },
    }
    decompiled_dsl = expr_decompiler.decompile(envelope)
    assert "root = Text(\"Hello World\")" in decompiled_dsl
