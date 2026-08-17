# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import asyncio
import json
import pytest
from .conformance_helpers import get_conformance_path, load_conformance_yaml


def get_conformance_cases(filename):
    cases = load_conformance_yaml(filename)
    return [(case["name"], case) for case in cases]


# --- ADK Extensions Conformance ---
cases_adk_extensions = get_conformance_cases("extensions/adk/adk_extensions.yaml")


@pytest.mark.parametrize(
    "name, test_case",
    cases_adk_extensions,
    ids=[c[0] for c in cases_adk_extensions],
)
def test_adk_extensions_conformance(name, test_case):
    from a2ui.adk.send_a2ui_to_client_toolset import SendA2uiToClientToolset
    from a2ui.schema.catalog import A2uiCatalog
    from unittest.mock import MagicMock

    action = test_case["action"]
    args = test_case.get("args", {})

    if action == "execute_tool":
        a2ui_json_str = args.get("a2uiJson")
        tool_args = {"a2ui_json": a2ui_json_str} if a2ui_json_str else args

        catalog_mock = MagicMock(spec=A2uiCatalog)
        catalog_mock.validator.validate.return_value = None

        tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool(
            catalog_mock, "examples"
        )

        tool_context_mock = MagicMock()
        tool_context_mock.state = {}
        tool_context_mock.actions = MagicMock(skip_summarization=False)

        # run_async is async in Python
        result = asyncio.run(
            tool.run_async(args=tool_args, tool_context=tool_context_mock)
        )

        expect = test_case["expect"]
        expect_success = expect["success"]

        if expect_success:
            assert "error" not in result
            assert (
                SendA2uiToClientToolset._SendA2uiJsonToClientTool.VALIDATED_A2UI_JSON_KEY
                in result
            )
            if expect.get("containsValidatedJson"):
                validated_payload = result[
                    SendA2uiToClientToolset._SendA2uiJsonToClientTool.VALIDATED_A2UI_JSON_KEY
                ]
                assert "beginRendering" in json.dumps(validated_payload)
        else:
            assert "error" in result
            err_contains = expect.get("errorContains")
            if err_contains:
                assert err_contains in result["error"]
