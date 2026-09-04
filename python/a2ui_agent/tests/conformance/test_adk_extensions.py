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

    elif action == "convert_event":
        # Handle Subagent Map or Event Converter
        if "subagent" in args and "message" in args:
            from a2ui.adk.orchestration.a2ui_subagent_map import (
                A2uiSubagentMap,
                SurfaceIdAlreadyExistsError,
            )
            from a2ui.a2a.parts import create_a2ui_part
            from unittest.mock import AsyncMock, MagicMock
            from google.adk.sessions.session import Session

            subagent = args["subagent"]
            state = args.get("state", {})
            message = args["message"]

            a2a_part = create_a2ui_part(message)

            session_service = AsyncMock()
            session = MagicMock(spec=Session)
            session.state = dict(state)

            expect_error = test_case.get("expectError")
            if expect_error:
                with pytest.raises(SurfaceIdAlreadyExistsError) as exc_info:
                    asyncio.run(
                        A2uiSubagentMap.update_from_server_event(
                            a2a_part, subagent, session_service, session
                        )
                    )
                msg = (
                    expect_error.get("message", "")
                    if isinstance(expect_error, dict)
                    else expect_error
                )
                if msg:
                    assert msg in str(exc_info.value)
            else:
                asyncio.run(
                    A2uiSubagentMap.update_from_server_event(
                        a2a_part, subagent, session_service, session
                    )
                )
                expect = test_case["expect"]
                if "stateDelta" in expect:
                    session_service.append_event.assert_called_once()
                    call_args = session_service.append_event.call_args[0]
                    event = call_args[1]
                    assert event.actions.state_delta == expect["stateDelta"]

    elif action == "data_model":
        from a2ui.adk.orchestration.a2ui_subagent_map import A2uiSubagentMap
        import copy

        subagent = args.get("subagent")
        state = args.get("state", {})
        client_data_model = copy.deepcopy(args.get("clientDataModel", {}))

        asyncio.run(
            A2uiSubagentMap.strip_unowned_surfaces_from_data_model(
                subagent, client_data_model, state
            )
        )

        expected = test_case["expect"]
        if "clientDataModel" in expected:
            assert client_data_model == expected["clientDataModel"]

    elif action == "resolve_path":
        from a2ui.extensions.file_resolve import (
            FileResolver,
            FileResolverSecurityError,
        )

        resolver = FileResolver()
        file_info = args["fileInfo"]

        expect_error = test_case.get("expectError")
        if expect_error:
            with pytest.raises((FileResolverSecurityError, Exception)) as exc_info:
                asyncio.run(resolver.resolve_bytes(file_info))
            msg = (
                expect_error.get("message", "")
                if isinstance(expect_error, dict)
                else expect_error
            )
            if msg:
                assert msg in str(exc_info.value)
        else:
            raw_bytes, detected_mime = asyncio.run(resolver.resolve_bytes(file_info))
            expected = test_case["expect"]
            if "text" in expected:
                assert raw_bytes.decode("utf-8") == expected["text"]
            if "mimeType" in expected:
                assert detected_mime == expected["mimeType"]
