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

"""Execute the guide's buffered retry example against the Python SDK."""

from __future__ import annotations

import asyncio
import pathlib
import re
from typing import Any

import pytest

from a2ui.core import A2uiError
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.processor import A2uiGenerator, CatalogConfig
from a2ui.utils import RendererState

GUIDE = pathlib.Path(__file__).resolve().parents[1] / (
    "site/src/content/docs/guides/agent-integration.mdx"
)
VALID = '<a2ui>\nsurface("s")\nroot = Text("Ready")\n</a2ui>'
TRUNCATED = '<a2ui>\nsurface("s")\nroot = Card("missing")\n'


def _retry_example() -> Any:
    blocks = re.findall(
        r"```python\n(.*?)\n```", GUIDE.read_text(encoding="utf-8"), re.DOTALL
    )
    block = next(b for b in blocks if "async def generate_validated_turn(" in b)
    namespace: dict[str, Any] = {}
    exec(compile(block, str(GUIDE), "exec"), namespace)
    return namespace["generate_validated_turn"]


@pytest.mark.parametrize(
    "invalid", [TRUNCATED, VALID.removesuffix("</a2ui>"), TRUNCATED + "</a2ui>"]
)
def test_buffered_retry_discards_incomplete_or_invalid_attempt(invalid: str) -> None:
    async def run() -> None:
        catalog = BasicCatalog(ProtocolVersion.V1_0)
        state = RendererState([catalog])
        processor = A2uiGenerator([CatalogConfig(catalog)]).create_processor(
            {"1.0": {"supportedCatalogIds": [catalog.catalog_id]}}, state=state
        )
        prompts: list[str] = []

        async def call_llm(prompt: str) -> str:
            prompts.append(prompt)
            if len(prompts) == 1:
                return invalid
            assert state.surface_ids == []
            return VALID

        messages = await _retry_example()(processor, "Show my order", call_llm)
        assert len(prompts) == 2
        assert invalid in prompts[1]
        assert state.surface_ids == ["s"]
        state.check_topology(state.surface_ids)
        assert messages

    asyncio.run(run())


def test_buffered_retry_exhaustion_restores_state() -> None:
    async def run() -> None:
        catalog = BasicCatalog(ProtocolVersion.V1_0)
        state = RendererState([catalog])
        processor = A2uiGenerator([CatalogConfig(catalog)]).create_processor(
            {"1.0": {"supportedCatalogIds": [catalog.catalog_id]}}, state=state
        )
        attempts = 0

        async def call_llm(prompt: str) -> str:
            nonlocal attempts
            attempts += 1
            return TRUNCATED

        with pytest.raises(A2uiError):
            await _retry_example()(processor, "Show my order", call_llm, max_retries=1)
        assert attempts == 2
        assert state.surface_ids == []

    asyncio.run(run())


def test_buffered_retry_restores_existing_surface_before_retry() -> None:
    async def run() -> None:
        catalog = BasicCatalog(ProtocolVersion.V1_0)
        state = RendererState([catalog])
        processor = A2uiGenerator([CatalogConfig(catalog)]).create_processor(
            {"1.0": {"supportedCatalogIds": [catalog.catalog_id]}}, state=state
        )
        processor.parse_response(VALID)
        attempts = 0

        async def call_llm(prompt: str) -> str:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                return '<a2ui>\nsurface("s", update=true)\nroot = Text("Unfinished")\n'
            surface = state.get_surface("s")
            assert surface is not None
            root = surface.components_model.get("root")
            assert root is not None
            assert root.properties["text"] == "Ready"
            return '<a2ui>\nsurface("s", update=true)\nroot = Text("Updated")\n</a2ui>'

        messages = await _retry_example()(processor, "Update my order", call_llm)
        assert attempts == 2
        assert messages
        state.check_topology(state.surface_ids)

    asyncio.run(run())
