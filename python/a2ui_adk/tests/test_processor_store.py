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

"""Tests for the A2uiProcessorStore class."""

from unittest.mock import MagicMock

from google.adk.agents.readonly_context import ReadonlyContext
import pytest

from a2ui.adk import A2uiProcessorStore, SendA2uiToClientToolset
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.processor import A2uiRequestProcessor


def _ctx(session_id: str) -> MagicMock:
    ctx = MagicMock(spec=ReadonlyContext)
    ctx.session.id = session_id
    return ctx


def _processor() -> A2uiRequestProcessor:
    return A2uiRequestProcessor([BasicCatalog("0.9")])


def test_store_keeps_one_processor_per_session():
    store = A2uiProcessorStore()
    first, second = _processor(), _processor()
    store.set("a", first)
    store.set("b", second)

    assert store.get(_ctx("a")) is first
    assert store.get(_ctx("b")) is second
    assert store.get(_ctx("c")) is None
    assert store.is_enabled(_ctx("a"))
    assert not store.is_enabled(_ctx("c"))
    assert len(store) == 2


def test_store_replaces_and_clears_a_sessions_processor():
    store = A2uiProcessorStore()
    first, second = _processor(), _processor()
    store.set("a", first)
    store.set("a", second)
    assert store.get(_ctx("a")) is second

    # A request without A2UI clears the processor of an earlier one.
    store.set("a", None)
    assert store.get(_ctx("a")) is None
    assert not store.is_enabled(_ctx("a"))

    store.set("a", first)
    store.remove("a")
    store.remove("missing")
    assert len(store) == 0


@pytest.mark.asyncio
async def test_store_provides_the_toolsets_processor():
    store = A2uiProcessorStore()
    processor = _processor()
    store.set("a", processor)
    toolset = SendA2uiToClientToolset(
        a2ui_enabled=store.is_enabled, a2ui_processor=store.get
    )

    assert await toolset.get_tools(_ctx("a")) != []
    assert await toolset.get_tools(_ctx("b")) == []
    assert await toolset._ui_tool._resolve_processor(_ctx("a")) is processor
    with pytest.raises(TypeError, match="has no processor"):
        await toolset._ui_tool._resolve_processor(_ctx("b"))
