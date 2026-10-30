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

"""Tests for A2uiRendererCallsStore."""

from __future__ import annotations

from unittest.mock import MagicMock

from google.adk.agents.readonly_context import ReadonlyContext
import pytest

from a2ui.adk import A2uiRendererCallsStore
from a2ui.core import A2uiRpcError

CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"


def _ctx(session_id: str) -> MagicMock:
    ctx = MagicMock(spec=ReadonlyContext)
    ctx.session.id = session_id
    return ctx


def test_store_keeps_one_instance_per_session() -> None:
    store = A2uiRendererCallsStore()

    first = store.get(_ctx("s1"))

    assert store.get(_ctx("s1")) is first
    assert store.get_for_session("s1") is first
    assert store.get(_ctx("s2")) is not first
    assert len(store) == 2
    assert "s1" in store


@pytest.mark.asyncio
async def test_store_passes_its_settings_to_each_instance() -> None:
    store = A2uiRendererCallsStore(default_timeout=0.01, max_pending=1)
    calls = store.get(_ctx("s1"))

    _, result = calls.call(catalog_id=CATALOG_ID, name="getLocation")
    with pytest.raises(A2uiRpcError):
        calls.call(catalog_id=CATALOG_ID, name="getLocation")
    with pytest.raises(A2uiRpcError) as excinfo:
        await result
    assert excinfo.value.code == "TIMEOUT"


@pytest.mark.parametrize(
    "kwargs", [{"default_timeout": 0}, {"default_timeout": -1.0}, {"max_pending": 0}]
)
def test_store_rejects_invalid_settings(kwargs: dict[str, float]) -> None:
    with pytest.raises(ValueError):
        A2uiRendererCallsStore(**kwargs)


@pytest.mark.asyncio
async def test_remove_disposes_the_session_instance() -> None:
    store = A2uiRendererCallsStore()
    calls = store.get(_ctx("s1"))
    _, result = calls.call(catalog_id=CATALOG_ID, name="getLocation")

    store.remove("s1", reason="session ended")

    assert calls.disposed
    assert "s1" not in store
    with pytest.raises(A2uiRpcError, match="session ended"):
        await result
    # Removing an unknown session does nothing.
    store.remove("unknown")


@pytest.mark.asyncio
async def test_dispose_disposes_every_instance() -> None:
    store = A2uiRendererCallsStore()
    first = store.get(_ctx("s1"))
    second = store.get(_ctx("s2"))

    store.dispose()

    assert first.disposed and second.disposed
    assert len(store) == 0


def test_get_replaces_an_instance_disposed_outside_the_store() -> None:
    store = A2uiRendererCallsStore()
    calls = store.get(_ctx("s1"))
    calls.dispose()

    replacement = store.get(_ctx("s1"))

    assert replacement is not calls
    assert not replacement.disposed
