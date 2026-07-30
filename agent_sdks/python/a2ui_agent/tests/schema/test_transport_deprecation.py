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
from a2ui.basic_catalog import BasicCatalog
from a2ui.inference_formats.direct_json import DirectJsonFormat
from a2ui.schema.constants import VERSION_0_8


def test_transport_format_deprecation_warning():
    with pytest.deprecated_call(match="TransportFormat is deprecated"):
        from a2ui.inference_formats.transport.format import TransportFormat

        _ = TransportFormat(
            VERSION_0_8, catalogs=[BasicCatalog.get_config(VERSION_0_8)]
        )


def test_transport_parser_deprecation_warning():
    fmt = DirectJsonFormat(VERSION_0_8, catalogs=[BasicCatalog.get_config(VERSION_0_8)])
    cat = fmt._supported_catalogs[0]
    with pytest.deprecated_call(match="TransportParser is deprecated"):
        from a2ui.inference_formats.transport.parser import TransportParser

        _ = TransportParser(cat)


def test_transport_stream_parser_deprecation_warning():
    fmt = DirectJsonFormat(VERSION_0_8, catalogs=[BasicCatalog.get_config(VERSION_0_8)])
    cat = fmt._supported_catalogs[0]
    with pytest.deprecated_call(match="TransportStreamParser is deprecated"):
        from a2ui.inference_formats.transport.streaming import TransportStreamParser

        _ = TransportStreamParser(cat)


def test_transport_prompt_generator_deprecation_warning():
    fmt = DirectJsonFormat(VERSION_0_8, catalogs=[BasicCatalog.get_config(VERSION_0_8)])
    with pytest.deprecated_call(match="TransportPromptGenerator is deprecated"):
        from a2ui.inference_formats.transport.prompt_generator import (
            TransportPromptGenerator,
        )

        _ = TransportPromptGenerator(fmt)
