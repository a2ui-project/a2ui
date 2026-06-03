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

"""Tests for the A2uiPartConverter class."""

import json
from unittest.mock import MagicMock, patch

import pytest

from a2a import types as a2a_types
from a2ui.a2a.parts import create_a2ui_part
from a2ui.adk.a2a.part_converter import A2uiPartConverter
from a2ui.adk.send_a2ui_to_client_toolset import SendA2uiToClientToolset
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import A2UI_CLOSE_TAG, A2UI_OPEN_TAG, VERSION_0_8, VERSION_0_9_1
from google.genai import types as genai_types


def test_converter_class_convert_valid_tool_response():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  converter = A2uiPartConverter(catalog_mock)

  valid_a2ui = {"type": "Text", "text": "Hello"}
  function_response = genai_types.FunctionResponse(
      name=SendA2uiToClientToolset._SendA2uiJsonToClientTool.TOOL_NAME,
      response={
          SendA2uiToClientToolset._SendA2uiJsonToClientTool.VALIDATED_A2UI_JSON_KEY: [
              valid_a2ui
          ]
      },
  )
  part = genai_types.Part(function_response=function_response)

  a2a_parts = converter.convert(part)
  assert len(a2a_parts) == 1
  assert a2a_parts[0] == create_a2ui_part(valid_a2ui, version=VERSION_0_8)


def test_converter_class_convert_valid_tool_response_v0_9_1():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  converter = A2uiPartConverter(catalog_mock, version=VERSION_0_9_1)

  valid_a2ui = {"type": "Text", "text": "Hello"}
  function_response = genai_types.FunctionResponse(
      name=SendA2uiToClientToolset._SendA2uiJsonToClientTool.TOOL_NAME,
      response={
          SendA2uiToClientToolset._SendA2uiJsonToClientTool.VALIDATED_A2UI_JSON_KEY: [
              valid_a2ui
          ]
      },
  )
  part = genai_types.Part(function_response=function_response)

  a2a_parts = converter.convert(part)
  assert len(a2a_parts) == 1
  assert a2a_parts[0] == create_a2ui_part(valid_a2ui, version=VERSION_0_9_1)


def test_converter_class_convert_tool_error_response():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  converter = A2uiPartConverter(catalog_mock)

  function_response = genai_types.FunctionResponse(
      name=SendA2uiToClientToolset._SendA2uiJsonToClientTool.TOOL_NAME,
      response={
          SendA2uiToClientToolset._SendA2uiJsonToClientTool.TOOL_ERROR_KEY: "Some error"
      },
  )
  part = genai_types.Part(function_response=function_response)

  a2a_parts = converter.convert(part)
  assert len(a2a_parts) == 0


def test_converter_class_convert_tool_response_no_result():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  converter = A2uiPartConverter(catalog_mock)

  function_response = genai_types.FunctionResponse(
      name=SendA2uiToClientToolset._SendA2uiJsonToClientTool.TOOL_NAME,
      response={},
  )
  part = genai_types.Part(function_response=function_response)

  a2a_parts = converter.convert(part)
  assert len(a2a_parts) == 0


def test_converter_class_convert_function_call_ignores():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  converter = A2uiPartConverter(catalog_mock)

  function_call = genai_types.FunctionCall(
      name=SendA2uiToClientToolset._SendA2uiJsonToClientTool.TOOL_NAME,
      args={SendA2uiToClientToolset._SendA2uiJsonToClientTool.A2UI_JSON_ARG_NAME: "{}"},
  )
  part = genai_types.Part(function_call=function_call)

  a2a_parts = converter.convert(part)
  assert len(a2a_parts) == 0


def test_converter_class_convert_text_with_a2ui():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  converter = A2uiPartConverter(catalog_mock)

  valid_a2ui = [{"type": "Text", "text": "Hello"}]
  catalog_mock.validator.validate.return_value = None

  text = f"Here is the UI:\n{A2UI_OPEN_TAG}\n{json.dumps(valid_a2ui)}\n{A2UI_CLOSE_TAG}"
  part = genai_types.Part(text=text)

  a2a_parts = converter.convert(part)

  # Expect 2 parts: TextPart and A2UI DataPart
  assert len(a2a_parts) == 2
  assert a2a_parts[0].root.text == "Here is the UI:"
  assert a2a_parts[1] == create_a2ui_part(valid_a2ui[0], version=VERSION_0_8)
  catalog_mock.validator.validate.assert_called_once_with(valid_a2ui)


def test_converter_class_convert_text_with_a2ui_v0_9_1():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  converter = A2uiPartConverter(catalog_mock, version=VERSION_0_9_1)

  valid_a2ui = [{"type": "Text", "text": "Hello"}]
  catalog_mock.validator.validate.return_value = None

  text = f"Here is the UI:\n{A2UI_OPEN_TAG}\n{json.dumps(valid_a2ui)}\n{A2UI_CLOSE_TAG}"
  part = genai_types.Part(text=text)

  a2a_parts = converter.convert(part)

  # Expect 2 parts: TextPart and A2UI DataPart
  assert len(a2a_parts) == 2
  assert a2a_parts[0].root.text == "Here is the UI:"
  assert a2a_parts[1] == create_a2ui_part(valid_a2ui[0], version=VERSION_0_9_1)
  catalog_mock.validator.validate.assert_called_once_with(valid_a2ui)


def test_converter_class_convert_text_empty_leading():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  converter = A2uiPartConverter(catalog_mock)

  ui = [{"type": "Text", "text": "Top"}]
  catalog_mock.validator.validate.return_value = None

  text = f"\n{A2UI_OPEN_TAG}\n{json.dumps(ui)}\n{A2UI_CLOSE_TAG}"
  part = genai_types.Part(text=text)
  a2a_parts = converter.convert(part)

  assert len(a2a_parts) == 1
  assert a2a_parts[0] == create_a2ui_part(ui[0], version=VERSION_0_8)


def test_converter_class_convert_text_markdown_wrapped():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  converter = A2uiPartConverter(catalog_mock)

  ui = [{"type": "Text", "text": "Inside Markdown"}]
  catalog_mock.validator.validate.return_value = None

  # Text containing JSON wrapped in markdown tags
  text = f"Behold:\n{A2UI_OPEN_TAG}\n```json\n{json.dumps(ui)}\n```\n{A2UI_CLOSE_TAG}"
  part = genai_types.Part(text=text)
  a2a_parts = converter.convert(part)

  assert len(a2a_parts) == 2
  assert a2a_parts[0].root.text == "Behold:"
  assert a2a_parts[1] == create_a2ui_part(ui[0], version=VERSION_0_8)
  catalog_mock.validator.validate.assert_called_once_with(ui)


def test_converter_class_convert_text_with_invalid_a2ui():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  converter = A2uiPartConverter(catalog_mock)

  text = f"Here is the UI:\n{A2UI_OPEN_TAG}\ninvalid_json\n{A2UI_CLOSE_TAG}"
  part = genai_types.Part(text=text)

  a2a_parts = converter.convert(part)
  assert len(a2a_parts) == 0


def test_converter_class_convert_other_part():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  converter = A2uiPartConverter(catalog_mock)

  part = genai_types.Part(
      inline_data=genai_types.Blob(mime_type="image/png", data=b"abc")
  )

  with patch(
      "google.adk.a2a.converters.part_converter.convert_genai_part_to_a2a_part"
  ) as mock_convert:
    mock_a2a_part = a2a_types.Part(root=a2a_types.DataPart(kind="data", data={}))
    mock_convert.return_value = mock_a2a_part

    a2a_parts = converter.convert(part)
    assert len(a2a_parts) == 1
    assert a2a_parts[0] is mock_a2a_part
    mock_convert.assert_called_once_with(part)


def test_converter_class_convert_tool_response_with_result_containing_a2ui():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  converter = A2uiPartConverter(catalog_mock)

  valid_a2ui = [{"type": "Text", "text": "Result UI"}]
  catalog_mock.validator.validate.return_value = None

  result_text = (
      "Here is the"
      f" result:\n{A2UI_OPEN_TAG}\n{json.dumps(valid_a2ui)}\n{A2UI_CLOSE_TAG}"
  )
  function_response = genai_types.FunctionResponse(
      name="some_generic_tool",
      response={"result": result_text},
  )
  part = genai_types.Part(function_response=function_response)

  a2a_parts = converter.convert(part)

  # Expect 2 parts: TextPart and A2UI DataPart
  assert len(a2a_parts) == 2
  assert a2a_parts[0].root.text == "Here is the result:"
  assert a2a_parts[1] == create_a2ui_part(valid_a2ui[0], version=VERSION_0_8)
  catalog_mock.validator.validate.assert_called_once_with(valid_a2ui)


def test_converter_class_convert_text_with_invalid_a2ui_and_custom_fallback():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  custom_fallback = "Could not build interface."
  converter = A2uiPartConverter(catalog_mock, fallback_text=custom_fallback)

  text = f"Here is the UI:\n{A2UI_OPEN_TAG}\ninvalid_json\n{A2UI_CLOSE_TAG}"
  part = genai_types.Part(text=text)

  a2a_parts = converter.convert(part)
  assert len(a2a_parts) == 1
  assert a2a_parts[0].root.text == custom_fallback


def test_converter_class_convert_tool_response_with_result_containing_invalid_a2ui_and_default_fallback():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  converter = A2uiPartConverter(catalog_mock)

  result_text = f"Here is the result:\n{A2UI_OPEN_TAG}\ninvalid_json\n{A2UI_CLOSE_TAG}"
  function_response = genai_types.FunctionResponse(
      name="some_generic_tool",
      response={"result": result_text},
  )
  part = genai_types.Part(function_response=function_response)

  a2a_parts = converter.convert(part)
  assert len(a2a_parts) == 0


def test_converter_class_convert_tool_response_with_result_containing_invalid_a2ui_and_custom_fallback():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  custom_fallback = "Could not load the custom tool UI."
  converter = A2uiPartConverter(catalog_mock, fallback_text=custom_fallback)

  result_text = f"Here is the result:\n{A2UI_OPEN_TAG}\ninvalid_json\n{A2UI_CLOSE_TAG}"
  function_response = genai_types.FunctionResponse(
      name="some_generic_tool",
      response={"result": result_text},
  )
  part = genai_types.Part(function_response=function_response)

  a2a_parts = converter.convert(part)
  assert len(a2a_parts) == 1
  assert a2a_parts[0].root.text == custom_fallback
