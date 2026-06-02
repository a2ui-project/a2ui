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

"""Tests for the A2uiEventConverter class."""

from unittest.mock import MagicMock, patch

import pytest

from a2ui.adk.a2a.event_converter import A2uiEventConverter
from a2ui.adk.a2a.part_converter import A2uiPartConverter
from a2ui.schema.catalog import A2uiCatalog


def test_event_converter_injects_catalog():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  event_mock = MagicMock()
  invocation_context_mock = MagicMock()
  # Correctly access session via mock
  invocation_context_mock.session.state = {"system:a2ui_catalog": catalog_mock}

  converter = A2uiEventConverter()

  with patch(
      "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
  ) as mock_base_converter:
    mock_base_converter.return_value = []

    # Converter is not async
    converter(event_mock, invocation_context_mock)

    # Verify that mock_base_converter was called with a part_converter that uses the catalog
    args, kwargs = mock_base_converter.call_args
    effective_part_converter = args[4]

    assert effective_part_converter.__name__ == "convert"
    assert isinstance(effective_part_converter.__self__, A2uiPartConverter)
    assert effective_part_converter.__self__._catalog == catalog_mock


def test_event_converter_falls_back_without_catalog():
  event_mock = MagicMock()
  invocation_context_mock = MagicMock()
  invocation_context_mock.session.state = {}  # No catalog

  converter = A2uiEventConverter()

  with patch(
      "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
  ) as mock_base_converter:
    mock_base_converter.return_value = []

    # Converter is not async
    converter(event_mock, invocation_context_mock)

    args, kwargs = mock_base_converter.call_args
    effective_part_converter = args[4]

    from google.adk.a2a.converters.part_converter import convert_genai_part_to_a2a_part

    assert effective_part_converter == convert_genai_part_to_a2a_part


def test_event_converter_propagates_fallback_text():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  event_mock = MagicMock()
  invocation_context_mock = MagicMock()
  invocation_context_mock.session.state = {"system:a2ui_catalog": catalog_mock}

  custom_fallback = "Custom event fallback text"
  converter = A2uiEventConverter(fallback_text=custom_fallback)

  with patch(
      "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
  ) as mock_base_converter:
    mock_base_converter.return_value = []

    converter(event_mock, invocation_context_mock)

    args, kwargs = mock_base_converter.call_args
    effective_part_converter = args[4]

    assert isinstance(effective_part_converter.__self__, A2uiPartConverter)
    assert effective_part_converter.__self__._fallback_text == custom_fallback
