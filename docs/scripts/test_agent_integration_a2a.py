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

"""Execute the guide's A2A routing example with mixed request parts."""

from __future__ import annotations

import asyncio
import pathlib
import re
from types import SimpleNamespace
from typing import Any

import pytest

from a2a.types import Message, Part, Role, TextPart

from a2ui.a2a import create_a2ui_parts, get_a2ui_extension_uri
from a2ui.core import AgentFunction
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.processor import A2uiGenerator, CatalogConfig

GUIDE = pathlib.Path(__file__).resolve().parents[1] / (
    "site/src/content/docs/guides/agent-integration.mdx"
)


@pytest.mark.parametrize("companion", [None, "action", "text"])
def test_a2a_preserves_rpc_replies_and_processes_other_parts(
    companion: str | None,
) -> None:
    async def run() -> None:
        blocks = re.findall(r"```python\n(.*?)\n```", GUIDE.read_text(), re.DOTALL)
        block = next(b for b in blocks if "class OrderA2aExecutor(" in b)
        namespace: dict[str, Any] = {}
        exec(compile(block, str(GUIDE), "exec"), namespace)
        sent: list[Part] = []
        model_turns: list[None] = []
        function_calls: list[None] = []

        def lookup(args: dict[str, Any]) -> dict[str, str]:
            function_calls.append(None)
            return {"status": "ready"}

        catalog = BasicCatalog(ProtocolVersion.V1_0).copy_with(
            agent_functions=[
                AgentFunction(
                    "lookupOrder", return_type="object", schema={}, handler=lookup
                )
            ]
        )
        processor = A2uiGenerator([CatalogConfig(catalog)]).create_processor(
            {"1.0": {"supportedCatalogIds": [catalog.catalog_id]}}
        )

        async def tokens() -> Any:
            model_turns.append(None)
            yield '<a2ui>\nsurface("s")\nroot = Text("Ready")\n</a2ui>'

        async def prepare_session(self: Any, context: Any) -> Any:
            return processor, tokens()

        async def cancel(self: Any, context: Any, event_queue: Any) -> None:
            raise AssertionError("Cancellation was not requested")

        async def enqueue_parts(event_queue: Any, parts: list[Part]) -> None:
            sent.extend(parts)

        namespace["enqueue_parts"] = enqueue_parts
        executor = type(
            "Executor",
            (namespace["OrderA2aExecutor"],),
            {"prepare_session": prepare_session, "cancel": cancel},
        )()
        rpc = {
            "version": "1.0",
            "callAgentFunction": {
                "surfaceId": "s",
                "functionCallId": "lookup-1",
                "callFunction": {
                    "catalogId": catalog.catalog_id,
                    "@call": "lookupOrder",
                    "args": {},
                },
            },
        }
        parts = create_a2ui_parts([rpc], version=ProtocolVersion.V1_0)
        if companion == "action":
            parts.extend(
                create_a2ui_parts(
                    [{
                        "version": "1.0",
                        "action": {
                            "name": "confirm_order",
                            "surfaceId": "s",
                            "sourceComponentId": "button",
                            "timestamp": "2026-11-12T12:00:00Z",
                            "context": {},
                        },
                    }],
                    version=ProtocolVersion.V1_0,
                )
            )
        elif companion == "text":
            parts.append(Part(root=TextPart(text="Also show my order")))
        context = SimpleNamespace(
            message=Message(role=Role.user, message_id="request-1", parts=parts),
            requested_extensions=[get_a2ui_extension_uri(ProtocolVersion.V1_0)],
            add_activated_extension=lambda uri: None,
        )
        await executor.execute(context, None)
        replies = [
            part.root.data["agentFunctionResponse"]
            for part in sent
            if hasattr(part.root, "data") and "agentFunctionResponse" in part.root.data
        ]
        assert function_calls == [None]
        assert replies == [{"functionCallId": "lookup-1", "value": {"status": "ready"}}]
        assert len(model_turns) == (0 if companion is None else 1)

    asyncio.run(run())
